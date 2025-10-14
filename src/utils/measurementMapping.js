export function rowsToPoints(rows) {
  const out = []
  for (const m of rows || []) {
    if (!m?.locations?.length) continue
    const loc = m.locations[m.locations.length - 1]
    const lat = Number(loc?.lat)
    const lon = Number(loc?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    out.push({ lat, lon, measurement: m })
  }
  return out
}
