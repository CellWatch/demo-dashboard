import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function SearchBar({ value, onChange, onPick, onPickHex }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)

  const token = import.meta.env.VITE_MAPBOX_TOKEN

  const style = useMemo(() => ({
    position: 'relative',
    width: 420,
    maxWidth: '50vw'
  }), [])

  const inputStyle = useMemo(() => ({
    width: '100%',
    border: '1px solid #d1d5db',
    borderRadius: 12,
    padding: '9px 12px',
    fontWeight: 700,
    fontSize: 13,
    outline: 'none'
  }), [])

  useEffect(() => {
    const onDoc = (e) => {
      if (!boxRef.current) return
      if (!boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    let abort = false
    const run = async () => {
      const q = (value || '').trim()
      if (!q.length || !token) {
        setItems([])
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=6&types=place,locality,neighborhood,poi,address,region,postcode`
        const resp = await fetch(url)
        const json = await resp.json()
        if (abort) return
        const feats = Array.isArray(json?.features) ? json.features : []
        const mapped = feats.map(f => ({
          id: f.id,
          label: f.place_name || f.text || '',
          center: Array.isArray(f.center) ? f.center : null
        })).filter(x => x.label)
        setItems(mapped)
        setOpen(true)
        setLoading(false)
      } catch {
        if (!abort) {
          setItems([])
          setLoading(false)
        }
      }
    }

    const t = setTimeout(run, 250)
    return () => { abort = true; clearTimeout(t) }
  }, [value, token])

  const onSelect = (it) => {
    setOpen(false)
    if (!it?.center?.length) return
    const [lng, lat] = it.center
    onPick?.({ lng, lat })
  }

  return (
    <div ref={boxRef} style={style}>
      <input
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={token ? 'Search places…' : 'Set VITE_MAPBOX_TOKEN to enable search'}
        style={inputStyle}
        onFocus={() => { if (items.length) setOpen(true) }}
      />

      {open && (items.length || loading) ? (
        <div style={{
          position: 'absolute',
          top: 44,
          left: 0,
          right: 0,
          background: '#FFFFFF',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          boxShadow: '0 10px 30px rgba(0,0,0,0.10)',
          overflow: 'hidden',
          zIndex: 10030
        }}>
          {loading ? (
            <div style={{ padding: 10, fontWeight: 800, fontSize: 12, color: '#6b7280' }}>Searching…</div>
          ) : items.map(it => (
            <button
              key={it.id}
              onClick={() => onSelect(it)}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: '#FFFFFF',
                padding: '10px 12px',
                cursor: 'pointer'
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 12, color: '#111827' }}>{it.label}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
