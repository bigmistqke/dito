// Assumes: Component defines this.api

export default {
  data() {
    return {
      error: null,
      loading: false,
      loadedData: null
    }
  },

  created() {
    // Initialize data after component was created and the data is already being
    // observed.
    this.initData()
  },

  watch: {
    $route() {
      this.initData()
    }
  },

  computed: {
    // To be overridden by components using this mixin.
    shouldLoad() {
      return true
    }
  },

  methods: {
    getEndpoint(method, type, id) {
      return this.api.endpoints[method][type](this.view, this.form,
          type === 'collection' ? this.parentForm : id)
    },

    setLoading(loading) {
      // Only display loading progress on route components
      this.routeComponent.loading = loading
    },

    send(method, path, payload, callback) {
      // TODO: Shall we fall back to axios locally imported, if no send method
      // is defined?
      this.error = null
      const send = this.api.send
      if (send) {
        this.setLoading(true)
        send(method, path, payload, (err, result) => {
          this.setLoading(false)
          if (err) {
            this.error = err.toString()
          }
          if (callback) {
            callback.call(this, err, result)
          }
        })
        return true
      }
    },

    loadData(clear) {
      if (clear) {
        this.loadedData = null
      }
      this.send('get', this.endpoint, null, (err, data) => {
        if (!err) {
          this.loadedData = data
        }
      })
    },

    initData() {
      if (this.shouldLoad) {
        this.loadData(true)
      }
    }
  }
}
