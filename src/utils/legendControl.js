export default class LegendControl {
  constructor(minSaturation, ...scales) {
    this.minSaturation = Number.isFinite(minSaturation) ? minSaturation : 25
    this.scales = scales || [] // [{ name, minLabel, maxLabel, hue, invert }]
    this.container = null
  }

  onAdd(_map) {
    this.container = document.createElement('div')
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group legend-control'

    for (const s of this.scales) {
      this._addScale(
        s.name ?? 'Scale',
        s.minLabel ?? 'Low',
        s.maxLabel ?? 'High',
        Number.isFinite(s.hue) ? s.hue : 200,
        !!s.invert
      )
    }
    return this.container
  }

  onRemove() {
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    this.container = null
  }

  _addScale(name, min, max, hue, invert) {
    const wrap = document.createElement('div')
    wrap.className = 'legend-control-scale'

    const title = document.createElement('div')
    title.textContent = name
    title.className = 'legend-control-title'
    wrap.appendChild(title)

    const colors = document.createElement('div')
    colors.className = 'legend-control-colors'
    const start = `hsl(${hue}, ${this.minSaturation}%, 50%)`
    const end   = `hsl(${hue}, 100%, 50%)`
    colors.style.background = invert
      ? `linear-gradient(to right, ${end}, ${start})`
      : `linear-gradient(to right, ${start}, ${end})`
    wrap.appendChild(colors)

    const labels = document.createElement('div')
    labels.className = 'legend-control-labels'
    const minSpan = document.createElement('span')
    const maxSpan = document.createElement('span')
    minSpan.textContent = String(min)
    maxSpan.textContent = String(max)

    if (invert) {
      labels.appendChild(maxSpan)
      labels.appendChild(minSpan)
    } else {
      labels.appendChild(minSpan)
      labels.appendChild(maxSpan)
    }
    wrap.appendChild(labels)

    this.container.appendChild(wrap)
  }
}
