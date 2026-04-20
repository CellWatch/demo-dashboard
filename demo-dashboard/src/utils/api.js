export function buildQuery(params) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue
    const s = String(v)
    if (!s.length) continue
    sp.set(k, s)
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export async function apiGet(path, params, options = {}) {
  const base = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const url = `${base}${path}${buildQuery(params)}`
  const { signal } = options

  const headers = {}
  const secret = (import.meta.env.VITE_DASHBOARD_SECRET || '').trim()
  if (secret) headers['x-dashboard-secret'] = secret

  console.log('[apiGet] ->', { base, path, url, params, hasSecret: !!secret })

  const resp = await fetch(url, { headers, signal })
  const text = await resp.text()

  console.log('[apiGet] <-', { status: resp.status, ok: resp.ok, textPreview: (text || '').slice(0, 200) })

  let json = null
  try { json = text ? JSON.parse(text) : null } catch {}

  if (!resp.ok) {
    const msg = json?.error || json?.message || text || `HTTP ${resp.status}`
    throw new Error(msg)
  }
  return json
}
