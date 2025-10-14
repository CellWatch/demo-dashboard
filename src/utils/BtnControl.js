export default class BtnControl {
  constructor(btns) {
    this.btns = Array.isArray(btns) ? btns : []
    this.container = null
  }

  onAdd(_map) {
    this.container = document.createElement('div')
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group btn-control'

    for (const btn of this.btns) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = btn.text ?? 'Button'
      b.title = btn.title ?? btn.text ?? ''
      if (typeof btn.onClick === 'function') {
        b.addEventListener('click', btn.onClick)
      }
      this.container.appendChild(b)
    }
    return this.container
  }

  onRemove() {
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    this.container = null
  }
}
