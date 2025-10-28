import React, { useEffect, useRef, useState } from 'react';

const ENTER = 13;
const UP = 38;
const DOWN = 40;
const ESC = 27;

const containerFloating = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 10005,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: 360,
  maxWidth: 'calc(100vw - 24px)',
  fontFamily: 'Inter, system-ui, Arial, sans-serif'
};

const containerInline = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: 260, 
  fontFamily: 'Inter, system-ui, Arial, sans-serif'
};

const inputStyle = {
  width: '100%',
  padding: '8px 10px', 
  border: '1px solid #d1d5db',
  borderRadius: 8,
  outline: 'none',
  background: '#fff',
  fontSize: 13,
  color: '#111827',
  boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
};


const listStyle = {
  width: '100%',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  overflow: 'hidden',
  boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
  position: 'absolute',
  top: '100%',
  left: 0
};

const itemStyle = (active) => ({
  padding: '10px 12px',
  cursor: 'pointer',
  background: active ? '#F3F4F6' : '#fff',
  color: '#111827',
  borderBottom: '1px solid #f3f4f6'
});

const spinner = (
  <div style={{ padding: 8, fontSize: 12, color: '#6b7280' }}>Searching…</div>
);

export default function SearchBar({
  onPick,
  onPickHex,
  getMapCenter,
  placeholder = 'Search place, address, lat,lon, or H3 index…',
  proximity = true,
  inline = false
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef(null);
  const controllerRef = useRef(null);

  const token = import.meta.env.VITE_MAPBOX_TOKEN;

  const isLikelyCoords = (s) => {
    if (!s) return false;
    const m = s.split(',').map(t => t.trim());
    if (m.length !== 2) return false;
    const a = Number(m[0]);
    const b = Number(m[1]);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 180 && Math.abs(b) <= 90;
  };

  const parseCoords = (s) => {
    const m = s.split(',').map(t => t.trim());
    let a = Number(m[0]);
    let b = Number(m[1]);
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lng: b, lat: a };
    return { lng: a, lat: b };
  };

  const isLikelyH3 = (s) => {
    const v = String(s || '').trim().toLowerCase();
    return /^[0-9a-f]+$/.test(v) && v.length >= 6 && v.length <= 20;
  };

  useEffect(() => {
    if (!q || !token) { setResults([]); setLoading(false); return; }

    if (isLikelyCoords(q)) {
      setResults([{ id: '__coords__', place_name: `Coordinates: ${q}`, center: parseCoords(q) }]);
      setLoading(false);
      return;
    }
    if (isLikelyH3(q)) {
      setResults([{ id: '__h3__', place_name: `H3 Index: ${q}`, center: null, h3index: q.trim() }]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (controllerRef.current) { try { controllerRef.current.abort(); } catch {} }
    const ac = new AbortController();
    controllerRef.current = ac;

    const run = async () => {
      try {
        const prox = (proximity && getMapCenter) ? getMapCenter() : null;
        const proxParam = prox ? `&proximity=${prox.lng},${prox.lat}` : '';
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&limit=6${proxParam}&types=place,address,poi,locality,neighborhood,region,postcode`;
        const resp = await fetch(url, { signal: ac.signal });
        const json = await resp.json();
        const feats = Array.isArray(json?.features) ? json.features : [];
        setResults(feats.map(f => ({
          id: f.id,
          place_name: f.place_name || f.text || 'Unknown place',
          center: { lng: f.center?.[0], lat: f.center?.[1] }
        })));
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('[SearchBar] geocode failed', e);
      } finally {
        setLoading(false);
      }
    };

    const t = setTimeout(run, 220);
    return () => clearTimeout(t);
  }, [q, token]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setResults([]);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const choose = (item) => {
    if (!item) return;
    if (item.id === '__coords__' && item.center) onPick?.({ ...item.center, label: item.place_name });
    else if (item.id === '__h3__' && item.h3index) onPickHex?.(item.h3index);
    else if (item.center) onPick?.({ ...item.center, label: item.place_name });
    setResults([]); setActiveIdx(-1);
  };

  const onKeyDown = (e) => {
    if (!results.length) return;
    if (e.keyCode === DOWN) { e.preventDefault(); setActiveIdx((i) => (i + 1) % results.length); }
    else if (e.keyCode === UP) { e.preventDefault(); setActiveIdx((i) => (i <= 0 ? results.length - 1 : i - 1)); }
    else if (e.keyCode === ENTER) { e.preventDefault(); choose(results[Math.max(0, activeIdx)]); }
    else if (e.keyCode === ESC) { setResults([]); setActiveIdx(-1); }
  };

  const containerStyle = inline ? containerInline : containerFloating;

  return (
    <div ref={wrapRef} style={containerStyle}>
      <div style={{ position: 'relative' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          style={inputStyle}
        />
        {(loading || results.length > 0) && (
          <div style={listStyle}>
            {loading ? spinner : (
              results.map((r, i) => (
                <div
                  key={r.id}
                  style={itemStyle(i === activeIdx)}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => choose(r)}
                  title={r.place_name}
                >
                  {r.place_name}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
