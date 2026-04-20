const PROVIDER_BUCKET_ALIASES = {
  'AT&T': ['at&t', 'att'],
  'T-Mobile': ['t-mobile', 'tmobile', 't-mobile spacex'],
  'Verizon': ['verizon', 'verizon wireless']
}

function uniq(items) {
  return [...new Set((items || []).filter((item) => item != null && item !== ''))]
}

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function expandBbox(bbox, padFraction = 0.3) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null
  const [westRaw, southRaw, eastRaw, northRaw] = bbox.map(Number)
  if (![westRaw, southRaw, eastRaw, northRaw].every(Number.isFinite)) return null

  const width = Math.max(0, eastRaw - westRaw)
  const height = Math.max(0, northRaw - southRaw)
  const xPad = width * Math.max(0, Number(padFraction) || 0)
  const yPad = height * Math.max(0, Number(padFraction) || 0)

  return [
    clamp(westRaw - xPad, -180, 180),
    clamp(southRaw - yPad, -90, 90),
    clamp(eastRaw + xPad, -180, 180),
    clamp(northRaw + yPad, -90, 90)
  ]
}

function bboxContains(outer, inner) {
  if (!Array.isArray(outer) || !Array.isArray(inner) || outer.length !== 4 || inner.length !== 4) return false
  return outer[0] <= inner[0] &&
    outer[1] <= inner[1] &&
    outer[2] >= inner[2] &&
    outer[3] >= inner[3]
}

function aggNums(arr) {
  const vals = arr.filter(v => Number.isFinite(Number(v))).map(Number)
  if (!vals.length) return { avg: null, min: null, max: null }
  const sum = vals.reduce((a, b) => a + b, 0)
  return { avg: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals) }
}

function normalizeProviderBucket(provider) {
  const p = String(provider || '').toLowerCase()
  if (p.includes('att') || p.includes('at&t')) return 'AT&T'
  if (p.includes('t-mobile') || p.includes('tmobile')) return 'T-Mobile'
  if (p.includes('verizon')) return 'Verizon'
  return 'Other'
}

function buildTypeFilterPlans(typeFilters) {
  if (typeFilters?.all) return [{}]

  const enabled = ['upload', 'download', 'latency'].filter((key) => typeFilters?.[key]?.enabled)
  if (!enabled.length) return [{}]

  const typeParamKeys = {
    upload: ['ul_min', 'ul_max'],
    download: ['dl_min', 'dl_max'],
    latency: ['lat_min', 'lat_max']
  }

  return enabled.map((key) => {
    const cfg = typeFilters?.[key] || {}
    const [minKey, maxKey] = typeParamKeys[key]
    const threshold = toFiniteNumber(cfg.threshold)

    if (cfg.mode === 'below' && threshold != null) {
      return { [maxKey]: threshold }
    }
    if (cfg.mode === 'above' && threshold != null) {
      return { [minKey]: threshold }
    }
    return { [minKey]: 0 }
  })
}

function buildPointQueryPlans({ bbox, limit, typeFilters, connTypes, providers, dateBounds }) {
  const base = { bbox, limit }

  const selectedConn = uniq(connTypes)
  if (selectedConn.length) base.conn = selectedConn.join(',')

  const selectedProviders = uniq(providers)
  if (selectedProviders.length && !selectedProviders.includes('Other')) {
    const rawProviders = uniq(selectedProviders.flatMap((bucket) => PROVIDER_BUCKET_ALIASES[bucket] || []))
    if (rawProviders.length) base.providers = rawProviders.join(',')
  }

  if (dateBounds?.start instanceof Date && !Number.isNaN(dateBounds.start.getTime())) {
    base.from = dateBounds.start.toISOString()
  }
  if (dateBounds?.end instanceof Date && !Number.isNaN(dateBounds.end.getTime())) {
    base.to = dateBounds.end.toISOString()
  }

  const plans = buildTypeFilterPlans(typeFilters).map((branch) => ({ ...base, ...branch }))
  return uniq(plans.map((plan) => JSON.stringify(plan))).map((plan) => JSON.parse(plan))
}

function buildPointQueryKey(requestPlans) {
  return JSON.stringify((requestPlans || []).map((plan) => {
    const { bbox, ...rest } = plan || {}
    return rest
  }))
}

function shouldReuseViewportData({
  visibleBbox,
  coverageBbox,
  currentZoom,
  lastZoom,
  queryKey,
  lastQueryKey,
  zoomDeltaThreshold = 0.3
}) {
  if (!coverageBbox || !bboxContains(coverageBbox, visibleBbox)) return false
  if (queryKey !== lastQueryKey) return false

  const nextZoom = Number(currentZoom)
  const prevZoom = Number(lastZoom)
  if (Number.isFinite(nextZoom) && Number.isFinite(prevZoom) && Math.abs(nextZoom - prevZoom) >= zoomDeltaThreshold) {
    return false
  }

  return true
}

function extractStats(row) {
  const toNum = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const down =
    toNum(row?.tests?.download?.mbps) ??
    toNum(row?.stats?.down_mbps) ??
    toNum(row?.stats?.dl_mbps)

  const up =
    toNum(row?.tests?.upload?.mbps) ??
    toNum(row?.stats?.up_mbps) ??
    toNum(row?.stats?.ul_mbps)

  const ping =
    toNum(row?.tests?.latency?.ping_ms) ??
    toNum(row?.tests?.latency?.ping) ??
    toNum(row?.tests?.latency?.rtt_ms) ??
    toNum(row?.stats?.ping_ms) ??
    toNum(row?.stats?.rtt)

  const jitter =
    toNum(row?.tests?.latency?.jitter_ms) ??
    toNum(row?.stats?.jitter_ms) ??
    toNum(row?.stats?.jitter)

  const loss =
    toNum(row?.tests?.latency?.loss_pct) ??
    toNum(row?.stats?.loss_pct)

  return { down, up, ping, jitter, loss }
}

function inferKindFromStats(s) {
  const hasDown = s?.down != null
  const hasUp = s?.up != null
  const hasLat = s?.ping != null || s?.jitter != null || s?.loss != null
  if (hasLat && !hasDown && !hasUp) return 'latency'
  if (hasDown && !hasUp && !hasLat) return 'download'
  if (hasUp && !hasDown && !hasLat) return 'upload'
  return 'default'
}

function dominantTypeFromFilters(typeFilters) {
  if (typeFilters?.all) return null
  const enabled = ['upload', 'download', 'latency'].filter(k => typeFilters?.[k]?.enabled)
  if (enabled.length === 1) return enabled[0]
  return null
}

function dominantTypeOfItems(items, typeFilters) {
  const forced = dominantTypeFromFilters(typeFilters)
  if (forced) return forced
  const counts = { upload: 0, download: 0, latency: 0 }
  for (const it of items || []) {
    const s = it?.__stats || extractStats(it)
    const k = inferKindFromStats(s)
    if (k === 'upload') counts.upload++
    else if (k === 'download') counts.download++
    else if (k === 'latency') counts.latency++
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const [topType, topCount] = entries[0] || []
  if (!topCount) return 'default'
  return topType
}

function buildSheetData(hexIdx, itemsRaw, typeFilters) {
  const items = (itemsRaw || []).map(m => ({ ...m, __stats: m.__stats || extractStats(m) }))
  const downs = items.map(i => i.__stats.down)
  const ups = items.map(i => i.__stats.up)
  const pings = items.map(i => i.__stats.ping)
  const jits = items.map(i => i.__stats.jitter)
  const losses = items.map(i => i.__stats.loss)
  const summary = {
    count: items.length,
    down: aggNums(downs),
    up: aggNums(ups),
    ping: aggNums(pings),
    jitter: aggNums(jits),
    loss: aggNums(losses)
  }
  const domType = dominantTypeOfItems(items, typeFilters)
  return { hexIdx, summary, items, domType }
}

function pointRowKey(row) {
  if (row?.group_id) return `group:${row.group_id}`
  return JSON.stringify([
    row?.timestamp ?? '',
    row?.provider ?? '',
    row?.conn_tag ?? '',
    row?.center ?? null,
    row?.stats ?? null
  ])
}

function mapApiPointToRow(p) {
  const center = Array.isArray(p?.center) ? p.center : null
  const lon = center && center.length === 2 ? Number(center[0]) : NaN
  const lat = center && center.length === 2 ? Number(center[1]) : NaN

  const statsObj = (p?.stats && typeof p.stats === 'object') ? p.stats : {}

  const down = Number(statsObj.down_mbps ?? statsObj.dl_mbps)
  const up = Number(statsObj.up_mbps ?? statsObj.ul_mbps)
  const ping = Number(statsObj.ping_ms ?? statsObj.rtt_ms ?? statsObj.ping)
  const jit = Number(statsObj.jitter_ms)
  const loss = Number(statsObj.loss_pct)
  const latency = (Number.isFinite(ping) || Number.isFinite(jit) || Number.isFinite(loss))
    ? {
        ping_ms: Number.isFinite(ping) ? ping : null,
        ping: Number.isFinite(ping) ? ping : null,
        rtt_ms: Number.isFinite(ping) ? ping : null,
        jitter_ms: Number.isFinite(jit) ? jit : null,
        loss_pct: Number.isFinite(loss) ? loss : null,
      }
    : null

  const tests = {
    download: Number.isFinite(down) ? { mbps: down } : null,
    upload: Number.isFinite(up) ? { mbps: up } : null,
    latency,
  }

  const row = {
    id: p.group_id,
    group_id: p.group_id ?? null,
    provider: p.provider ?? null,
    timestamp: p.timestamp ?? null,
    conn_tag: p.conn_tag ?? 'Other',
    lat,
    lon,
    stats: statsObj,
    tests,
  }

  return {
    ...row,
    __stats: extractStats(row),
    __conn: row.conn_tag ?? 'Other',
    __providerBucket: normalizeProviderBucket(row.provider),
  }
}

export {
  bboxContains,
  buildPointQueryKey,
  PROVIDER_BUCKET_ALIASES,
  buildPointQueryPlans,
  buildSheetData,
  buildTypeFilterPlans,
  dominantTypeFromFilters,
  dominantTypeOfItems,
  expandBbox,
  extractStats,
  inferKindFromStats,
  mapApiPointToRow,
  normalizeProviderBucket,
  pointRowKey,
  shouldReuseViewportData
}
