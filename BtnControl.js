class BtnControl {
  constructor(btns) {
    this.btns = btns
  }

  onAdd(_map) {
    this.container = document.createElement('div')
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group btn-control'

    for (const btn of this.btns) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = btn.text
      b.addEventListener('click', btn.onClick)
      this.container.appendChild(b)
    }

    return this.container
  }

  onRemove() {
    this.container.parentNode.removeChild(this.container)
  }
}
