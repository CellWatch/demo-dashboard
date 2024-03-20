const measurementColors = {
  latency: {hue: 100, max: 100, invert: true}, // max in milliseconds
  download: {hue: 300, max: 100e6, invert: false}, // max in bits per second
  upload: {hue: 200, max: 20e6, invert: false}, // max in bits per second
}
const measurementColorMinSaturation = 25
