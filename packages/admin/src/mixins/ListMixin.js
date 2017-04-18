import DataMixin from '@/mixins/DataMixin'

export default {
  mixins: [DataMixin],

  props: {
    data: { type: Object, required: false }
  },

  computed: {
    listData() {
      return this.data && this.data[this.name] || this.loadedData
    },

    shouldLoad() {
      return this.desc.load && !this.listData
    },

    view() {
      // The view description of a list is the list's description itself.
      return this.desc
    },

    endpoint() {
      return this.getEndpoint('get', 'collection')
    },

    route() {
      return `${this.root ? '/' : ''}${this.name}`
    }
  },

  methods: {
    remove(item) {
      if (item &&
          confirm(`Do you really want to remove "${this.getTitle(item)}"?`)) {
        this.send('delete', this.getEndpoint('delete', 'member', item.id), null,
          err => {
            if (!err) {
              const data = this.listData
              const index = data && data.indexOf(item)
              if (index >= 0) {
                data.splice(index, 1)
              }
            }
            this.loadData(false)
          }
        )
      }
    }
  }
}
