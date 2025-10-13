// src/components/SlidingPanel.jsx

import React from 'react'
import '../style.css'
import { FaClock, FaDownload, FaUpload } from 'react-icons/fa'

export default function SlidingPanel({ measurement, onClose }) {
  // ─── DEBUG ─────────────────────────────────────────────────────────────
  console.group('[SlidingPanel] incoming measurement:')
  console.log(measurement)
  console.log('→ measurement.type:', measurement.type)
  console.log('→ upload_download_data:', measurement.upload_download_data)
  console.log('→ latency_data:', measurement.latency_data)
  console.groupEnd()
  // ────────────────────────────────────────────────────────────────────────

  // Parse timestamp
  const dt      = new Date(measurement.timestamp || Date.now())
  const dateStr = dt.toLocaleDateString()
  const timeStr = dt.toLocaleTimeString()

  // Determine if this is an upload vs download measurement
  const isUpload   = measurement.type === 'upload'
  const isDownload = measurement.type === 'download'

  // upload_download_data is a single object
  const rawUD      = measurement.upload_download_data || {}
  const uploadRow   = isUpload   ? rawUD : null
  const downloadRow = isDownload ? rawUD : null

  // Format measured-at times
  const uploadTime   = uploadRow   && uploadRow.timestamp   ? new Date(uploadRow.timestamp).toLocaleTimeString()   : '–'
  const downloadTime = downloadRow && downloadRow.timestamp ? new Date(downloadRow.timestamp).toLocaleTimeString() : '–'

  // Latency data (also a single object, or null)
  const latencyRow  = measurement.latency_data && typeof measurement.latency_data === 'object'
    ? measurement.latency_data
    : null
  const hasLatency  = !!latencyRow
  const latencyMs   = hasLatency ? (latencyRow.rtt * 1e-3).toFixed(2) : '–'
  const latencyTime = hasLatency && latencyRow.timestamp
    ? new Date(latencyRow.timestamp).toLocaleTimeString()
    : '–'

  // First location
  const loc = (measurement.locations && measurement.locations[0]) || {}

  // Compute speeds
  const downloadMbps = downloadRow && downloadRow.bytes && downloadRow.duration
    ? ((8 * downloadRow.bytes) / (downloadRow.duration * 1e-6) * 1e-6).toFixed(2)
    : '–'
  const uploadMbps   = uploadRow   && uploadRow.bytes   && uploadRow.duration
    ? ((8 * uploadRow.bytes)   / (uploadRow.duration   * 1e-6) * 1e-6).toFixed(2)
    : '–'

  // Safe type‐label (e.g. “Upload” / “Download” / “Latency”)
  const typeLabel = typeof measurement.type === 'string'
    ? measurement.type.charAt(0).toUpperCase() + measurement.type.slice(1)
    : '–'

  return (
    <div className="sliding-panel open">
      <button className="panel-close" onClick={onClose}>×</button>

      {/* HEADER */}
      <div className="panel-header">
        <div className="header-date">{dateStr}</div>
        <div className="header-time">{timeStr}</div>
      </div>
      <hr/>

      {/* CARRIER / TYPE / UPLOAD TIME */}
      <div className="panel-section">
        <p><strong>Carrier:</strong> {measurement.provider || '–'}</p>
        <p><strong>Type:</strong> {typeLabel}</p>
        <p><strong>Upload Time:</strong> {uploadTime}</p>
      </div>
      <hr/>

      {/* LATENCY */}
      {hasLatency && (
        <>
          <div className="panel-section">
            <div className="metric-title"><FaClock /> Latency</div>
            <div className="metric-value">{latencyMs} ms</div>
            <p><strong>Measured At:</strong> {latencyTime}</p>
            <p><strong>Location:</strong> {loc.lat?.toFixed(4)}, {loc.lon?.toFixed(4)}</p>
            <p><strong>Technology:</strong> {latencyRow.network_generation || '–'}</p>
            <p><strong>Roaming:</strong> {latencyRow.network_roaming_flag ? 'Yes' : 'No'}</p>
          </div>
          <hr/>
        </>
      )}

      {/* DOWNLOAD */}
      {downloadRow && (
        <>
          <div className="panel-section">
            <div className="metric-title"><FaDownload /> Download</div>
            <div className="metric-value">{downloadMbps} Mbps</div>
            <p><strong>Measured At:</strong> {downloadTime}</p>
            <p><strong>Location:</strong> {loc.lat?.toFixed(4)}, {loc.lon?.toFixed(4)}</p>
            <p><strong>Technology:</strong> {downloadRow.network_generation || '–'}</p>
            <p><strong>Roaming:</strong> {downloadRow.network_roaming_flag ? 'Yes' : 'No'}</p>
          </div>
          <hr/>
        </>
      )}

      {/* UPLOAD */}
      {uploadRow && (
        <div className="panel-section">
          <div className="metric-title"><FaUpload /> Upload</div>
          <div className="metric-value">{uploadMbps} Mbps</div>
          <p><strong>Measured At:</strong> {uploadTime}</p>
          <p><strong>Location:</strong> {loc.lat?.toFixed(4)}, {loc.lon?.toFixed(4)}</p>
          <p><strong>Technology:</strong> {uploadRow.network_generation || '–'}</p>
          <p><strong>Roaming:</strong> {uploadRow.network_roaming_flag ? 'Yes' : 'No'}</p>
        </div>
      )}
    </div>
  )
}
