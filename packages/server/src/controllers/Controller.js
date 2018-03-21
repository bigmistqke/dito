import compose from 'koa-compose'
import Router from 'koa-router'
import chalk from 'chalk'
import { ResponseError, WrappedError } from '@/errors'
import { isFunction } from '@ditojs/utils'
import { asArguments } from '@/utils'
import ControllerAction from './ControllerAction'

export class Controller {
  constructor(app, namespace) {
    this.app = app
    this.namespace = this.namespace || namespace
    this.logging = this.app?.config.log.routes
    this.level = 0
  }

  initialize(isRoot = true) {
    this.name = this.name ||
      this.constructor.name.match(/^(.*?)(?:Controller|)$/)[1]
    if (this.path === undefined) {
      this.path = this.app.normalizePath(this.name)
    }
    if (isRoot) {
      const { path, namespace } = this
      const url = path ? `/${path}` : ''
      this.url = namespace ? `/${namespace}${url}` : url
      this.log(
        `${namespace ? chalk.green(`${namespace}/`) : ''}${
          chalk.cyan(path)}${
          chalk.white(':')
        }`,
        this.level
      )
      this.router = null
      this.controller = this.setupActions('controller')
    }
  }

  get controller() {
    // On base controllers, the actions can be defined directly in the class
    // instead of inside an actions object as is done with model and relation
    // controllers. But in order to use the same structure for inheritance as
    // these other controllers, we emulate a `controller` accessor that reflects
    // these instance fields in a separate object. This accessor has a setter,
    // so that if it is set in a sub-class, the overridden value is used.
    if (!this._controller) {
      // Create an allow array with all copied entries, only if the instance
      // does not already provide one.
      const allow = !this.allow && []
      this._controller = {
        allow: this.allow || allow
      }

      const collect = key => {
        const action = this[key]
        if (
          isFunction(action) &&
          !['constructor', 'modelClass'].includes(key)
        ) {
          this._controller[key] = action
          if (allow && !allow.includes(key)) {
            allow.push(key)
          }
        }
      }

      // Use `Object.getOwnPropertyNames()` to get the fields in order to not
      // also receive values from parents (those are fetched later in
      // `inheritValues()`, see `getParentValues()`).
      if (!this.isCore()) {
        Object.getOwnPropertyNames(Object.getPrototypeOf(this)).forEach(collect)
      }
      Object.getOwnPropertyNames(this).forEach(collect)
    }
    return this._controller
  }

  set controller(controller) {
    this._controller = controller
  }

  isCore() {
    // This is hackish, but works for now: Any Controller class that defines
    // `initialize` or `compose` is considered to be a core class.
    const proto = Object.getPrototypeOf(this)
    return proto.hasOwnProperty('initialize') || proto.hasOwnProperty('compose')
  }

  compose() {
    return compose(this.router
      ? [
        this.router.routes(),
        this.router.allowedMethods()
      ]
      : []
    )
  }

  getPath(type, path) {
    return path
  }

  getUrl(type, path) {
    path = this.getPath(type, path)
    // Use '.' as the path for the controller's "index" action.
    return path && path !== '.' ? `${this.url}/${path}` : this.url
  }

  filterValues(values) {
    // Respect `allow` settings and clear action methods that aren't listed.
    // Do not filter actions on core controllers.
    if (values && !this.isCore()) {
      const allow = values.hasOwnProperty('allow')
        ? asArguments(values.allow)
        : []
      if (!allow.includes('*')) {
        for (const key in values) {
          if (!allow.includes(key) && key !== 'allow') {
            values[key] = undefined
          }
        }
      }
    }
    return values
  }

  inheritValues(type, filter = false) {
    // Gets the controller class's instance field for a given action type, e.g.
    // `controller` (Controller), `collection`, `member` (ModelController,
    // RelationController), `relation` (RelationController), and sets up an
    // inheritance chain for it that goes all the way up to it base class (e.g.
    // CollectionController), so that the default definitions for all http verbs
    // can be correctly inherited and overridden while using `super.<action>()`.
    const parentClass = Object.getPrototypeOf(this.constructor)
    // Create one instance of each controller class up the chain in order to
    // get to their definitions of the inheritable values. Cache both instance
    // and resolved values per parentClass in an inheritanceMap.
    if (!inheritanceMap.has(parentClass)) {
      inheritanceMap.set(parentClass, {
        // eslint-disable-next-line new-cap
        instance: new parentClass()
      })
    }
    const entry = inheritanceMap.get(parentClass)
    if (!entry[type]) {
      const parent = entry.instance
      let values = parent[type]
      if (parentClass !== Controller) {
        // Recursively set up inheritance chains.
        values = parent.inheritValues(type, filter)
      }
      entry[type] = values
    }
    // If there are no values defined on `this` that differ from the parent,
    // set to an empty object so inheritance can be set up and `filterValues()`
    // can still be called.
    // NOTE: We can't check with `this.hasOwnProperty(type)` because the
    // field can be on the class prototype as well, in case of accessors.
    const parentValues = entry[type]
    let currentValues = this[type]
    if (currentValues && currentValues === parentValues) {
      currentValues = this[type] = {}
    }
    // Combine parentValues and currentValues with correct inheritance.
    const values = parentValues
      ? Object.setPrototypeOf(currentValues, parentValues)
      : currentValues
    return filter ? this.filterValues(values) : values
  }

  setupActions(type) {
    const actions = this.inheritValues(type, true)
    for (const name in actions) {
      const action = actions[name]
      if (isFunction(action)) {
        this.setupAction(type, action, name)
      }
    }
    return actions
  }

  setupAction(type, action, name) {
    this.setupRoute(
      type,
      action.verb || 'get',
      action.path || this.app.normalizePath(name),
      new ControllerAction(this, action)
    )
  }

  setupRoute(type, verb, path, controllerAction) {
    const url = this.getUrl(type, path)
    this.log(
      `${chalk.magenta(verb.toUpperCase())} ${chalk.white(url)}`,
      this.level + 1
    )
    if (!this.router) {
      this.router = new Router()
    }
    this.router[verb](url, async ctx => {
      try {
        const res = await controllerAction.callAction(ctx)
        if (res !== undefined) {
          ctx.body = res
        }
      } catch (err) {
        throw err instanceof ResponseError ? err : new WrappedError(err)
      }
    })
  }

  log(str, indent = 0) {
    if (this.logging) {
      console.log(`${'  '.repeat(indent)}${str}`)
    }
  }
}

const inheritanceMap = new WeakMap()
