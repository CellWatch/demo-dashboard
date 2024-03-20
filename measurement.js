const measurementColors = {
  latency: {hue: 100, max: 100, invert: true}, // max in milliseconds
  download: {hue: 300, max: 100e6, invert: false}, // max in bits per second
  upload: {hue: 200, max: 20e6, invert: false}, // max in bits per second
}
const measurementColorMinSaturation = 25

async function fetchMeasurements() {
  const sb = supabase.createClient(
    'https://xepxxvpbexkyxrwtrgqv.supabase.co',
    window.supabaseToken,
  )

  const {data, error} = await sb
    .from('measurements')
    .select('*, cells(*), locations(*), upload_download_data(*), latency_data(*)')

  if (error) {
    if (typeof error === 'object' && error && error.message === 'Invalid API key') {
      console.log('invalid supabase token -- clearing and reloading')
      localStorage.clear()
      window.location.reload()
    } else {
      throw Error(`error fetching measurements: ${JSON.stringify(error)}`)
    }
  }

  return data
}

function measurementToFeature(m) {
  const start = m.locations[0]
  const end = m.locations[1] ?? m.locations[0]

  if (!start || !end) {
    throw Error(`measurement ${m.id} missing location`)
  }

  const line = turf.lineString([[start.lon, start.lat], [end.lon, end.lat]])
  const feature = turf.center(line)
  feature.properties.measurement = m
  feature.properties.color = calcMeasurementColor(m)
  return feature
}

function calcMeasurementColor(m) {
  let value
  switch (m.type) {
    case 'latency':
      // value as milliseconds, higher is worse
      value = m.latency_data.rtt * 1e-3
      break
    case 'download':
    case 'upload':
      // value as bits per second, higher is better
      value = calcBPS(m.upload_download_data.bytes, m.upload_download_data.duration)
      break
    default:
      throw Error(`measurement ${m.id} has invalid type: ${m.type}`)
  }

  const {hue, max, invert} = measurementColors[m.type]

  let saturation = (100 - measurementColorMinSaturation) * Math.min(value / max, 1)
  if (invert) {
    saturation = (100 - measurementColorMinSaturation) - saturation
  }
  saturation += measurementColorMinSaturation

  return `hsl(${hue}, ${saturation}%, 50%)`
}

function calcBPS(bytes, micros) {
  if (micros === 0) {
    return 0
  }

  return 8 * bytes / (micros * 1e-6)
}

function measurementToHtml(m) {
  let html = `<strong>ID</strong>: ${m.id}`
  html += `<br/><strong>Date/Time</strong>: ${new Date(m.timestamp).toLocaleString()}`
  html += `<br/><strong>Success</strong>: ${m.success}`
  html += `<br/><strong>Provider</strong>: ${m.provider}`
  html += `<br/><strong>Type</strong>: ${m.type}`

  switch (m.type) {
    case 'latency':
      html += `<br/><strong>RTT</strong>: ${(m.latency_data.rtt * 1e-3).toFixed(2)} ms`
      html += `<br/><strong>Jitter</strong>: ${(m.latency_data.jitter * 1e-3).toFixed(2)} ms`
      html += `<br/><strong>Received/Sent</strong>: ${m.latency_data.received}/${m.latency_data.sent}`
      html += `<br/><strong>Duration</strong>: ${(m.duration * 1e-6).toFixed(2)} s`
      break
    case 'download':
    case 'upload':
      const mbps = calcBPS(m.upload_download_data.bytes, m.upload_download_data.duration) * 1e-6
      html += `<br/><strong>Speed</strong>: ${mbps.toFixed(2)} Mbps`
      html += `<br/><strong>Duration</strong>: ${(m.upload_download_data.duration * 1e-6).toFixed(2)} s`
      break
    default:
      throw Error(`measurement ${m.id} has invalid type: ${m.type}`)
  }

  return html
}
