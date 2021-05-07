import Vue from 'vue'
import DitoMixin from './mixins/DitoMixin'
import TypeMixin from './mixins/TypeMixin'
import { getTypeComponent } from '@/utils/schema'
import { isFunction, isPromise } from '@ditojs/utils'

const components = {}

const DitoComponent = Vue.extend({
  // Make sure that registered components are present in all DitoComponent.
  components,
  mixins: [DitoMixin],

  methods: {
    getTypeComponent,

    resolveComponent(component, mixins = []) {
      // A helper method to allow three things:
      // - When used in a computed property, it removes the need to have to
      //   load components with async functions `component: () => import(...)`.
      //   instead, they can be directly provided: `component: import(...)`
      // - The properties passed to such components don't need to be defined.
      //   Instead, the provided mixins are automatically inherited.
      // - The component can use all internal components known to Dito.js Admin.
      return component
        ? async () => {
          // At first, resolve component is it is loaded asynchronously.
          let comp = isFunction(component) ? await component()
            : isPromise(component) ? await component
            : component
          comp = comp?.default || comp
          comp.mixins = mixins
          comp.components = components
          return comp
        }
        : component
    },

    resolveDitoComponent(component) {
      return this.resolveComponent(component, [DitoMixin])
    },

    resolveTypeComponent(component) {
      return this.resolveComponent(component, [DitoMixin, TypeMixin])
    }
  }
})

DitoComponent.component = function(name, options) {
  if (options) {
    options = {
      name,
      ...options
    }
    const ctor = this.extend(options)
    components[name] = ctor
    return ctor
  } else {
    return components[name] || Vue.component(name)
  }
}

export default DitoComponent
