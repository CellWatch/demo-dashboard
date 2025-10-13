// src/utils/measurementUtils.js
import { supabase } from './supabase'

// ---- Color scales & helpers -------------------------------------------------
export const measurementColors = {
  latency:  { hue: 100,  max: 100,     invert: true  },  // ms
  download: { hue: 300,  max: 100e6,   invert: false },  // bps
  upload:   { hue: 200,  max:  20e6,   invert: false },  // bps
}
export const measurementColorMinSaturation = 25

export function colorFromTypeValue(type, numericValue) {
  const cfg = measurementColors[type]
  if (!cfg) return 'hsl(0, 0%, 50%)'
  const base = measurementColorMinSaturation
  let sat = (100 - base) * Math.min((numericValue || 0) / cfg.max, 1)
  if (cfg.invert) sat = (100 - base) - sat
  sat += base
  return `hsl(${cfg.hue}, ${sat}%, 50%)`
}

// ---- Value extraction helpers -----------------------------------------------

export function calcBPS(bytes, micros) {
  if (!micros || !bytes) return 0
  return (8 * bytes) / (micros * 1e-6) // bits per second
}

export function extractNumericValueForColoring(m) {
  switch (m.type) {
    case 'latency': {
      let arr = []
      if (Array.isArray(m.latency_data)) arr = m.latency_data
      else if (m.latency_data && typeof m.latency_data === 'object') arr = Object.values(m.latency_data)
      const row = arr && arr[0]
      return row ? (row.rtt * 1e-3) : 0 // microseconds -> milliseconds
    }
    case 'download':
    case 'upload': {
      let ud = []
      if (Array.isArray(m.upload_download_data)) ud = m.upload_download_data
      else if (m.upload_download_data && typeof m.upload_download_data === 'object') ud = Object.values(m.upload_download_data)
      const row = ud.find(r => r && r.type === m.type)
      return row ? calcBPS(row.bytes, row.duration) : 0
    }
    default:
      return 0
  }
}

export function calcMeasurementColor(m) {
  const value = extractNumericValueForColoring(m)
  return colorFromTypeValue(m.type, value)
}

// ---- GeoJSON conversion -----------------------------------------------------

export function measurementToFeature(m) {
  if (!m.locations || m.locations.length === 0) return null
  const loc = m.locations[m.locations.length - 1]
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [loc.lon, loc.lat],
    },
    properties: {
      measurement: m,
      color: calcMeasurementColor(m),
    },
  }
}

export function measurementsToFeatureCollection(measurements) {
  return {
    type: 'FeatureCollection',
    features: measurements
      .map(measurementToFeature)
      .filter(Boolean),
  }
}

// ---- HTML popup rendering (optional) ---------------------------------------

export function measurementToHtml(m) {
  let html = `<strong>ID</strong>: ${m.id}`
  html += `<br/><strong>Date/Time</strong>: ${new Date(m.timestamp).toLocaleString()}`
  html += `<br/><strong>Success</strong>: ${m.success}`
  html += `<br/><strong>Provider</strong>: ${m.provider}`
  html += `<br/><strong>Type</strong>: ${m.type}`

  switch (m.type) {
    case 'latency': {
      let arr = []
      if (Array.isArray(m.latency_data)) arr = m.latency_data
      else if (m.latency_data && typeof m.latency_data === 'object') arr = Object.values(m.latency_data)
      const l = arr[0]
      if (l) {
        html += `<br/><strong>RTT</strong>: ${(l.rtt * 1e-3).toFixed(2)} ms`
        html += `<br/><strong>Jitter</strong>: ${(l.jitter * 1e-3).toFixed(2)} ms`
        html += `<br/><strong>Received/Sent</strong>: ${l.received}/${l.sent}`
        html += `<br/><strong>Duration</strong>: ${(l.duration * 1e-6).toFixed(2)} s`
      }
      break
    }
    case 'download':
    case 'upload': {
      let ud = []
      if (Array.isArray(m.upload_download_data)) ud = m.upload_download_data
      else if (m.upload_download_data && typeof m.upload_download_data === 'object') ud = Object.values(m.upload_download_data)
      const r = ud.find(x => x && x.type === m.type)
      if (r) {
        const mbps = calcBPS(r.bytes, r.duration) * 1e-6
        html += `<br/><strong>Speed</strong>: ${mbps.toFixed(2)} Mbps`
        html += `<br/><strong>Duration</strong>: ${(r.duration * 1e-6).toFixed(2)} s`
      }
      break
    }
  }
  return html
}

export async function fetchMeasurements() {
  const { data, error } = await supabase
    .from('measurements')
    .select(`
      *,
      cells(*),
      locations(*),
      upload_download_data(*),
      latency_data(*)
    `)
  if (error) throw error
  return data
}
