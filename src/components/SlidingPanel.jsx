// src/components/SlidingPanel.jsx
import React from 'react'
import '../style.css'
import { FaClock, FaDownload, FaUpload } from 'react-icons/fa'
import * as h3 from 'h3-js'

export default function SlidingPanel({ measurement, onClose }) {
  const dt = new Date(measurement?.timestamp || Date.now())
  const dateStr = dt.toLocaleDateString()
  const timeStr = dt.toLocaleTimeString()

  const loc0 = Array.isArray(measurement?.locations) && measurement.locations.length
    ? measurement.locations[0]
    : null
  const lat = Number(loc0?.lat ?? measurement?.lat ?? NaN)
  const lon = Number(loc0?.lon ?? measurement?.lon ?? NaN)

  const udRaw = measurement?.upload_download_data
  const ldRaw = measurement?.latency_data

  const asObj = (x) => {
    if (!x) return null
    if (Array.isArray(x)) return x[0] || null
    if (typeof x === 'object') return x
    return null
  }

  const ud = asObj(udRaw)
  const ld = asObj(ldRaw)

  const isUpload = String(measurement?.type || '').toLowerCase() === 'upload'
  const isDownload = String(measurement?.type || '').toLowerCase() === 'download'

  const pickTime = (row) => {
    const t = row?.timestamp || row?.created_on || row?.updated_on || null
    return t ? new Date(t).toLocaleTimeString() : '–'
  }

  const toMbps = (row) => {
    if (!row) return '–'
    const bps = Number(row.bits_per_second ?? row.bps ?? NaN)
    if (Number.isFinite(bps)) return (bps / 1e6).toFixed(2)
    const bytesPerSec = Number(row.application_bytes_per_sec ?? row.bytes_per_sec ?? NaN)
    if (Number.isFinite(bytesPerSec)) return ((8 * bytesPerSec) / 1e6).toFixed(2)
    const bytes = Number(row.application_bytes ?? row.bytes ?? NaN)
    const durUs = Number(row.duration ?? row.duration_us ?? NaN)
    if (Number.isFinite(bytes) && Number.isFinite(durUs) && durUs > 0) return ((8 * bytes) / (durUs * 1e-6) / 1e6).toFixed(2)
    const durMs = Number(row.duration_ms ?? NaN)
    if (Number.isFinite(bytes) && Number.isFinite(durMs) && durMs > 0) return ((8 * bytes) / (durMs * 1e-3) / 1e6).toFixed(2)
    return '–'
  }

  const latencyMs = (() => {
    if (!ld) return '–'
    const rttUs = Number(ld.rtt ?? ld.rtt_us ?? ld.ping_us ?? NaN)
    if (Number.isFinite(rttUs)) return (rttUs / 1000).toFixed(2)
    const rttMs = Number(ld.ping_ms ?? NaN)
    if (Number.isFinite(rttMs)) return rttMs.toFixed(2)
    return '–'
  })()

  const uploadMbps = isUpload ? toMbps(ud) : '–'
  const downloadMbps = isDownload ? toMbps(ud) : '–'

  const uploadTime = isUpload ? pickTime(ud) : '–'
  const downloadTime = isDownload ? pickTime(ud) : '–'
  const latencyTime = ld ? pickTime(ld) : '–'

  const typeLabel = typeof measurement?.type === 'string'
    ? measurement.type.charAt(0).toUpperCase() + measurement.type.slice(1)
    : '–'

  const techFrom = (row) => row?.network_generation || row?.networkGeneration || '–'
  const roamFrom = (row) => row?.network_roaming_flag ? 'Yes' : (row?.networkRoamingFlag ? 'Yes' : 'No')

  const hexIdx = Number.isFinite(lat) && Number.isFinite(lon) ? h3.latLngToCell(lat, lon, 8) : ''
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  const [place, setPlace] = React.useState('')
  React.useEffect(() => {
    let ac = new AbortController()
    async function run() {
      try {
        if (!token || !Number.isFinite(lat) || !Number.isFinite(lon)) { setPlace(''); return }
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${token}&limit=1`
        const resp = await fetch(url, { signal: ac.signal })
        const json = await resp.json()
        const name = json?.features?.[0]?.place_name || ''
        setPlace(name)
      } catch {}
    }
    run()
    return () => ac.abort()
  }, [lat, lon, token])

  const openHexSheet = async (idx) => {
    if (!idx) return;
    const items =
      cellItemsRef.current.get(idx) ||
      (rowsFiltered || []).filter(r => h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) === idx);

    const payload = buildSheetData(idx, items);

    // Set panel immediately (without place), then enrich with place name
    setPanelData(payload);
    setPanelOpen(true);
    setSelectedIdx(idx);
    updateSelectionOverlay(mapRef.current, idx);

    try {
      const place = await reverseGeocode(payload.center);
      if (place) setPanelData(prev => prev ? { ...prev, place } : prev);
    } catch {}
  };

  return (
    <div className="sliding-panel open">
      <button className="panel-close" onClick={onClose}>×</button>
      <div className="panel-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontWeight: 700 }}>
            {place || 'Selected location'} {hexIdx ? <span style={{ color: '#6b7280', fontSize: 12 }}>(Hex {hexIdx})</span> : null}
          </div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            {measurement?.count
              ? `${measurement.count} measurement${measurement.count === 1 ? '' : 's'}`
              : ''}
          </div>
        </div>
        <div className="header-time">{timeStr}</div>
      </div>


      <hr/>

      <div className="panel-section">
        <p><strong>Carrier:</strong> {measurement?.provider || '–'}</p>
        <p><strong>Type:</strong> {typeLabel}</p>
        <p><strong>Location:</strong> {Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '–'}</p>
      </div>
      <hr/>

      {ld && (
        <>
          <div className="panel-section">
            <div className="metric-title"><FaClock /> Latency</div>
            <div className="metric-value">{latencyMs} ms</div>
            <p><strong>Measured At:</strong> {latencyTime}</p>
            <p><strong>Technology:</strong> {techFrom(ld)}</p>
            <p><strong>Roaming:</strong> {roamFrom(ld)}</p>
          </div>
          <hr/>
        </>
      )}

      {isDownload && ud && (
        <>
          <div className="panel-section">
            <div className="metric-title"><FaDownload /> Download</div>
            <div className="metric-value">{downloadMbps} Mbps</div>
            <p><strong>Measured At:</strong> {downloadTime}</p>
            <p><strong>Technology:</strong> {techFrom(ud)}</p>
            <p><strong>Roaming:</strong> {roamFrom(ud)}</p>
          </div>
          <hr/>
        </>
      )}

      {isUpload && ud && (
        <div className="panel-section">
          <div className="metric-title"><FaUpload /> Upload</div>
          <div className="metric-value">{uploadMbps} Mbps</div>
          <p><strong>Measured At:</strong> {uploadTime}</p>
          <p><strong>Technology:</strong> {techFrom(ud)}</p>
          <p><strong>Roaming:</strong> {roamFrom(ud)}</p>
        </div>
      )}
    </div>
  )
}
