class LegendControl {
  constructor(minSaturation, ...scales) {
    this.minSaturation = minSaturation
    this.scales = scales
  }

  onAdd(_map) {
    this.container = document.createElement('div')
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group legend-control'

    for (const scale of this.scales) {
      this.addScale(scale.name, scale.minLabel, scale.maxLabel, scale.hue, scale.invert)
    }

    return this.container
  }

  onRemove() {
    this.container.parentNode.removeChild(this.container)
  }

  addScale(name, min, max, hue, invert) {
    const container = document.createElement('div')
    container.className = 'legend-control-scale'

    const title = document.createElement('strong')
    title.textContent = name
    container.appendChild(title)

    const colors = document.createElement('div')
    colors.className = 'legend-control-colors'
    colors.style.setProperty(
      'background',
      `linear-gradient(to right, hsl(${hue}, ${this.minSaturation}%, 50%), hsl(${hue}, 100%, 50%)`)
    container.appendChild(colors)

    const labels = document.createElement('div')
    labels.className = 'legend-control-labels'
    const minLabel = document.createElement('span')
    minLabel.textContent = `${min}`
    const maxLabel = document.createElement('span')
    maxLabel.textContent = `${max}`
    if (invert) {
      labels.appendChild(maxLabel)
      labels.appendChild(minLabel)
    } else {
      labels.appendChild(minLabel)
      labels.appendChild(maxLabel)
    }
    container.appendChild(labels)

    this.container.appendChild(container)
  }
}
