import objection from 'objection'
import chalk from 'chalk'
import pluralize from 'pluralize'
import {
  isObject, isString, isFunction, asArray, camelize
} from '@ditojs/utils'
import { ResponseError, NotFoundError, WrappedError } from '@/errors'
import { convertSchema } from '@/schema'
import { Controller } from './Controller'

export class ModelController extends Controller {
  constructor(app, namespace) {
    super(app, namespace)
    this.graph = !!this.graph
    this.scope = this.scope || null
    this.modelClass = this.modelClass ||
      app?.models[camelize(pluralize.singular(this.name), true)]
    // Create an empty instance for validation of ids, see getId()
    // eslint-disable-next-line new-cap
    this.validator = this.modelClass && new this.modelClass()
  }

  initialize() {
    super.initialize()
    this.applyScope = this.scope
      ? query => query.applyScope(this.scope)
      : null
    const parent = this.constructor.getParentActions()
    this.collection = this.setupActions('collection', parent)
    this.member = this.setupActions('member', parent)
    this.relations = this.setupRelations('relations', parent)
  }

  static getParentActions() {
    const parentClass = Object.getPrototypeOf(this)
    const has = name => parentClass.hasOwnProperty(name)
    if (!has('collection') && !has('member') && !has('relations')) {
      // If `collection` and `member` hasn't been inherited and resolved yet,
      // we need to create one instance of each controller class up the chain,
      // in order to get to its definitions of `collection` and `member`.
      // Once their inheritance is set up correctly, they will be exposed on the
      // class itself.
      // eslint-disable-next-line new-cap
      let { collection, member, relations } = new parentClass()
      if (parentClass !== ModelController) {
        // Recursively set up inheritance chains.
        const parent = parentClass.getParentActions()
        Object.setPrototypeOf(collection, parent.collection)
        Object.setPrototypeOf(member, parent.member)
        if (parent.relations) {
          relations = Object.setPrototypeOf(relations || {}, parent.relations)
        }
      }
      parentClass.collection = collection
      parentClass.member = member
      parentClass.relations = relations
    }
    const { collection, member, relations } = parentClass
    return { collection, member, relations }
  }

  inheritAndFilter(name, parent) {
    let values = this[name]
    const parentValues = parent[name]
    if (parentValues) {
      // Inherit from the parent actions so overrides can use super.<action>():
      values = Object.setPrototypeOf(values || {}, parentValues)
      // Respect `only` settings and clear any default method to deactivate it:
      if (values.only) {
        for (const key in values) {
          if (!values.hasOwnProperty(key) &&
              !values.only.includes(key) &&
              key !== 'only') {
            values[key] = undefined
          }
        }
      }
    }
    return values
  }

  setupActions(name, parent) {
    const actions = this.inheritAndFilter(name, parent)
    // Now install the routes.
    const isMember = name === 'member'
    for (const key in actions) {
      const action = actions[key]
      if (isFunction(action)) {
        let verb = actionToVerb[key]
        let path = isMember ? `${this.url}/:id` : this.url
        let method = action
        if (!verb) {
          // A custom action:
          path = `${path}/${action.path || this.app.normalizePath(key)}`
          verb = action.verb || 'get'
          method = async ctx => this.callAction(action, ctx,
            isMember && (ctx => actions.find.call(this, ctx))
          )
        }
        this.log(`${chalk.magenta(verb.toUpperCase())} ${chalk.white(path)}`, 1)
        this.router[verb](path, async ctx => {
          try {
            const res = await method.call(this, ctx)
            if (res !== undefined) {
              ctx.body = res
            }
          } catch (err) {
            throw err instanceof ResponseError ? err : new WrappedError(err)
          }
        })
      }
    }
    return actions
  }

  setupRelations(name, parent) {
    const relations = this.inheritAndFilter(name, parent)
    for (const key in relations) {
      const relation = relations[key]
      if (isObject(relation)) {
        this.log(`${chalk.blue(key)}${chalk.white(':')}`, 1)
        // TODO: Implement
      }
    }
    return relations
  }

  checkModel(model, id) {
    if (!model) {
      throw new NotFoundError(
        `Cannot find '${this.modelClass.name}' model with id ${id}`)
    }
    return model
  }

  getId(ctx) {
    const { id } = ctx.params
    // Use a dummy instance to validate the format of the passed id
    this.validator.$validate(
      this.modelClass.getIdProperties(id),
      { patch: true }
    )
    return id
  }

  async callAction(action, ctx, getMember = null) {
    const { query } = ctx
    let { validators, parameters, returns } = action
    if (!validators && (parameters || returns)) {
      validators = action.validators = {
        parameters: this.createValidator(parameters),
        returns: this.createValidator(returns, {
          // Use instanceof checks instead of $ref to check returned values.
          instanceof: true
        })
      }
    }

    // TODO: Instead of splitting by consumed parameters, split by parameters
    // expected by QueryBuilder and supported by this controller, and pass
    // everything else to the parameters validator.
    if (validators && !validators.parameters(query)) {
      throw this.modelClass.createValidationError({
        type: 'RestValidation',
        message: `The provided data is not valid: ${JSON.stringify(query)}`,
        errors: validators.parameters.errors
      })
    }
    const args = await this.collectArguments(ctx, parameters, getMember)
    const value = await action.call(this, ...args)
    const returnName = returns?.name
    // Use 'root' if no name is given, see createValidator()
    const returnData = { [returnName || 'root']: value }
    // Use `call()` to pass `value` as context to Ajv, see passContext:
    if (validators && !validators.returns.call(value, returnData)) {
      throw this.modelClass.createValidationError({
        type: 'RestValidation',
        message: `Invalid result of custom action: ${value}`,
        errors: validators.returns.errors
      })
    }
    return returnName ? returnData : value
  }

  createValidator(parameters = [], options = {}) {
    parameters = asArray(parameters)
    if (parameters.length > 0) {
      let properties = null
      for (const param of parameters) {
        if (param) {
          const property = isString(param) ? { type: param } : param
          const { name, type, ...rest } = property
          properties = properties || {}
          properties[name || 'root'] = type ? { type, ...rest } : rest
        }
      }
      if (properties) {
        const schema = convertSchema(properties, options)
        return this.app.compileValidator(schema)
      }
    }
    return () => true
  }

  async collectArguments(ctx, parameters, getMember) {
    const { query } = ctx
    const consumed = parameters && getMember && {}
    const args = parameters?.map(
      ({ name }) => {
        if (consumed) {
          consumed[name] = true
        }
        return name ? query[name] : query
      }) ||
      // If no parameters are provided, pass the full ctx object to the method
      [ctx]
    if (getMember) {
      if (consumed) {
        // Create a copy of ctx that inherits from the real one but overrides
        // query with aversion that has all consumed query params removed, so it
        // can be passed on to the getMember() which calls `actions.find(ctx)`:
        ctx = Object.setPrototypeOf({}, ctx)
        ctx.query = Object.entries(query).reduce((query, [key, value]) => {
          if (!consumed[key]) {
            query[key] = value
          }
        }, {})
      }
      // Resolve member and add as first argument to list.
      args.unshift(await getMember(ctx))
    }
    return args
  }

  execute(method) {
    return this.graph
      ? objection.transaction(this.modelClass, method)
      : method(this.modelClass)
  }

  executeAndFetch(action, ctx, modify) {
    const name = `${action}${this.graph ? 'Graph' : ''}AndFetch`
    return this.execute(modelClass =>
      modelClass[name](ctx.request.body)
        .modify(this.applyScope)
        .modify(modify)
    )
  }

  executeAndFetchById(action, ctx, modify) {
    const id = this.getId(ctx)
    const name = `${action}${this.graph ? 'Graph' : ''}AndFetchById`
    return this.execute(modelClass =>
      modelClass[name](id, ctx.request.body)
        .modify(this.applyScope)
        .modify(modify)
        .then(model => this.checkModel(model, id))
    )
  }

  collection = {
    find(ctx, modify) {
      return this.modelClass
        .find(ctx.query)
        .modify(this.applyScope)
        .modify(modify)
    },

    delete(ctx, modify) {
      // TODO: Decide if we should set status? status = 204
      return this.modelClass
        .find(ctx.query)
        .delete()
        .modify(modify)
        .then(count => ({ count }))
    },

    insert(ctx, modify) {
      // TODO: Decide if we should set status? status = 201
      return this.executeAndFetch('insert', ctx, modify)
    },

    update(ctx, modify) {
      return this.executeAndFetch('update', ctx, modify)
    },

    patch(ctx, modify) {
      return this.executeAndFetch('patch', ctx, modify)
    }
  }

  member = {
    find(ctx, modify) {
      const id = this.getId(ctx)
      return this.modelClass
        .findById(id, ctx.query)
        .modify(this.applyScope)
        .modify(modify)
        .then(model => this.checkModel(model, id))
    },

    delete(ctx, modify) {
      return this.modelClass
        .deleteById(this.getId(ctx))
        .modify(modify)
        .then(count => ({ count }))
    },

    update(ctx, modify) {
      return this.executeAndFetchById('update', ctx, modify)
    },

    patch(ctx, modify) {
      return this.executeAndFetchById('patch', ctx, modify)
    }
  }
}

const actionToVerb = {
  find: 'get',
  delete: 'delete',
  insert: 'post',
  update: 'put',
  patch: 'patch'
}
