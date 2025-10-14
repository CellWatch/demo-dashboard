// src/components/HexMap.jsx
import React, { useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as h3 from 'h3-js';
import { supabase } from '../utils/supabase';

const HEX_RES = 8;
const HEX_ZOOM_MIN = 9.0;
const HEX_ZOOM_MAX = 14.0;
const HEX_MAX_CELLS = 6000;

const PAGE_SIZE = 2000;
const MAX_PAGES = 20;
const MEAS_CHUNK = 500;

const TYPE_COLORS = {
  upload:   { badgeBg: '#ecfeff', badgeText: '#0e7490', tintBg: '#f0fdff', tintBorder: '#bae6fd' },
  download: { badgeBg: '#f0fdf4', badgeText: '#166534', tintBg: '#f6fdf7', tintBorder: '#bbf7d0' },
  latency:  { badgeBg: '#fefce8', badgeText: '#92400e', tintBg: '#fffdea', tintBorder: '#fde68a' },
  default:  { badgeBg: '#eef2ff', badgeText: '#3730a3', tintBg: '#f8fafc', tintBorder: '#e2e8f0' },
};

function colorsForType(type) {
  return TYPE_COLORS[(type || '').toLowerCase()] || TYPE_COLORS.default;
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

function safeSetGeoJSON(map, sourceId, fc) {
  if (!map || !map.style || typeof map.getSource !== 'function') return;
  try {
    const s = map.getSource(sourceId);
    if (s && typeof s.setData === 'function') s.setData(fc);
  } catch {}
}

function setVis(map, layerId, visible) {
  if (!map || !map.getLayer || !map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
}

function applyModeVisibility(map, mode) {
  const showHex = mode === 'hex';
  const showDot = !showHex;
  setVis(map, 'hex-outline', showHex);
  setVis(map, 'hex-fill-active', showHex);
  setVis(map, 'hex-count-bubble', showHex);
  setVis(map, 'hex-count-label', showHex);
  setVis(map, 'clusters', showDot);
  setVis(map, 'cluster-count', showDot);
  setVis(map, 'unclustered-point', showDot);
}

function viewportLoops(map) {
  const b = map.getBounds();
  const west = b.getWest();
  const east = b.getEast();
  const south = b.getSouth();
  const north = b.getNorth();
  const makeLoop = (S, W, N, E) => ([[S, W], [N, W], [N, E], [S, E], [S, W]]);
  if (west <= east) return [makeLoop(south, west, north, east)];
  return [makeLoop(south, west, north, 180), makeLoop(south, -180, north, east)];
}

function polygonToCellsCompat(polygon, res) {
  if (typeof h3.polygonToCells === 'function') return h3.polygonToCells(polygon, res) || [];
  if (typeof h3.polyfill === 'function') return h3.polyfill(polygon, res) || [];
  return [];
}

function shouldRenderHexes(map) {
  const z = map.getZoom();
  return z >= HEX_ZOOM_MIN && z <= HEX_ZOOM_MAX;
}

function buildViewportHexOutlines(map) {
  const loops = viewportLoops(map);
  let cells = [];
  try {
    cells = loops.flatMap(lp => polygonToCellsCompat([lp], HEX_RES));
  } catch {
    cells = [];
  }
  if (cells.length > HEX_MAX_CELLS) {
    return { ...emptyFC(), _cells: [] };
  }
  const features = [];
  for (const idx of cells) {
    const ring = h3.cellToBoundary(idx, true); // [lng,lat]
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
      properties: { idx },
    });
  }
  return { type: 'FeatureCollection', features, _cells: cells };
}

function fmt(n, d = 0) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(d);
}

function parseMaybeJSON(x) {
  if (!x) return null;
  if (typeof x === 'object') return x;
  if (typeof x === 'string') {
    try { return JSON.parse(x); } catch { return null; }
  }
  return null;
}

const normLng = (lng) => ((Number(lng) + 180) % 360 + 360) % 360 - 180;

function toNum(x) {
  if (x == null) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string') {
    const m = x.match(/-?\d+(\.\d+)?/g);
    return m ? Number(m[0]) : null;
  }
  return null;
}

const arrify = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(v => v && typeof v === 'object');
  if (typeof val === 'object') return Object.values(val).filter(v => v && typeof v === 'object');
  return [];
};

function normalizeLatencyRow(l) {
  if (!l) return { pingMs: null, jitterMs: null, lossPct: null, server: null, packetsSent: null, packetsRcvd: null };
  const rttUs = toNum(l.rtt) ?? toNum(l.rtt_us) ?? toNum(l.ping_us) ?? (toNum(l.ping_ms) != null ? toNum(l.ping_ms) * 1000 : null);
  const jitUs = toNum(l.jitter) ?? toNum(l.jitter_us) ?? (toNum(l.jitter_ms) != null ? toNum(l.jitter_ms) * 1000 : null);
  const sent = toNum(l.sent);
  const received = toNum(l.received);
  const lossPct = sent != null && received != null && sent > 0
    ? (100 * Math.max(0, sent - received) / sent)
    : (toNum(l.loss_pct) ?? toNum(l.lossPercent));
  const servers = Array.isArray(l.servers) ? l.servers : (typeof l.servers === 'string' ? [l.servers] : null);
  return {
    pingMs: rttUs != null ? rttUs * 1e-3 : null,
    jitterMs: jitUs != null ? jitUs * 1e-3 : null,
    lossPct: lossPct ?? null,
    server: servers && servers.length ? servers[0] : null,
    packetsSent: sent ?? null,
    packetsRcvd: received ?? null,
  };
}

function normalizeUpDownRow(r) {
  if (!r) return { mbps: null, durationSec: null, bytesMB: null, warmupSec: null, server: null };
  const bpsFromBpsField = toNum(r.bps) ?? toNum(r.bits_per_second);
  const bytesPerSec = toNum(r.bytes_per_sec) ?? toNum(r.application_bytes_per_sec);
  let mbps = null;
  if (bpsFromBpsField != null) {
    mbps = bpsFromBpsField / 1e6;
  } else if (bytesPerSec != null) {
    mbps = (8 * bytesPerSec) / 1e6;
  } else {
    const bytes = toNum(r.bytes) ?? toNum(r.application_bytes) ?? toNum(r.num_bytes);
    const durUs = toNum(r.duration) ?? toNum(r.duration_us) ?? (toNum(r.duration_ms) != null ? toNum(r.duration_ms) * 1000 : null);
    if (bytes != null && durUs != null && durUs > 0) {
      mbps = (8 * bytes) / (durUs * 1e-6) / 1e6;
    }
  }
  const durationSec =
    (toNum(r.duration) != null ? toNum(r.duration) * 1e-6 : null) ??
    (toNum(r.duration_us) != null ? toNum(r.duration_us) * 1e-6 : null) ??
    (toNum(r.duration_ms) != null ? toNum(r.duration_ms) * 1e-3 : null);
  const bytes = toNum(r.bytes) ?? toNum(r.application_bytes) ?? toNum(r.num_bytes);
  const bytesMB = bytes != null ? (bytes / 1e6) : null;
  const warmupUs = toNum(r.warmup_duration) ?? toNum(r.warmup_us);
  const warmupSec = warmupUs != null ? warmupUs * 1e-6 : null;
  const servers = Array.isArray(r.servers) ? r.servers : (typeof r.servers === 'string' ? [r.servers] : null);
  return {
    mbps: mbps ?? null,
    durationSec: durationSec ?? null,
    bytesMB: bytesMB ?? null,
    warmupSec: warmupSec ?? null,
    server: servers && servers.length ? servers[0] : null,
  };
}

function extractStats(meas) {
  const updown =
    meas?.upload_download_data ??
    meas?.uploadDownloadData ??
    meas?.upload_download_datas ??
    meas?.uploadDownloadDatas;
  const latency = meas?.latency_data ?? meas?.latencyData;
  let down = null, up = null, ping = null, jitter = null, loss = null;
  const meta = {
    kind: meas?.type || null,
    server: null,
    durationSec: null,
    bytesMB: null,
    warmupSec: null,
    packetsSent: null,
    packetsRcvd: null,
  };
  const t = (meas?.type || '').toLowerCase();
  if (t === 'latency') {
    const lArr = arrify(latency);
    const n = normalizeLatencyRow(lArr[0]);
    ping = n.pingMs; jitter = n.jitterMs; loss = n.lossPct;
    meta.server = n.server;
    meta.packetsSent = n.packetsSent;
    meta.packetsRcvd = n.packetsRcvd;
  } else if (t === 'upload') {
    const arr = arrify(updown);
    const n = normalizeUpDownRow(arr[0]);
    up = n.mbps;
    meta.server = n.server;
    meta.durationSec = n.durationSec;
    meta.bytesMB = n.bytesMB;
    meta.warmupSec = n.warmupSec;
  } else if (t === 'download' || t === 'down') {
    const arr = arrify(updown);
    const n = normalizeUpDownRow(arr[0]);
    down = n.mbps;
    meta.server = n.server;
    meta.durationSec = n.durationSec;
    meta.bytesMB = n.bytesMB;
    meta.warmupSec = n.warmupSec;
  } else {
    const extra = parseMaybeJSON(meas?.extra_data) || parseMaybeJSON(meas?.extraData) || {};
    if (extra && typeof extra === 'object') {
      const norm = (k) => k.toLowerCase().replace(/[^a-z]/g, '');
      const entries = Object.entries(extra);
      const getBy = (want) => {
        const kv = entries.find(([k]) => norm(k).includes(want));
        return kv ? toNum(kv[1]) : null;
      };
      down   = getBy('download') ?? getBy('down') ?? down;
      up     = getBy('upload')   ?? getBy('up')   ?? up;
      ping   = getBy('ping')     ?? getBy('latency') ?? ping;
      jitter = getBy('jitter')   ?? jitter;
      loss   = getBy('loss')     ?? getBy('packetloss') ?? loss;
    }
  }
  return { down, up, ping, jitter, loss, meta };
}

function aggNums(arr) {
  const vals = arr.filter(v => Number.isFinite(Number(v))).map(Number);
  if (!vals.length) return { avg: null, min: null, max: null };
  const sum = vals.reduce((a,b)=>a+b,0);
  return { avg: sum/vals.length, min: Math.min(...vals), max: Math.max(...vals) };
}

function buildSheetData(hexIdx, itemsRaw) {
  const items = (itemsRaw || []).map(m => ({ ...m, __stats: extractStats(m) }));
  const downs = items.map(i => i.__stats.down);
  const ups   = items.map(i => i.__stats.up);
  const pings = items.map(i => i.__stats.ping);
  const jits  = items.map(i => i.__stats.jitter);
  const losses= items.map(i => i.__stats.loss);
  const summary = {
    count: items.length,
    down: aggNums(downs),
    up:   aggNums(ups),
    ping: aggNums(pings),
    jitter: aggNums(jits),
    loss: aggNums(losses),
  };
  return { hexIdx, summary, items };
}

/* ---------------- Bottom Sheet with Sort ---------------- */

function BottomSheet({ open, onClose, data }) {
  if (!open || !data) return null;
  const { hexIdx, summary, items } = data;

  const [sortKey, setSortKey] = useState('time'); // 'time' | 'down' | 'up' | 'ping' | 'jitter' | 'loss'
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'

  const sortedItems = useMemo(() => {
    const val = (m, key) => {
      const s = m.__stats || {};
      if (key === 'time') return m?.timestamp ? new Date(m.timestamp).getTime() : -Infinity;
      if (key === 'down') return s.down ?? -Infinity;
      if (key === 'up') return s.up ?? -Infinity;
      if (key === 'ping') return s.ping ?? Infinity;     // lower is better
      if (key === 'jitter') return s.jitter ?? Infinity; // lower is better
      if (key === 'loss') return s.loss ?? Infinity;     // lower is better
      return 0;
    };

    const copy = [...(items || [])];
    copy.sort((a, b) => {
      const av = val(a, sortKey);
      const bv = val(b, sortKey);

      // Handle NaN/nulls consistently: push missing to the end
      const aMissing = av === Infinity || av === -Infinity || Number.isNaN(av);
      const bMissing = bv === Infinity || bv === -Infinity || Number.isNaN(bv);
      if (aMissing && !bMissing) return 1;
      if (!aMissing && bMissing) return -1;

      if (sortKey === 'ping' || sortKey === 'jitter' || sortKey === 'loss') {
        // ascending good by default; flip if desc
        return sortDir === 'asc' ? (av - bv) : (bv - av);
      } else {
        // time/down/up default to desc (newest/highest first)
        return sortDir === 'asc' ? (av - bv) : (bv - av);
      }
    });
    return copy;
  }, [items, sortKey, sortDir]);

  const sheet = {
    position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 16, maxHeight: '52vh', overflow: 'auto', zIndex: 10000,
    fontFamily: 'Inter, system-ui, Arial, sans-serif',
  };
  const pill = { width: 40, height: 4, background: '#e2e8f0', borderRadius: 2, margin: '0 auto 12px' };
  const headerRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 };
  const title = { fontSize: 14, color: '#334155' };
  const closeBtn = { border:'1px solid #e2e8f0', borderRadius:8, background:'#fff', padding:'6px 10px', cursor:'pointer' };

  const sortBar = {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px'
  };
  const select = { fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff' };
  const toggle = { fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' };

  const summaryGrid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, minmax(0,1fr))',
    gap: 8,
    margin: '8px 0 12px',
  };
  const sumCell = { background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px' };
  const sumLabel = { fontSize:11, color:'#64748b', marginBottom:4 };
  const sumVal = { fontSize:14, fontWeight:700, color: '#0f172a' };
  const sumSub = { fontSize:11, color:'#475569' };

  const list = { display: 'grid', gap: 10 };
  const row = { border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 };
  const when = { fontSize: 12, color: '#475569' };
  const subtle = { fontSize: 11, color: '#64748b', marginTop: 2 };
  const statsBox = { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' };

  const f = (x, d=1) => (x == null ? '—' : Number(x).toFixed(d));
  const hasNum = (x) => x != null && Number.isFinite(Number(x)) && Number(x) !== 0;

  function TypeBadge({ type }) {
    const c = colorsForType(type);
    return (
      <span style={{
        padding:'2px 6px', borderRadius:6, background:c.badgeBg, color:c.badgeText,
        fontSize:11, fontWeight:700
      }}>
        {(type || 'UNKNOWN').toUpperCase()}
      </span>
    );
  }

  function StatChip({ label, value, suffix, tint }) {
    const c = tint || TYPE_COLORS.default;
    return (
      <div style={{
        background: c.tintBg, border: `1px solid ${c.tintBorder}`, borderRadius: 8,
        padding: '6px 8px', textAlign: 'center', minWidth: 86
      }}>
        <div style={{ fontSize: 11, color:'#64748b' }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color:'#0f172a' }}>
          {value} {suffix ? <span style={{fontWeight:400}}>{suffix}</span> : null}
        </div>
      </div>
    );
  }

  const renderTypeSpecific = (m) => {
    const t = (m?.type || '').toLowerCase();
    const s = m.__stats || {};
    const meta = s.meta || {};
    const tint = colorsForType(t);

    if (t === 'latency') {
      return (
        <>
          <StatChip label="Ping"   value={f(s.ping, 0)}   suffix="ms" tint={tint} />
          <StatChip label="Jitter" value={f(s.jitter, 0)} suffix="ms" tint={tint} />
          <StatChip label="Loss"   value={f(s.loss, 1)}   suffix="%"  tint={tint} />
          {hasNum(meta.packetsSent) || hasNum(meta.packetsRcvd) ? (
            <StatChip label="Packets" value={`${f(meta.packetsSent,0)}/${f(meta.packetsRcvd,0)}`} tint={tint} />
          ) : null}
        </>
      );
    }
    if (t === 'upload') {
      return (
        <>
          <StatChip label="Up"       value={f(s.up, 1)}        suffix="Mbps" tint={tint} />
          {hasNum(meta.bytesMB)   ? <StatChip label="Size"     value={f(meta.bytesMB, 2)} suffix="MB" tint={tint} /> : null}
          {hasNum(meta.durationSec)? <StatChip label="Duration" value={f(meta.durationSec, 2)} suffix="s"  tint={tint} /> : null}
          {hasNum(meta.warmupSec) ? <StatChip label="Warmup"   value={f(meta.warmupSec, 2)} suffix="s"  tint={tint} /> : null}
        </>
      );
    }
    if (t === 'download' || t === 'down') {
      return (
        <>
          <StatChip label="Down"     value={f(s.down, 1)}      suffix="Mbps" tint={tint} />
          {hasNum(meta.bytesMB)   ? <StatChip label="Size"     value={f(meta.bytesMB, 2)} suffix="MB" tint={tint} /> : null}
          {hasNum(meta.durationSec)? <StatChip label="Duration" value={f(meta.durationSec, 2)} suffix="s"  tint={tint} /> : null}
          {hasNum(meta.warmupSec) ? <StatChip label="Warmup"   value={f(meta.warmupSec, 2)} suffix="s"  tint={tint} /> : null}
        </>
      );
    }
    return (
      <>
        <StatChip label="Down" value={f(s.down, 1)} suffix="Mbps" />
        <StatChip label="Up"   value={f(s.up, 1)}   suffix="Mbps" />
        <StatChip label="Ping" value={f(s.ping, 0)} suffix="ms" />
      </>
    );
  };

  return (
    <div style={sheet}>
      <div style={pill} />

      <div style={headerRow}>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={title}><strong>Hex {hexIdx}</strong> · {summary.count} measurement{summary.count===1?'':'s'}</div>
          <div style={sortBar}>
            <span style={{ fontSize: 12, color: '#475569' }}>Sort by</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              style={select}
            >
              <option value="time">Time</option>
              <option value="down">Down (Mbps)</option>
              <option value="up">Up (Mbps)</option>
              <option value="ping">Ping (ms)</option>
              <option value="jitter">Jitter (ms)</option>
              <option value="loss">Loss (%)</option>
            </select>
            <button
              style={toggle}
              onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              title="Toggle ascending/descending"
            >
              {sortDir === 'asc' ? 'Asc ↑' : 'Desc ↓'}
            </button>
          </div>
        </div>
        <button style={closeBtn} onClick={onClose}>Close</button>
      </div>

      <div style={summaryGrid}>
        <div style={sumCell}>
          <div style={sumLabel}>Down</div>
          <div style={sumVal}>{fmt(summary.down.avg,1)} Mbps</div>
          <div style={sumSub}>min {fmt(summary.down.min,1)} · max {fmt(summary.down.max,1)}</div>
        </div>
        <div style={sumCell}>
          <div style={sumLabel}>Up</div>
          <div style={sumVal}>{fmt(summary.up.avg,1)} Mbps</div>
          <div style={sumSub}>min {fmt(summary.up.min,1)} · max {fmt(summary.up.max,1)}</div>
        </div>
        <div style={sumCell}>
          <div style={sumLabel}>Ping</div>
          <div style={sumVal}>{fmt(summary.ping.avg,0)} ms</div>
          <div style={sumSub}>min {fmt(summary.ping.min,0)} · max {fmt(summary.ping.max,0)}</div>
        </div>
        <div style={sumCell}>
          <div style={sumLabel}>Jitter</div>
          <div style={sumVal}>{fmt(summary.jitter.avg,0)} ms</div>
          <div style={sumSub}>min {fmt(summary.jitter.min,0)} · max {fmt(summary.jitter.max,0)}</div>
        </div>
        <div style={sumCell}>
          <div style={sumLabel}>Loss</div>
          <div style={sumVal}>{fmt(summary.loss.avg,1)} %</div>
          <div style={sumSub}>min {fmt(summary.loss.min,1)} · max {fmt(summary.loss.max,1)}</div>
        </div>
      </div>

      {!sortedItems?.length && (
        <div style={{ color:'#64748b', fontSize:13 }}>
          No measurements in this hex (in the current viewport sample).
        </div>
      )}

      {!!sortedItems?.length && (
        <div style={list}>
          {sortedItems.map((m, i) => {
            const ts = m?.timestamp ? new Date(m.timestamp) : null;
            const tsStr = ts ? ts.toLocaleString() : '—';
            const key = `${m.id || m.measurement_id || 'm'}-${m.timestamp || i}-${m.loc_id || i}`;
            const type = (m?.type || '').toLowerCase();
            const serverShort = m.__stats?.meta?.server ? m.__stats.meta.server.split('.')[0] : null;

            return (
              <div key={key} style={row}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                      {m.provider || 'Measurement'}
                    </div>
                    <TypeBadge type={type} />
                  </div>
                  <div style={when}>{tsStr}</div>
                  {serverShort && (
                    <div style={subtle}>Server: {serverShort}</div>
                  )}
                </div>
                <div style={statsBox}>
                  {(() => {
                    const s = m.__stats || {};
                    if (type === 'latency') {
                      return (
                        <>
                          <StatChip label="Ping"   value={fmt(s.ping, 0)}   suffix="ms" tint={colorsForType(type)} />
                          <StatChip label="Jitter" value={fmt(s.jitter, 0)} suffix="ms" tint={colorsForType(type)} />
                          <StatChip label="Loss"   value={fmt(s.loss, 1)}   suffix="%"  tint={colorsForType(type)} />
                        </>
                      );
                    }
                    if (type === 'upload') {
                      return (
                        <>
                          <StatChip label="Up" value={fmt(s.up, 1)} suffix="Mbps" tint={colorsForType(type)} />
                        </>
                      );
                    }
                    if (type === 'download' || type === 'down') {
                      return (
                        <>
                          <StatChip label="Down" value={fmt(s.down, 1)} suffix="Mbps" tint={colorsForType(type)} />
                        </>
                      );
                    }
                    return (
                      <>
                        <StatChip label="Down" value={fmt(s.down, 1)} suffix="Mbps" />
                        <StatChip label="Up"   value={fmt(s.up, 1)}   suffix="Mbps" />
                        <StatChip label="Ping" value={fmt(s.ping, 0)} suffix="ms" />
                      </>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- data fetching (viewport) ---------------- */

async function fetchLocationsInBox({ south, west, north, east, pageSize = PAGE_SIZE, maxPages = MAX_PAGES }) {
  west = normLng(west);
  east = normLng(east);

  const runBox = async (W, E) => {
    const out = [];
    for (let page = 0; page < maxPages; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('locations')
        .select('id,measurement_id,lat,lon,timestamp')
        .gte('lat', south).lte('lat', north)
        .gte('lon', W).lte('lon', E)
        .order('timestamp', { ascending: false })
        .range(from, to);
      if (error) break;
      if (!data?.length) break;
      out.push(...data);
      if (data.length < pageSize) break;
    }
    return out;
  };

  if (west <= east) {
    return await runBox(west, east);
  }
  const left = await runBox(west, 180);
  const right = await runBox(-180, east);
  return [...left, ...right];
}

/** Fetch base measurements + child rows; stitch into a Map(id -> measurementWithChildren). */
async function fetchMeasurementsByIds(ids) {
  const measById = new Map();
  const uniq = Array.from(new Set(ids));

  const groupBy = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) {
      const k = r[key];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };

  for (let i = 0; i < uniq.length; i += MEAS_CHUNK) {
    const slice = uniq.slice(i, i + MEAS_CHUNK);

    const { data: measRows } = await supabase
      .from('measurements')
      .select('id, provider, type, timestamp, extra_data')
      .in('id', slice);
    for (const m of (measRows || [])) {
      measById.set(m.id, { ...m, upload_download_data: [], latency_data: [] });
    }

    const { data: upRows } = await supabase
      .from('upload_download_data')
      .select('id, measurement_id, warmup_duration, warmup_bytes, duration, bytes, servers, application_bytes, bytes_per_sec, application_bytes_per_sec, created_on, updated_on')
      .in('measurement_id', slice);
    const byMeasUp = groupBy(upRows || [], 'measurement_id');
    for (const [mid, rows] of byMeasUp.entries()) {
      const base = measById.get(mid);
      if (base) base.upload_download_data = rows;
    }

    const { data: latRows } = await supabase
      .from('latency_data')
      .select('id, measurement_id, rtt, jitter, sent, received, servers, created_on, updated_on')
      .in('measurement_id', slice);
    const byMeasLat = groupBy(latRows || [], 'measurement_id');
    for (const [mid, rows] of byMeasLat.entries()) {
      const base = measById.get(mid);
      if (base) base.latency_data = rows;
    }
  }

  return measById;
}

/** Fetch viewport rows and stitch measurement stats. */
async function fetchViewportRows(map) {
  const b = map.getBounds();
  const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();

  const locs = await fetchLocationsInBox({ south, west, north, east });
  if (!locs?.length) {
    return [];
  }

  const measMap = await fetchMeasurementsByIds(locs.map(l => l.measurement_id));

  const rows = locs.map(l => {
    const m = measMap.get(l.measurement_id) || { id: l.measurement_id, timestamp: l.timestamp };
    return {
      loc_id: l.id,
      id: m.id,
      timestamp: m.timestamp,
      provider: m.provider,
      type: m.type,
      upload_download_data: m.upload_download_data,
      latency_data: m.latency_data,
      extra_data: m.extra_data,
      lat: Number(l.lat),
      lon: Number(l.lon),
    };
  });

  return rows;
}

/* ---------------- component & rendering ---------------- */

function rowsToPointFeatures(rows) {
  const features = [];
  for (const r of rows || []) {
    const lat = Number(r?.lat);
    const lon = Number(r?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id: r.id,
        ts: r.timestamp,
        provider: r.provider,
        type: r.type,
        measurement: r,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export default function HexMap({ mode = 'hex' }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const [rows, setRows] = useState([]);
  const [mapReady, setMapReady] = useState(false);

  // bottom sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetData, setSheetData] = useState(null);

  // cache of items per cell from the latest draw
  const cellItemsRef = useRef(new Map());

  function aggregateIntoHexes(rowsArg, cellIdxsSet) {
    const counts = new Map();
    const itemsByCell = new Map();
    for (const r of rowsArg || []) {
      const lat = Number(r?.lat);
      const lon = Number(r?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const idx = h3.latLngToCell(lat, lon, HEX_RES);
      if (!cellIdxsSet.has(idx)) continue;
      counts.set(idx, (counts.get(idx) || 0) + 1);
      if (!itemsByCell.has(idx)) itemsByCell.set(idx, []);
      itemsByCell.get(idx).push(r);
    }

    const fillFeatures = [];
    const centerFeatures = [];
    for (const [idx, count] of counts.entries()) {
      if (count <= 0) continue;
      const ring = h3.cellToBoundary(idx, true);
      fillFeatures.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        properties: { idx, count },
      });
      const [latC, lngC] = h3.cellToLatLng(idx);
      centerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lngC, latC] },
        properties: { idx, count },
      });
    }

    return {
      fills: { type: 'FeatureCollection', features: fillFeatures },
      centers: { type: 'FeatureCollection', features: centerFeatures },
      itemsByCell,
    };
  }

  function redrawHexes(map, rowsLocal, modeLocal) {
    if (!shouldRenderHexes(map) || modeLocal !== 'hex') {
      safeSetGeoJSON(map, 'hexes',       emptyFC());
      safeSetGeoJSON(map, 'hex-fills',   emptyFC());
      safeSetGeoJSON(map, 'hex-centers', emptyFC());
      cellItemsRef.current = new Map();
      return;
    }

    const outlinesFC = buildViewportHexOutlines(map);
    safeSetGeoJSON(map, 'hexes', outlinesFC);

    const setOfCells = new Set(outlinesFC._cells || outlinesFC.features.map(f => f.properties.idx));
    const { fills, centers, itemsByCell } = aggregateIntoHexes(rowsLocal, setOfCells);
    safeSetGeoJSON(map, 'hex-fills',   fills);
    safeSetGeoJSON(map, 'hex-centers', centers);

    cellItemsRef.current = itemsByCell;
  }

  // -------- helper to open a hex's sheet
  const openHexSheet = (idx) => {
    if (!idx) return;
    const items =
      cellItemsRef.current.get(idx) ||
      (rows || []).filter(r => h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) === idx);
    const payload = buildSheetData(idx, items);
    setSheetData(payload);
    setSheetOpen(true);
  };

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-84.396, 33.777],
      zoom: 11,
    });
    mapRef.current = map;

    map.on('load', async () => {
      // disable accidental zooms
      map.doubleClickZoom.disable();

      // clustered points source
      map.addSource('points', {
        type: 'geojson',
        data: emptyFC(),
        cluster: true,
        clusterRadius: 42,
        clusterMaxZoom: 18,
      });

      // hex sources
      map.addSource('hexes',        { type: 'geojson', data: emptyFC() });
      map.addSource('hex-fills',    { type: 'geojson', data: emptyFC() });
      map.addSource('hex-centers',  { type: 'geojson', data: emptyFC() });

      // ---- DOT MODE LAYERS (clustered) ----
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'points',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#1f2937',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            3, [
              '*', 10,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.15,
                       50, 1.35,
                       100,1.6,
                       500,2.0
              ]
            ],
            8, [
              '*', 16,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.15,
                       50, 1.35,
                       100,1.6,
                       500,2.0
              ]
            ],
            12, [
              '*', 22,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.2,
                       50, 1.4,
                       100,1.7,
                       500,2.1
              ]
            ],
            16, [
              '*', 28,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.25,
                       50, 1.45,
                       100,1.8,
                       500,2.2
              ]
            ],
            20, [
              '*', 34,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.3,
                       50, 1.5,
                       100,1.9,
                       500,2.3
              ]
            ]
          ]
        }
      });

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'points',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['to-string', ['get', 'point_count']],
          'text-font': ['Inter Regular', 'Arial Unicode MS Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            3, [
              '*', 10,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.05,
                       50, 1.1,
                       100,1.2,
                       500,1.35
              ]
            ],
            8, [
              '*', 12,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.05,
                       50, 1.1,
                       100,1.25,
                       500,1.4
              ]
            ],
            12, [
              '*', 14,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.1,
                       50, 1.2,
                       100,1.3,
                       500,1.45
              ]
            ],
            16, [
              '*', 16,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.15,
                       50, 1.25,
                       100,1.35,
                       500,1.5
              ]
            ],
            20, [
              '*', 18,
              ['step', ['get', 'point_count'],
                1.0,   10, 1.2,
                       50, 1.3,
                       100,1.4,
                       500,1.6
              ]
            ]
          ],
          'text-allow-overlap': true
        },
        paint: { 'text-color': '#ffffff' }
      });

      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'points',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#374151',
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            3, 3,
            8, 4,
            12, 5,
            16, 6,
            20, 7
          ],
          'circle-opacity': 0.8,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff'
        }
      });

      // ---- HEX MODE LAYERS ----
      map.addLayer({
        id: 'hex-outline',
        type: 'line',
        source: 'hexes',
        paint: { 'line-color': '#0f766e', 'line-width': 1, 'line-opacity': 0.7 },
      });

      map.addLayer({
        id: 'hex-fill-active',
        type: 'fill',
        source: 'hex-fills',
        paint: { 'fill-color': '#A7F3D0', 'fill-opacity': 0.35 },
      });

      map.addLayer({
        id: 'hex-count-bubble',
        type: 'circle',
        source: 'hex-centers',
        paint: { 'circle-color': '#065f46', 'circle-radius': 11, 'circle-opacity': 0.95 },
      });

      map.addLayer({
        id: 'hex-count-label',
        type: 'symbol',
        source: 'hex-centers',
        layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 12, 'text-allow-overlap': true },
        paint: { 'text-color': '#FFFFFF' },
      });

      // initial data
      const initialRows = await fetchViewportRows(map);
      setRows(initialRows);
      safeSetGeoJSON(map, 'points', rowsToPointFeatures(initialRows));
      redrawHexes(map, initialRows, mode);
      applyModeVisibility(map, mode);

      // debounced refresh
      let raf = 0;
      const rafCancel = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
      const refresh = () => {
        rafCancel();
        raf = requestAnimationFrame(async () => {
          if (!map || !map.style) { raf = 0; return; }
          const latest = await fetchViewportRows(map);
          setRows(latest);
          safeSetGeoJSON(map, 'points', rowsToPointFeatures(latest));
          redrawHexes(map, latest, mode);
          raf = 0;
        });
      };
      map.on('moveend', refresh);
      map.on('zoomend', refresh);

      // cluster click -> open sheet for hex under cluster center (no zoom)
      map.on('click', 'clusters', (e) => {
        const f = e.features?.[0];
        if (!f?.geometry?.coordinates) return;
        const [lng, lat] = f.geometry.coordinates;
        const idx = h3.latLngToCell(lat, lng, HEX_RES);
        openHexSheet(idx);
      });

      // unclustered click -> open sheet for hex containing this point
      map.on('click', 'unclustered-point', (e) => {
        const f = e.features?.[0];
        if (!f?.geometry?.coordinates) return;
        const [lng, lat] = f.geometry.coordinates;
        const idx = h3.latLngToCell(lat, lng, HEX_RES);
        openHexSheet(idx);
      });

      // --- HEX CLICK -> open bottom sheet (fill, bubble, or label)
      const hexClick = (e) => {
        const f = e.features?.[0];
        const idx = f?.properties?.idx;
        if (idx) openHexSheet(idx);
      };
      map.on('click', 'hex-fill-active', hexClick);
      map.on('click', 'hex-count-bubble', hexClick);
      map.on('click', 'hex-count-label', hexClick);

      // cursors
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = ''; });

      map.on('mouseenter', 'hex-fill-active', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'hex-fill-active', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'hex-count-bubble', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'hex-count-bubble', () => { map.getCanvas().style.cursor = ''; });
      map.on('mouseenter', 'hex-count-label', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'hex-count-label', () => { map.getCanvas().style.cursor = ''; });

      setMapReady(true);

      // cleanup for this load scope
      return () => {
        try { map.off('moveend', refresh); } catch {}
        try { map.off('zoomend', refresh); } catch {}
        try { rafCancel(); } catch {}
      };
    });

    map.on('error', (e) => console.error('[Mapbox] error:', e?.error || e));

    return () => {
      // full unmount cleanup
      try { map.remove(); } catch {}
      mapRef.current = null;
      setMapReady(false);
      cellItemsRef.current = new Map();
    };
  }, [mode]);

  // initial probes (optional)
  useEffect(() => {
    (async () => {
      const r1 = await supabase.from('measurements').select('id', { count: 'exact', head: true });
      console.log('[probe] measurements count:', r1.count, 'error:', r1.error);
      const r3 = await supabase.from('locations').select('id,measurement_id,lat,lon').limit(1);
      console.log('[probe] locations one row:', r3.data?.[0], 'error:', r3.error);
    })();
  }, []);

  // react to rows refreshes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    safeSetGeoJSON(map, 'points', rowsToPointFeatures(rows));
    redrawHexes(map, rows, mode);
  }, [rows, mapReady, mode]);

  // visibility when mode prop changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyModeVisibility(map, mode);
  }, [mapReady, mode]);

  return (
    <>
      <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />
      <BottomSheet
        open={!!sheetOpen}
        data={sheetData}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
