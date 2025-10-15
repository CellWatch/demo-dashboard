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

// ---- DEBUG SWITCHES ---------------------------------------------------------
const DEBUG_HEX = true;            // map/h3 logs
const DEBUG_HEX_FILTERS = true;    // filter diagnostics

// ---- console helpers ---------------------------------------------------------
const dlog  = (...a) => { if (DEBUG_HEX) console.log('[HexMap]', ...a); };
const dwarn = (...a) => { if (DEBUG_HEX) console.warn('[HexMap]', ...a); };
const derr  = (...a) => { if (DEBUG_HEX) console.error('[HexMap]', ...a); };

const flog  = (...a) => { if (DEBUG_HEX_FILTERS) console.log('[HexMap][filters]', ...a); };
// const fwarn = (...a) => { if (DEBUG_HEX_FILTERS) console.warn('[HexMap][filters]', ...a); };

if (typeof window !== 'undefined') window.__hexmap = window.__hexmap || {};

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
  if (!map) return;
  const src = map.getSource(sourceId);
  if (!src || typeof src.setData !== 'function') {
    dwarn('safeSetGeoJSON skipped: missing source', { sourceId, hasSrc: !!src, features: fc?.features?.length ?? 0 });
    return;
  }
  try { src.setData(fc); } catch (e) { derr('safeSetGeoJSON error', sourceId, e); }
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
  const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
  const makeLoop = (S, W, N, E) => ([[S, W], [N, W], [N, E], [S, E], [S, W]]);
  if (west <= east) return [makeLoop(south, west, north, east)];
  return [makeLoop(south, west, north, 180), makeLoop(south, -180, north, east)];
}

// --- H3 v4 compat ---
function polygonToCellsCompat(inputRing, res) {
  let ring = inputRing;
  if (Array.isArray(ring) && Array.isArray(ring[0]) && Array.isArray(ring[0][0])) ring = ring[0];
  if (!Array.isArray(ring)) return [];
  const toLatLng = (p) => {
    if (!p) return null;
    if (Array.isArray(p)) {
      const a = Number(p[0]), b = Number(p[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (Math.abs(a) <= 180 && Math.abs(b) <= 90 && (Math.abs(a) > 90 || Math.abs(b) > 90)) return [b, a];
      return [a, b];
    }
    if (typeof p === 'object') {
      if ('lat' in p && 'lng' in p) return [Number(p.lat), Number(p.lng)];
      if ('latitude' in p && 'longitude' in p) return [Number(p.latitude), Number(p.longitude)];
    }
    return null;
  };
  let ringLatLng = ring.map(toLatLng).filter(Boolean);
  if (ringLatLng.length < 3) return [];
  const [fLat, fLng] = ringLatLng[0];
  const [lLat, lLng] = ringLatLng[ringLatLng.length - 1];
  if (fLat !== lLat || fLng !== lLng) ringLatLng = [...ringLatLng, ringLatLng[0]];
  return h3.polygonToCells([ringLatLng], res) || [];
}

function shouldRenderHexes(map) {
  const z = map.getZoom();
  return z >= HEX_ZOOM_MIN && z <= HEX_ZOOM_MAX;
}

function buildViewportHexOutlines(map) {
  const loops = viewportLoops(map);
  let cells = [];
  try { cells = loops.flatMap(lp => polygonToCellsCompat(lp, HEX_RES)); } catch { cells = []; }
  const MAX = Math.max(HEX_MAX_CELLS, 20000);
  if (cells.length > MAX) return { ...emptyFC(), _cells: [] };
  const features = [];
  for (const idx of cells) {
    const ringLngLat = h3.cellToBoundary(idx, true);
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...ringLngLat, ringLngLat[0]]] }, properties: { idx } });
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
  if (typeof x === 'string') { try { return JSON.parse(x); } catch { return null; } }
  return null;
}

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
  const lossPct = sent != null && received != null && sent > 0 ? (100 * Math.max(0, sent - received) / sent) : (toNum(l.loss_pct) ?? toNum(l.lossPercent));
  const servers = Array.isArray(l.servers) ? l.servers : (typeof l.servers === 'string') ? [l.servers] : null;
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
  if (bpsFromBpsField != null) mbps = bpsFromBpsField / 1e6;
  else if (bytesPerSec != null) mbps = (8 * bytesPerSec) / 1e6;
  else {
    const bytes = toNum(r.bytes) ?? toNum(r.application_bytes) ?? toNum(r.num_bytes);
    const durUs = toNum(r.duration) ?? toNum(r.duration_us) ?? (toNum(r.duration_ms) != null ? toNum(r.duration_ms) * 1000 : null);
    if (bytes != null && durUs != null && durUs > 0) mbps = (8 * bytes) / (durUs * 1e-6) / 1e6;
  }
  const durationSec =
    (toNum(r.duration) != null ? toNum(r.duration) * 1e-6 : null) ??
    (toNum(r.duration_us) != null ? toNum(r.duration_us) * 1e-6 : null) ??
    (toNum(r.duration_ms) != null ? toNum(r.duration_ms) * 1e-3 : null);
  const bytes = toNum(r.bytes) ?? toNum(r.application_bytes) ?? toNum(r.num_bytes);
  const bytesMB = bytes != null ? (bytes / 1e6) : null;
  const warmupUs = toNum(r.warmup_duration) ?? toNum(r.warmup_us);
  const warmupSec = warmupUs != null ? warmupUs * 1e-6 : null;
  const servers = Array.isArray(r.servers) ? r.servers : (typeof r.servers === 'string') ? [r.servers] : null;
  return { mbps: mbps ?? null, durationSec: durationSec ?? null, bytesMB: bytesMB ?? null, warmupSec: warmupSec ?? null, server: servers && servers.length ? servers[0] : null };
}

function extractStats(meas) {
  const updown = meas?.upload_download_data ?? meas?.uploadDownloadData ?? meas?.upload_download_datas ?? meas?.uploadDownloadDatas;
  const latency = meas?.latency_data ?? meas?.latencyData;

  let down = null, up = null, ping = null, jitter = null, loss = null;
  const meta = { kind: meas?.type || null, server: null, durationSec: null, bytesMB: null, warmupSec: null, packetsSent: null, packetsRcvd: null };

  const t = (meas?.type || '').toLowerCase();

  if (t === 'latency') {
    const lArr = arrify(latency);
    const firstWithVals = lArr.find(x => toNum(x?.rtt) != null || toNum(x?.rtt_us) != null || toNum(x?.ping_us) != null || toNum(x?.ping_ms) != null) || lArr[0];
    const n = normalizeLatencyRow(firstWithVals);
    ping = n.pingMs; jitter = n.jitterMs; loss = n.lossPct; meta.server = n.server; meta.packetsSent = n.packetsSent; meta.packetsRcvd = n.packetsRcvd;
  } else if (t === 'upload') {
    const arr = arrify(updown);
    const firstWithVals = arr.find(x => toNum(x?.bps) != null || toNum(x?.bits_per_second) != null || toNum(x?.bytes_per_sec) != null || toNum(x?.application_bytes_per_sec) != null || (toNum(x?.bytes) != null && (toNum(x?.duration) != null || toNum(x?.duration_us) != null || toNum(x?.duration_ms) != null))) || arr[0];
    const n = normalizeUpDownRow(firstWithVals);
    up = n.mbps; meta.server = n.server; meta.durationSec = n.durationSec; meta.bytesMB = n.bytesMB; meta.warmupSec = n.warmupSec;
  } else if (t === 'download' || t === 'down') {
    const arr = arrify(updown);
    const firstWithVals = arr.find(x => toNum(x?.bps) != null || toNum(x?.bits_per_second) != null || toNum(x?.bytes_per_sec) != null || toNum(x?.application_bytes_per_sec) != null || (toNum(x?.bytes) != null && (toNum(x?.duration) != null || toNum(x?.duration_us) != null || toNum(x?.duration_ms) != null))) || arr[0];
    const n = normalizeUpDownRow(firstWithVals);
    down = n.mbps; meta.server = n.server; meta.durationSec = n.durationSec; meta.bytesMB = n.bytesMB; meta.warmupSec = n.warmupSec;
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
  const items = (itemsRaw || []).map(m => ({ ...m, __stats: m.__stats || extractStats(m) }));
  const downs = items.map(i => i.__stats.down);
  const ups   = items.map(i => i.__stats.up);
  const pings = items.map(i => i.__stats.ping);
  const jits  = items.map(i => i.__stats.jitter);
  const losses= items.map(i => i.__stats.loss);
  const summary = { count: items.length, down: aggNums(downs), up: aggNums(ups), ping: aggNums(pings), jitter: aggNums(jits), loss: aggNums(losses) };
  return { hexIdx, summary, items };
}

function rowsToPointFeatures(rows) {
  const features = [];
  for (const r of rows || []) {
    const lat = Number(r?.lat);
    const lon = Number(r?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id: r.id, ts: r.timestamp, provider: r.provider, type: r.type } });
  }
  return { type: 'FeatureCollection', features };
}

// --------------------------- data fetch --------------------------------------
async function fetchLocationsInBox({ south, west, north, east, pageSize = PAGE_SIZE, maxPages = MAX_PAGES }) {
  const runBox = async (W, E) => {
    const out = [];
    for (let page = 0; page < maxPages; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let resp;
      try {
        resp = await supabase.from('locations').select('id,measurement_id,lat,lon').gte('lat', south).lte('lat', north).gte('lon', W).lte('lon', E).range(from, to);
      } catch (e) { derr('[locations] fetch crashed:', e); break; }
      const { data, error } = resp || {};
      if (error) { derr('[locations] fetch error:', error); break; }
      if (!data?.length) break;
      out.push(...data);
      if (data.length < pageSize) break;
    }
    return out;
  };
  if (west <= east) return await runBox(west, east);
  const left = await runBox(west, 180);
  const right = await runBox(-180, east);
  return [...left, ...right];
}

async function fetchMeasurementsByIds(ids) {
  const measById = new Map();
  const uniq = Array.from(new Set(ids));

  const groupBy = (rows, key) => {
    const m = new Map();
    for (const r of rows || []) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  };

  for (let i = 0; i < uniq.length; i += MEAS_CHUNK) {
    const slice = uniq.slice(i, i + MEAS_CHUNK);

    let measRows, mErr;
    try {
      const resp = await supabase.from('measurements').select('id, provider, type, timestamp, extra_data').in('id', slice);
      measRows = resp?.data; mErr = resp?.error;
    } catch (e) { mErr = e; }
    if (mErr) derr('[measurements] fetch error:', mErr);

    for (const m of (measRows || [])) measById.set(m.id, { ...m, upload_download_data: [], latency_data: [] });

    let upRows, upErr;
    try {
      const resp = await supabase.from('upload_download_data').select('id, measurement_id, warmup_duration, warmup_bytes, duration, bytes, servers, application_bytes, bytes_per_sec, application_bytes_per_sec, created_on, updated_on').in('measurement_id', slice);
      upRows = resp?.data; upErr = resp?.error;
    } catch (e) { upErr = e; }
    if (upErr) derr('[upload_download_data] fetch error:', upErr);
    const byMeasUp = groupBy(upRows || [], 'measurement_id');
    for (const [mid, rows] of byMeasUp.entries()) { const base = measById.get(mid); if (base) base.upload_download_data = rows; }

    let latRows, latErr;
    try {
      const resp = await supabase.from('latency_data').select('id, measurement_id, rtt, jitter, sent, received, servers, created_on, updated_on').in('measurement_id', slice);
      latRows = resp?.data; latErr = resp?.error;
    } catch (e) { latErr = e; }
    if (latErr) derr('[latency_data] fetch error:', latErr);
    const byMeasLat = groupBy(latRows || [], 'measurement_id');
    for (const [mid, rows] of byMeasLat.entries()) { const base = measById.get(mid); if (base) base.latency_data = rows; }
  }

  return measById;
}

// ------------- provider / connection normalization ---------------------------
function normalizeProviderBucket(provider) {
  const p = String(provider || '').toLowerCase();
  if (p.includes('att') || p.includes('at&t')) return 'AT&T';
  if (p.includes('t-mobile') || p.includes('tmobile')) return 'T-Mobile';
  if (p.includes('verizon')) return 'Verizon';
  return 'Other';
}

function deriveConnType(row) {
  const extra = parseMaybeJSON(row?.extra_data) || {};
  const inStr = (...keys) => {
    for (const k of keys) {
      const v = extra?.[k];
      if (v == null) continue;
      const s = String(v).toLowerCase();
      if (s.includes('5g') || s.includes('nr')) return '5G';
      if (s.includes('lte') || s.includes('4g')) return '4G';
      if (s.includes('wifi') || s.includes('wi-fi')) return 'WiFi';
    }
    return null;
  };
  const keys = ['networkType','rat','cell_tech','generation','radio','conn','technology','network','access'];
  const fromExtra = inStr(...keys);
  if (fromExtra) return fromExtra;
  const t = String(row?.provider || '').toLowerCase();
  if (t.includes('wifi')) return 'WiFi';
  return 'Unknown';
}

async function fetchViewportRows(map) {
  const b = map.getBounds();
  const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
  const locs = await fetchLocationsInBox({ south, west, north, east });
  if (!locs?.length) return [];
  const measMap = await fetchMeasurementsByIds(locs.map(l => l.measurement_id));
  const rows = locs.map(l => {
    const m = measMap.get(l.measurement_id) || { id: l.measurement_id };
    const base = {
      loc_id: l.id,
      id: m.id,
      timestamp: m.timestamp || null,
      provider: m.provider || null,
      type: m.type || null,
      upload_download_data: m.upload_download_data,
      latency_data: m.latency_data,
      extra_data: m.extra_data,
      lat: Number(l.lat),
      lon: Number(l.lon),
    };
    const __stats = extractStats(base);
    const __conn = deriveConnType(base);
    const __providerBucket = normalizeProviderBucket(base.provider);
    return { ...base, __stats, __conn, __providerBucket };
  });
  flog('fetchViewportRows result', { count: rows.length, bbox: { west, east, south, north } });
  return rows;
}

// ----------------------------- BottomSheet -----------------------------------
function BottomSheet({ open, onClose, data }) {
  const [sortKey, setSortKey] = useState('time');
  const [sortDir, setSortDir] = useState('desc');

  const hexIdx  = data?.hexIdx ?? '';
  const summary = data?.summary ?? {
    count: 0,
    down:   { avg: null, min: null, max: null },
    up:     { avg: null, min: null, max: null },
    ping:   { avg: null, min: null, max: null },
    jitter: { avg: null, min: null, max: null },
    loss:   { avg: null, min: null, max: null },
  };
  const items = Array.isArray(data?.items) ? data.items : [];

  const sortedItems = useMemo(() => {
    const val = (m, key) => {
      const s = m.__stats || {};
      if (key === 'time')   return m?.timestamp ? new Date(m.timestamp).getTime() : -Infinity;
      if (key === 'down')   return s.down ?? -Infinity;
      if (key === 'up')     return s.up ?? -Infinity;
      if (key === 'ping')   return s.ping ?? Infinity;
      if (key === 'jitter') return s.jitter ?? Infinity;
      if (key === 'loss')   return s.loss ?? Infinity;
      return 0;
    };
    const copy = [...items];
    copy.sort((a, b) => {
      const av = val(a, sortKey);
      const bv = val(b, sortKey);
      const aMissing = av === Infinity || av === -Infinity || Number.isNaN(av);
      const bMissing = bv === Infinity || bv === -Infinity || Number.isNaN(bv);
      if (aMissing && !bMissing) return 1;
      if (!aMissing && bMissing) return -1;
      return sortDir === 'asc' ? (av - bv) : (bv - av);
    });
    return copy;
  }, [items, sortKey, sortDir]);

  if (!open) return null;

  // --- styles ---
  const sheet = {
    position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff',
    boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 0, /* <-- move padding into inner wrappers so sticky edge aligns cleanly */
    maxHeight: '52vh', overflow: 'auto', zIndex: 10000,
    fontFamily: 'Inter, system-ui, Arial, sans-serif',
  };

  // sticky wrapper that contains the title/sort + summary and stays fixed at top
  const stickyWrap = {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: '#fff',
    boxShadow: '0 6px 12px rgba(0,0,0,0.04)', // subtle separation from scrolled list
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 10, // a bit tighter above the list
  };

  const pill = { width: 40, height: 4, background: '#e2e8f0', borderRadius: 2, margin: '8px auto 12px' };
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
    margin: '8px 0 2px',
  };
  const sumCell = { background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px' };
  const sumLabel = { fontSize:11, color:'#64748b', marginBottom:4 };
  const sumVal = { fontSize:14, fontWeight:700, color: '#0f172a' };
  const sumSub = { fontSize:11, color:'#475569' };

  const listWrap = { padding: 16, paddingTop: 10 }; // list content area below sticky header
  const list = { display: 'grid', gap: 10 };
  const row = { border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8 };
  const when = { fontSize: 12, color: '#475569' };
  const subtle = { fontSize: 11, color: '#64748b', marginTop: 2 };
  const statsBox = { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' };

  const f = (x, d=1) => (x == null ? '—' : Number(x).toFixed(d));

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
          <StatChip label="Ping"   value={f(s.ping, 0)}   suffix="ms"  tint={tint} />
          <StatChip label="Jitter" value={f(s.jitter, 0)} suffix="ms"  tint={tint} />
          <StatChip label="Loss"   value={f(s.loss, 1)}   suffix="%"   tint={tint} />
          {(meta.packetsSent != null || meta.packetsRcvd != null) ? (
            <StatChip label="Packets" value={`${f(meta.packetsSent,0)}/${f(meta.packetsRcvd,0)}`} tint={tint} />
          ) : null}
        </>
      );
    }
    if (t === 'upload') {
      return (
        <>
          <StatChip label="Up" value={f(s.up, 1)} suffix="Mbps" tint={tint} />
          {meta.bytesMB != null    ? <StatChip label="Size"     value={f(meta.bytesMB, 2)}    suffix="MB" tint={tint} /> : null}
          {meta.durationSec != null? <StatChip label="Duration" value={f(meta.durationSec, 2)} suffix="s"  tint={tint} /> : null}
          {meta.warmupSec != null  ? <StatChip label="Warmup"   value={f(meta.warmupSec, 2)}   suffix="s"  tint={tint} /> : null}
        </>
      );
    }
    if (t === 'download' || t === 'down') {
      return (
        <>
          <StatChip label="Down" value={f(s.down, 1)} suffix="Mbps" tint={tint} />
          {meta.bytesMB != null    ? <StatChip label="Size"     value={f(meta.bytesMB, 2)}    suffix="MB" tint={tint} /> : null}
          {meta.durationSec != null? <StatChip label="Duration" value={f(meta.durationSec, 2)} suffix="s"  tint={tint} /> : null}
          {meta.warmupSec != null  ? <StatChip label="Warmup"   value={f(meta.warmupSec, 2)}   suffix="s"  tint={tint} /> : null}
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
      {/* Sticky block (title + sort + summary) */}
      <div style={stickyWrap}>
        <div style={pill} />
        <div style={headerRow}>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <div style={title}><strong>Hex {hexIdx}</strong> · {summary.count} measurement{summary.count===1?'':'s'}</div>
            <div style={sortBar}>
              <span style={{ fontSize: 12, color: '#475569' }}>Sort by</span>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={select}>
                <option value="time">Time</option>
                <option value="down">Down (Mbps)</option>
                <option value="up">Up (Mbps)</option>
                <option value="ping">Ping (ms)</option>
                <option value="jitter">Jitter (ms)</option>
                <option value="loss">Loss (%)</option>
              </select>
              <button style={toggle} onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}>
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
      </div>

      {/* Scrolling list content */}
      <div style={listWrap}>
        {!sortedItems.length && (
          <div style={{ color:'#64748b', fontSize:13 }}>
            No measurements in this hex (after filters).
          </div>
        )}

        {!!sortedItems.length && (
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
                    {serverShort && <div style={subtle}>Server: {serverShort}</div>}
                  </div>
                  <div style={statsBox}>{renderTypeSpecific(m)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------- MAP -----------------------------------------
export default function HexMap({
  mode = 'hex',
  // filters (props may come from App)
  typeFilters = { all: true, upload: { enabled: false, mode: 'all', threshold: '' }, download: { enabled: false, mode: 'all', threshold: '' }, latency: { enabled: false, mode: 'all', threshold: '' } },
  // hardcoded lists: default to ALL ON
  connTypes = ['4G','5G'],
  providers = ['AT&T','T-Mobile','Verizon','Other'],
  dateRange = { preset: 'all', start: '', end: '' },
  onPointClick = () => {},
}) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const [rowsAll, setRowsAll] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetData, setSheetData] = useState(null);
  const cellItemsRef = useRef(new Map());
  const rowsAllRef = useRef([]);
  const modeRef = useRef(mode);
  useEffect(()=>{ rowsAllRef.current = rowsAll; }, [rowsAll]);
  useEffect(()=>{ modeRef.current = mode; }, [mode]);

  // ---------- date bounds ----------
  const dateBounds = useMemo(() => {
    const now = new Date();
    let start = null, end = null;

    switch (dateRange?.preset) {
      case '1m': {
        start = new Date(now);
        start.setMonth(start.getMonth() - 1);
        break;
      }
      case '6m': {
        start = new Date(now);
        start.setMonth(start.getMonth() - 6);
        break;
      }
      case '1y': {
        start = new Date(now);
        start.setFullYear(start.getFullYear() - 1);
        break;
      }
      case 'custom': {
        start = dateRange?.start ? new Date(dateRange.start) : null;
        end   = dateRange?.end   ? new Date(dateRange.end)   : null;
        break;
      }
      case 'all':
      default: {
        start = null;
        end   = null;
        break;
      }
    }

    flog('dateBounds computed', {
      preset: dateRange?.preset,
      start: start?.toISOString?.() || null,
      end: end?.toISOString?.() || null,
    });

    return { start, end };
  }, [dateRange]);

  // ---------- filter passes + diagnostics ----------
  const typePass = (row) => {
    const t = String(row?.type || '').toLowerCase();
    if (typeFilters?.all) return true;
    const cfg = typeFilters || {};
    const check = (key) => {
      const f = cfg[key];
      if (!f?.enabled) return false;
      if (f.mode === 'all' || f.threshold === '' || f.threshold == null) return t === key;
      const thr = Number(f.threshold);
      if (!Number.isFinite(thr)) return t === key;
      if (key === 'upload') {
        const v = row.__stats?.up;
        if (v == null) return false;
        return f.mode === 'above' ? v >= thr : v <= thr;
      } else if (key === 'download') {
        const v = row.__stats?.down;
        if (v == null) return false;
        return f.mode === 'above' ? v >= thr : v <= thr;
      } else if (key === 'latency') {
        const v = row.__stats?.ping;
        if (v == null) return false;
        return f.mode === 'above' ? v >= thr : v <= thr;
      }
      return false;
    };
    return ['upload','download','latency'].some(k => check(k));
  };

  // treat BOTH 4G+5G selected as "no filtering"
  const connPass = (row) => {
    if (!connTypes?.length) return true;
    if (connTypes.includes('4G') && connTypes.includes('5G')) return true;

    const c = String(row?.__conn || '').toUpperCase();
    if (c.includes('LTE') || c.includes('4G')) return connTypes.includes('4G');
    if (c.includes('5G')) return connTypes.includes('5G');
    return false; // WiFi/Unknown => excluded only when we are filtering
  };

  const providerPass = (row) => {
    if (!providers?.length) return true;
    const bucket = row.__providerBucket || normalizeProviderBucket(row.provider);
    return providers.includes(bucket);
  };

  const datePass = (row) => {
    if (!dateBounds.start && !dateBounds.end) return true; // all time
    const ts = row?.timestamp ? new Date(row.timestamp) : null;
    if (!ts || isNaN(ts.getTime())) return false;
    if (dateBounds.start && ts < dateBounds.start) return false;
    if (dateBounds.end && ts > dateBounds.end) return false;
    return true;
  };

  // Helper: histograms & pretty counters
  function histBy(arr, keyFn) {
    const m = new Map();
    for (const x of arr) {
      const k = keyFn(x);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Object.fromEntries([...m.entries()].sort((a,b)=>b[1]-a[1]));
  }

  function logFilterSummary(before, after, drops) {
    const MAX_SAMPLES = 40;
    const sampleExcluded = drops.samples.slice(0, MAX_SAMPLES);
    const typesBefore = histBy(before, r => String(r?.type || '—').toLowerCase());
    const typesAfter  = histBy(after,  r => String(r?.type || '—').toLowerCase());
    const provBefore  = histBy(before, r => r.__providerBucket || normalizeProviderBucket(r.provider));
    const provAfter   = histBy(after,  r => r.__providerBucket || normalizeProviderBucket(r.provider));
    const connBefore  = histBy(before, r => r.__conn || 'Unknown');
    const connAfter   = histBy(after,  r => r.__conn || 'Unknown');

    flog('FILTER SUMMARY', {
      counts: { before: before.length, after: after.length, excluded: drops.total },
      dropsByReason: drops.byReason,
      histogram: {
        type: { before: typesBefore, after: typesAfter },
        providerBucket: { before: provBefore, after: provAfter },
        connection: { before: connBefore, after: connAfter },
      },
      dateBounds: {
        preset: dateRange?.preset,
        start: dateBounds.start?.toISOString?.() || null,
        end: dateBounds.end?.toISOString?.() || null,
      },
    });
    if (sampleExcluded.length) {
      flog('EXCLUDED SAMPLES (cap)', sampleExcluded);
    }
  }

  // Apply filters + build diagnostics
  const rowsFiltered = useMemo(() => {
    const src = rowsAll || [];

    const drops = {
      total: 0,
      byReason: { provider: 0, connection: 0, date: 0, type: 0, multi: 0 },
      samples: [],
    };

    const pass = [];
    const MAX_EX_SAMPLES = 100; // cap

    for (const r of src) {
      const reasons = [];
      if (!providerPass(r)) reasons.push('provider');
      if (!connPass(r))     reasons.push('connection');
      if (!datePass(r))     reasons.push('date');
      if (!typePass(r))     reasons.push('type');

      if (reasons.length === 0) {
        pass.push(r);
      } else {
        drops.total += 1;
        if (reasons.length === 1) {
          drops.byReason[reasons[0]] += 1;
        } else {
          drops.byReason.multi += 1;
        }
        if (drops.samples.length < MAX_EX_SAMPLES) {
          drops.samples.push({
            id: r.id, provider: r.provider, providerBucket: r.__providerBucket,
            conn: r.__conn, type: r.type, ts: r.timestamp, reasons,
          });
        }
      }
    }

    logFilterSummary(src, pass, drops);
    return pass;
  }, [rowsAll, typeFilters, providers, connTypes, dateBounds]);

  // ------------------- hex aggregation & drawing ------------------------------
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
      fillFeatures.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, properties: { idx, count } });
      const [latC, lngC] = h3.cellToLatLng(idx);
      centerFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lngC, latC] }, properties: { idx, count } });
    }
    flog('aggregateIntoHexes', { rows: rowsArg?.length || 0, cells: cellIdxsSet?.size || 0, filledHexes: fillFeatures.length });
    return { fills: { type: 'FeatureCollection', features: fillFeatures }, centers: { type: 'FeatureCollection', features: centerFeatures }, itemsByCell };
  }

  function redrawHexes(map, rowsLocal, modeLocal) {
    const gate = shouldRenderHexes(map) && modeLocal === 'hex';
    if (!gate) {
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

  const openHexSheet = (idx) => {
    if (!idx) return;
    const items =
      cellItemsRef.current.get(idx) ||
      (rowsFiltered || []).filter(r => h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) === idx);
    const payload = buildSheetData(idx, items);
    setSheetData(payload);
    setSheetOpen(true);
  };

  const openDotSheet = (lng, lat, clickedId) => {
    const idx = h3.latLngToCell(lat, lng, HEX_RES);
    const allInHex =
      cellItemsRef.current.get(idx) ||
      (rowsFiltered || []).filter(r => h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) === idx);
    const clicked = clickedId ? allInHex.find(m => m.id === clickedId) : null;
    const items = clicked ? [clicked, ...allInHex.filter(m => m.id !== clicked.id)] : allInHex;
    const payload = buildSheetData(idx, items);
    setSheetData(payload);
    setSheetOpen(true);
  };

  // ---------------------------- map lifecycle --------------------------------
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    dlog('H3 version?', h3.VERSION || h3.version || '(unknown)', 'has polygonToCells?', typeof h3.polygonToCells);
    dlog('Mapbox token present?', !!import.meta.env.VITE_MAPBOX_TOKEN);
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({ container: mapEl.current, style: 'mapbox://styles/mapbox/light-v11', center: [-84.396, 33.777], zoom: 11, interactive: true });
    mapRef.current = map;

    map.on('load', async () => {
      map.doubleClickZoom.disable();
      map.addSource('points', { type: 'geojson', data: emptyFC(), cluster: true, clusterRadius: 42, clusterMaxZoom: 18 });
      map.addSource('hexes',       { type: 'geojson', data: emptyFC() });
      map.addSource('hex-fills',   { type: 'geojson', data: emptyFC() });
      map.addSource('hex-centers', { type: 'geojson', data: emptyFC() });

      map.addLayer({ id: 'clusters', type: 'circle', source: 'points', filter: ['has', 'point_count'], paint: { 'circle-color': '#1f2937', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': 0.9, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 16, 12, 22, 16, 28, 20, 34] } });
      map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'points', filter: ['has', 'point_count'], layout: { 'text-field': ['to-string', ['get', 'point_count']], 'text-font': ['Inter Regular', 'Arial Unicode MS Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 12, 12, 14, 16, 16, 20, 18], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
      map.addLayer({ id: 'unclustered-point', type: 'circle', source: 'points', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#374151', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 8, 6, 12, 7, 16, 8, 20, 9], 'circle-opacity': 0.9, 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' } });

      map.addLayer({ id: 'hex-outline', type: 'line', source: 'hexes', paint: { 'line-color': '#0f766e', 'line-width': 1, 'line-opacity': 0.7 }});
      map.addLayer({ id: 'hex-fill-active', type: 'fill', source: 'hex-fills', paint: { 'fill-color': '#A7F3D0', 'fill-opacity': 0.35 }});
      map.addLayer({ id: 'hex-count-bubble', type: 'circle', source: 'hex-centers', paint: { 'circle-color': '#065f46', 'circle-radius': 14, 'circle-opacity': 0.95 }});
      map.addLayer({ id: 'hex-count-label', type: 'symbol', source: 'hex-centers', layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#FFFFFF' }});

      map.once('idle', async () => {
        const initialRows = await fetchViewportRows(map);
        setRowsAll(initialRows);
        safeSetGeoJSON(map, 'points', rowsToPointFeatures(initialRows));
        redrawHexes(map, initialRows, modeRef.current);
        applyModeVisibility(map, modeRef.current);
        setMapReady(true);
        flog('initial viewport', { rowsAll: initialRows.length });
      });

      const stop = (e) => { e.preventDefault?.(); e.originalEvent?.preventDefault?.(); e.originalEvent?.stopPropagation?.(); };
      const openSheetForLngLat = (lngLat) => { const idx = h3.latLngToCell(lngLat.lat, lngLat.lng, HEX_RES); openHexSheet(idx); };

      map.on('click', 'clusters', (e) => { stop(e); openSheetForLngLat(e.lngLat); });
      map.on('click', 'cluster-count', (e) => { stop(e); openSheetForLngLat(e.lngLat); });

      map.on('click', 'unclustered-point', (e) => {
        stop(e);
        const f = e.features?.[0];
        if (!f?.geometry?.coordinates) return;
        const [lng, lat] = f.geometry.coordinates;
        const clickedId = f.properties?.id || null;
        openDotSheet(lng, lat, clickedId);
        onPointClick?.(clickedId);
      });

      const onHexClick = (e) => {
        stop(e);
        const f = e.features?.[0];
        const idx = f?.properties?.idx;
        if (idx) openHexSheet(idx);
      };
      map.on('click', 'hex-fill-active', onHexClick);
      map.on('click', 'hex-count-bubble', onHexClick);
      map.on('click', 'hex-count-label', onHexClick);

      map.on('dblclick', (e) => { e.preventDefault?.(); e.originalEvent?.preventDefault?.(); });

      let raf = 0;
      const rafCancel = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
      const refresh = () => {
        rafCancel();
        raf = requestAnimationFrame(async () => {
          if (!map || !map.style) { raf = 0; return; }
          const latest = await fetchViewportRows(map);
          setRowsAll(latest);
          flog('viewport refresh', { rowsAll: latest.length });
          raf = 0;
        });
      };
      map.on('moveend', refresh);
      map.on('zoomend', refresh);
    });

    map.on('error', (e) => derr('[Mapbox] error:', e?.error || e));

    return () => {
      try { map.remove(); } catch {}
      mapRef.current = null;
      setMapReady(false);
      cellItemsRef.current = new Map();
    };
  }, [mode]);

  // Update sources on filtered changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    safeSetGeoJSON(map, 'points', rowsToPointFeatures(rowsFiltered));
    redrawHexes(map, rowsFiltered, modeRef.current);
    flog('apply filtered to map', { rowsFiltered: rowsFiltered.length, rowsAll: rowsAll.length });
  }, [rowsFiltered, mapReady]);

  // Mode toggles
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyModeVisibility(map, mode);
    redrawHexes(map, rowsFiltered, mode);
    flog('mode change', { mode });
  }, [mapReady, mode, rowsFiltered]);

  return (
    <>
      <div ref={mapEl} style={{ position: 'absolute', inset: 0 }} />
      <BottomSheet open={!!sheetOpen} data={sheetData} onClose={() => setSheetOpen(false)} />
    </>
  );
}
