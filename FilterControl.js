class FilterControl {
  all = '[all]'

  constructor(collection, source, ...filters) {
    this.collection = collection
    this.features = collection.features
    this.source = source
    this.filters = filters
    this.values = filters.reduce((vals, filter) => ({...vals, [filter.field]: this.all}), {})
  }

  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div')
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group filter-control'

    for (const filter of this.filters) {
      const label = document.createElement('label')
      label.textContent = filter.name
      const select = document.createElement('select')

      for (const opt of [
        this.all,
        ...this.features
          .map(f => f.properties.measurement[filter.field])
          .filter((m, i, a) => a.indexOf(m) === i),
      ]) {
        const option = document.createElement('option')
        option.value = opt
        option.textContent = opt
        select.appendChild(option)
      }

      select.addEventListener('change', e => {
        this.values[filter.field] = e.target.value
        this.filter()
      })

      label.appendChild(select)
      this.container.appendChild(label)
    }

    return this.container
  }

  onRemove() {
    this.container.parentNode.removeChild(this.container)
  }

  filter() {
    console.log('filtering', this.filters)
    this.collection.features = this.features
      .filter(feature => Object.entries(this.values).every(([field, value]) => (
        value === this.all || feature.properties.measurement[field] === value
      )))

    this.source.setData(this.collection)
  }

  updateCollection(collection) {
    this.collection = collection
    this.features = collection.features
    this.filter()
  }
}
