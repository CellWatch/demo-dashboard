// HexMap.jsx
import React, { useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import * as h3 from 'h3-js';
import { supabase } from '../utils/supabase';
import SearchBar from './SearchBar'; // ← NEW

const HEX_RES = 8;
const HEX_ZOOM_MIN = 9.0;
const HEX_ZOOM_MAX = 14.0;
const HEX_MAX_CELLS = 6000;

const PAGE_SIZE = 2000;
const MAX_PAGES = 20;
const MEAS_CHUNK = 500;

// global export paging (not viewport-bounded)
const GLOBAL_PAGE_SIZE = 2000;
const GLOBAL_MAX_PAGES = 100000;

const DEBUG_HEX = true;
const DEBUG_HEX_FILTERS = true;

const dlog  = (...a) => { if (DEBUG_HEX) console.log('[HexMap]', ...a); };
const dwarn = (...a) => { if (DEBUG_HEX) console.warn('[HexMap]', ...a); };
const derr  = (...a) => { if (DEBUG_HEX) console.error('[HexMap]', ...a); };
const flog  = (...a) => { if (DEBUG_HEX_FILTERS) console.log('[HexMap][filters]', ...a); };

if (typeof window !== 'undefined') window.__hexmap = window.__hexmap || {};

const PALETTE = {
  green: '#1E5638',
  greenLight: '#C8E3CC',
  greenDark: '#003618',
  blue: '#1D4ED8',
  blueLight: '#DBEAFE',
  blueDark: '#0B2C8A',
  orange: '#EA580C',
  orangeLight: '#FFE7D6',
  orangeDark: '#9A3606',
  grey: '#777777',
  greyDark: '#464646',
  greyLight: '#BABABA',
  white: '#FFFFFF',
  black: '#000000',
};

const TYPE_COLORS = {
  upload: { badgeBg: PALETTE.greenLight, badgeText: PALETTE.greenDark, tintBg: PALETTE.greenLight, tintBorder: PALETTE.green, bubble: PALETTE.greenDark, outline: PALETTE.greenDark, fill: PALETTE.green },
  download: { badgeBg: PALETTE.blueLight, badgeText: PALETTE.blueDark, tintBg: PALETTE.blueLight, tintBorder: PALETTE.blue, bubble: PALETTE.blueDark, outline: PALETTE.blueDark, fill: PALETTE.blue },
  latency: { badgeBg: PALETTE.orangeLight, badgeText: PALETTE.orangeDark, tintBg: PALETTE.orangeLight, tintBorder: PALETTE.orange, bubble: PALETTE.orangeDark, outline: PALETTE.orangeDark, fill: PALETTE.orange },
  default: { badgeBg: PALETTE.greyLight, badgeText: PALETTE.greyDark, tintBg: PALETTE.greyLight, tintBorder: PALETTE.grey, bubble: PALETTE.greyDark, outline: PALETTE.greyDark, fill: PALETTE.grey },
};

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

function viewportLoops(map) {
  const b = map.getBounds();
  const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
  const makeLoop = (S, W, N, E) => ([[S, W], [N, W], [N, E], [S, E], [S, W]]);
  if (west <= east) return [makeLoop(south, west, north, east)];
  return [makeLoop(south, west, north, 180), makeLoop(south, -180, north, east)];
}

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
  return { mbps: mbps ?? null, durationSec: durationSec ?? null, bytesMB: bytesMB ?? null, warmupSec: warmupSec ?? null, server: servers && servers.length ? r.servers[0] : null };
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

function dominantTypeOfItems(items) {
  const counts = { upload: 0, download: 0, latency: 0 };
  for (const it of items || []) {
    const t = String(it?.type || '').toLowerCase();
    if (t === 'upload') counts.upload++;
    else if (t === 'download' || t === 'down') counts.download++;
    else if (t === 'latency') counts.latency++;
  }
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const [topType, topCount] = entries[0];
  if (!topCount) return 'default';
  return topType;
}

function buildSheetData(hexIdx, itemsRaw) {
  const items = (itemsRaw || []).map(m => ({ ...m, __stats: m.__stats || extractStats(m) }));
  const downs = items.map(i => i.__stats.down);
  const ups   = items.map(i => i.__stats.up);
  const pings = items.map(i => i.__stats.ping);
  const jits  = items.map(i => i.__stats.jitter);
  const losses= items.map(i => i.__stats.loss);
  const summary = { count: items.length, down: aggNums(downs), up: aggNums(ups), ping: aggNums(pings), jitter: aggNums(jits), loss: aggNums(losses) };
  const domType = dominantTypeOfItems(items);
  return { hexIdx, summary, items, domType };
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

// ---------- viewport fetchers ----------
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

async function fetchCellsByMeasurementIds(ids) {
  const out = new Map();
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return out;

  try {
    const { data, error } = await supabase
      .from('cells')
      .select('measurement_id, network_generation')
      .in('measurement_id', uniq);

    if (error) {
      derr('[cells] fetch error:', error);
      return out;
    }

    for (const row of data || []) {
      const mid = row?.measurement_id;
      const gen = row?.network_generation;
      if (!mid) continue;
      if (!out.has(mid)) {
        out.set(mid, gen);
      } else {
        const prev = String(out.get(mid) || '').toLowerCase();
        const cur  = String(gen || '').toLowerCase();
        const is5  = (s) => s.includes('5g') || s.includes('nr');
        if (!is5(prev) && is5(cur)) out.set(mid, gen);
      }
    }
  } catch (e) {
    derr('[cells] fetch crashed:', e);
  }

  flog('cells map built', { size: out.size });
  return out;
}

function normalizeProviderBucket(provider) {
  const p = String(provider || '').toLowerCase();
  if (p.includes('att') || p.includes('at&t')) return 'AT&T';
  if (p.includes('t-mobile') || p.includes('tmobile')) return 'T-Mobile';
  if (p.includes('verizon')) return 'Verizon';
  return 'Other';
}

function deriveConnTag(meas, genHint) {
  if (genHint) {
    const g = String(genHint).toLowerCase();
    if (g.includes('5g') || g.includes('nr')) return '5G';
    if (g.includes('4g') || g.includes('lte')) return '4G';
  }
  let hay = '';
  const push = (v) => {
    if (!v && v !== 0) return;
    hay += ` ${String(v).toLowerCase()}`;
  };

  push(meas?.provider);
  push(meas?.type);
  const extra = parseMaybeJSON(meas?.extra_data) || {};
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      push(k);
      if (v == null) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        push(v);
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (typeof v === 'object') {
        walk(v);
      }
    }
  };
  walk(extra);

  const has = (s) => hay.includes(s);
  if (has('5g') || has('nr') || has('nsa') || has('sa') || has('nr5g') || has('5 g')) return '5G';
  if (has('lte') || has('4g') || has('4 g') || has('lte-a') || has('ltea')) return '4G';
  return 'Other';
}

/* ---------- Selection overlay color helpers ---------- */
function applySelectionColors(map/*, dominantType */) {
  if (!map) return;
  const outline = PALETTE.greenDark;
  const fill    = PALETTE.green;
  if (map.getLayer('hex-selected-outline')) {
    map.setPaintProperty('hex-selected-outline', 'line-color', outline);
  }
  if (map.getLayer('hex-selected-fill')) {
    map.setPaintProperty('hex-selected-fill', 'fill-color', fill);
  }
  if (map.getLayer('hex-selected-label')) {
    map.setPaintProperty('hex-selected-label', 'text-color', PALETTE.white);
    map.setPaintProperty('hex-selected-label', 'text-halo-color', PALETTE.greenDark);
    map.setPaintProperty('hex-selected-label', 'text-halo-width', 1.5);
  }
}

/* ------------------ RightPanel (drawer with details) ------------------ */
function RightPanel({ open, onClose, data, width = 420 }) {
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

  const fmt = (v, unit = '', digits = 1) => (v == null ? '—' : `${Number(v).toFixed(digits)}${unit}`);
  const fmtDate = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  };

  const statRow = (k, v) => (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10
    }}>
      <div style={{ fontSize: 12, color: '#6B7280' }}>{k}</div>
      <div style={{ fontSize: k === 'Average' ? 20 : 13, fontWeight: k === 'Average' ? 700 : 600, color: '#111827' }}>
        {v}
      </div>
    </div>
  );

  const statCard = (label, obj, unit = '', digits = 1) => {
    const fmtNum = (n) => (n == null ? '—' : `${Number(n).toFixed(digits)}${unit}`);
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#F8FAFC',
        border: '1px solid #E5E7EB',
        borderRadius: 10,
        padding: 12,
        minWidth: 160
      }}>
        <div style={{ fontSize: 12, color: '#6B7280' }}>{label}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {statRow('Average', fmtNum(obj?.avg))}
          {statRow('Min',     fmtNum(obj?.min))}
          {statRow('Max',     fmtNum(obj?.max))}
        </div>
      </div>
    );
  };

  const chip = (text, kind) => {
    const c = TYPE_COLORS[kind] || TYPE_COLORS.default;
    return (
      <span style={{
        display: 'inline-block',
        background: c.badgeBg,
        color: c.badgeText,
        border: `1px solid ${c.tintBorder}`,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1
      }}>{text}</span>
    );
  };

  const exportPanelCsv = () => {
    const rows = Array.isArray(items) ? items : [];
    const header = 'hex_idx,id,provider,type,timestamp,lat,lon,down_mbps,up_mbps,ping_ms,jitter_ms,loss_pct\n';
    const rowToCsvLine = (r) => {
      const s = r.__stats || extractStats(r);
      const vals = [
        hexIdx,
        r.id ?? '',
        r.provider ?? '',
        r.type ?? '',
        r.timestamp ?? '',
        Number.isFinite(r.lat) ? r.lat : '',
        Number.isFinite(r.lon) ? r.lon : '',
        s?.down ?? '',
        s?.up ?? '',
        s?.ping ?? '',
        s?.jitter ?? '',
        s?.loss ?? '',
      ];
      return vals.map((v) => {
        if (v == null) return '';
        const str = String(v);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',');
    };

    const csv = header + rows.map(rowToCsvLine).join('\n') + (rows.length ? '\n' : '');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const when = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `cellwatch_hex_${hexIdx || 'unknown'}_${rows.length}_rows_${when}.csv`;
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const container = {
    position: 'fixed',
    top: 0,
    bottom: 0,
    right: 0,
    width,
    background: '#FFFFFF',
    boxShadow: '-2px 0 24px rgba(0,0,0,0.12)',
    borderLeft: '1px solid #e5e7eb',
    zIndex: 10002,
    transform: open ? 'translateX(0)' : `translateX(${width + 24}px)`,
    transition: 'transform 180ms ease-out',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'Inter, system-ui, Arial, sans-serif'
  };

  const header = {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: '#FFFFFF',
    borderBottom: '1px solid #eef2f7',
    padding: '12px 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  };

  const content = {
    flex: 1,
    overflow: 'auto',
    padding: 14,
    color: '#555',
    fontSize: 13
  };

  const titleLeft = { display: 'flex', alignItems: 'center', gap: 8, color: '#1f2937', fontWeight: 600, fontSize: 14 };
  const dot = { width: 10, height: 10, borderRadius: 999, background: '#C8E3CC' };
  const btn = (style = {}) => ({
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#FFFFFF',
    padding: '6px 10px',
    cursor: 'pointer',
    color: '#464646',
    fontWeight: 600,
    ...style
  });

  return (
    <div style={container} aria-hidden={!open}>
      <div style={header}>
        <div style={titleLeft}>
          <span style={dot} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ color: '#1f2937', fontWeight: 600 }}>Hex {hexIdx}</span>
            <span style={{ color: '#6b7280', fontWeight: 500 }}>
              {summary.count} measurement{summary.count === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={exportPanelCsv}
            style={btn({ borderColor: PALETTE.green, background: PALETTE.greenDark, color: '#FFFFFF' })}
          >
            Download CSV
          </button>
          <button style={btn()} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div style={content}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10 }}>
          {statCard('Down (Mbps)', summary.down, ' Mbps', 1)}
          {statCard('Up (Mbps)', summary.up, ' Mbps', 1)}
          {statCard('Ping (ms)', summary.ping, ' ms', 0)}
          {statCard('Jitter (ms)', summary.jitter, ' ms', 0)}
          {statCard('Loss (%)', summary.loss, ' %', 1)}
        </div>

        <div style={{ height: 1, background: '#E5E7EB', margin: '12px 0' }} />

        {items.length === 0 ? (
          <div>No measurements in this hex (after filters).</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((m) => {
              const s = m.__stats || {};
              const rawKind = String(m?.type || 'default').toLowerCase();
              const kind = rawKind === 'down' ? 'download' : rawKind;
              return (
                <div key={`${m.id}-${m.loc_id}`} style={{
                  border: '1px solid #E5E7EB',
                  borderRadius: 10,
                  padding: 12,
                  background: '#FFFFFF'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {chip(kind, kind)}
                      <span style={{ color: '#374151', fontWeight: 600 }}>{m.provider || 'Unknown provider'}</span>
                    </div>
                    <div style={{ color: '#6B7280' }}>{fmtDate(m.timestamp)}</div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6, marginTop: 6 }}>
                    <div><strong>Down</strong><div>{fmt(s.down, ' Mbps', 1)}</div></div>
                    <div><strong>Up</strong><div>{fmt(s.up, ' Mbps', 1)}</div></div>
                    <div><strong>Ping</strong><div>{fmt(s.ping, ' ms', 0)}</div></div>
                    <div><strong>Jitter</strong><div>{fmt(s.jitter, ' ms', 0)}</div></div>
                    <div><strong>Loss</strong><div>{fmt(s.loss, ' %', 1)}</div></div>
                    <div><strong>Conn</strong><div>{m.__conn || '—'}</div></div>
                  </div>

                  <div style={{ marginTop: 8, fontSize: 12, color: '#6B7280' }}>
                    <span style={{ marginRight: 12 }}>lat: {Number.isFinite(m.lat) ? m.lat.toFixed(5) : '—'}</span>
                    <span>lon: {Number.isFinite(m.lon) ? m.lon.toFixed(5) : '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ======================== MAIN COMPONENT ======================== */
export default function HexMap({
  mode = 'hex',
  typeFilters = { all: true, upload: { enabled: false, mode: 'all', threshold: '' }, download: { enabled: false, mode: 'all', threshold: '' }, latency: { enabled: false, mode: 'all', threshold: '' } },
  connTypes = ['4G','5G','Other'],
  providers = ['AT&T','T-Mobile','Verizon','Other'],
  dateRange = { preset: 'all', start: '', end: '' },
  onPointClick = () => {},
  onRegisterSearch,
}) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const [rowsAll, setRowsAll] = useState([]);
  const [mapReady, setMapReady] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelData, setPanelData] = useState(null);

  const [selectedIdx, setSelectedIdx] = useState(null);
  const selectedIdxRef = useRef(null);

  const cellItemsRef = useRef(new Map());
  const rowsAllRef = useRef([]);
  const modeRef = useRef(mode);
  const [exporting, setExporting] = useState(false);

  const rowsFilteredRef = useRef([]);

  useEffect(()=>{ rowsAllRef.current = rowsAll; }, [rowsAll]);
  useEffect(()=>{ modeRef.current = mode; }, [mode]);
  useEffect(()=>{ selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

  // ---------- date bounds ----------
  const dateBounds = useMemo(() => {
    const now = new Date();
    let start = null, end = null;

    switch (dateRange?.preset) {
      case '1m': { start = new Date(now); start.setMonth(start.getMonth() - 1); break; }
      case '6m': { start = new Date(now); start.setMonth(start.getMonth() - 6); break; }
      case '1y': { start = new Date(now); start.setFullYear(start.getFullYear() - 1); break; }
      case 'custom': {
        start = dateRange?.start ? new Date(dateRange.start) : null;
        end   = dateRange?.end   ? new Date(dateRange.end)   : null;
        break;
      }
      case 'all':
      default: { start = null; end = null; break; }
    }

    flog('dateBounds computed', {
      preset: dateRange?.preset,
      start: start?.toISOString?.() || null,
      end: end?.toISOString?.() || null,
    });

    return { start, end };
  }, [dateRange]);

  // ---------- filter fns ----------
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
        const v = row.__stats?.up; if (v == null) return false;
        return f.mode === 'above' ? v >= thr : v <= thr;
      } else if (key === 'download') {
        const v = row.__stats?.down; if (v == null) return false;
        return f.mode === 'above' ? v >= thr : v <= thr;
      } else if (key === 'latency') {
        const v = row.__stats?.ping; if (v == null) return false;
        return f.mode === 'above' ? v >= thr : v <= thr;
      }
      return false;
    };
    return ['upload','download','latency'].some(k => check(k));
  };

  const connPass = (row) => {
    const selected = new Set(connTypes || []);
    if (selected.size === 0) return true;
    const tag = row?.__conn || 'Other';
    return selected.has(tag);
  };

  const providerPass = (row) => {
    if (!providers?.length) return true;
    const bucket = row.__providerBucket || normalizeProviderBucket(row.provider);
    return providers.includes(bucket);
  };

  const datePass = (row) => {
    if (!dateBounds.start && !dateBounds.end) return true;
    const ts = row?.timestamp ? new Date(row.timestamp) : null;
    if (!ts || isNaN(ts.getTime())) return false;
    if (dateBounds.start && ts < dateBounds.start) return false;
    if (dateBounds.end && ts > dateBounds.end) return false;
    return true;
  };

  const rowsFiltered = useMemo(() => {
    const src = rowsAll || [];
    const pass = [];
    for (const r of src) {
      if (providerPass(r) && connPass(r) && datePass(r) && typePass(r)) pass.push(r);
    }
    flog('apply filtered to map', { rowsFiltered: pass.length, rowsAll: src.length });
    return pass;
  }, [rowsAll, typeFilters, providers, connTypes, dateBounds]);

  useEffect(() => { rowsFilteredRef.current = rowsFiltered; }, [rowsFiltered]);

  // ---------- map wiring ----------
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

    updateSelectionOverlay(map, selectedIdxRef.current);
  }

  function buildHexFeature(idx) {
    if (!idx) return emptyFC();
    const ring = h3.cellToBoundary(idx, true);
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        properties: { idx }
      }]
    };
  }

  function buildCenterFeature(idx, count = 0) {
    if (!idx) return emptyFC();
    const [latC, lngC] = h3.cellToLatLng(idx);
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lngC, latC] },
        properties: { idx, count }
      }]
    };
  }

  function updateSelectionOverlay(map, idx) {
    if (!map) return;
    if (!idx) {
      safeSetGeoJSON(map, 'hex-selected', emptyFC());
      safeSetGeoJSON(map, 'hex-center-selected', emptyFC());
      if (map.getLayer('hex-selected-bubble')) {
        map.setPaintProperty('hex-selected-bubble', 'circle-radius', 18);
      }
      applySelectionColors(map, 'default');
      return;
    }
    const items = cellItemsRef.current.get(idx) ||
      (rowsFiltered || []).filter(r =>
        h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) === idx
      );
    const count = items.length;
    safeSetGeoJSON(map, 'hex-selected', buildHexFeature(idx));
    safeSetGeoJSON(map, 'hex-center-selected', buildCenterFeature(idx, count));
    if (map.getLayer('hex-selected-bubble')) {
      map.setPaintProperty('hex-selected-bubble', 'circle-radius', 24);
    }
    const domType = dominantTypeOfItems(items);
    applySelectionColors(map, domType);
  }

  function applyModeVisibility(map, currentMode) {
    if (!map) return;
    const hexZoomOk = shouldRenderHexes(map);
    const wantHex   = currentMode === 'hex';
    const showHex   = wantHex && hexZoomOk;
    const showDot   = !showHex;

    setVis(map, 'hex-outline', showHex);
    setVis(map, 'hex-fill-active', showHex);
    setVis(map, 'hex-count-bubble', showHex);
    setVis(map, 'hex-count-label', showHex);

    setVis(map, 'hex-selected-fill', showHex);
    setVis(map, 'hex-selected-outline', showHex);
    setVis(map, 'hex-selected-bubble', showHex);
    setVis(map, 'hex-selected-label', showHex);

    setVis(map, 'clusters', showDot);
    setVis(map, 'cluster-count', showDot);
    setVis(map, 'unclustered-point', showDot);
  }

  function getClusterLeavesAsync(source, clusterId, limit = 10000, offset = 0) {
    return new Promise((resolve, reject) => {
      try {
        source.getClusterLeaves(clusterId, limit, offset, (err, features) => {
          if (err) reject(err);
          else resolve(features || []);
        });
      } catch (e) { reject(e); }
    });
  }

  function pickMajorityHex(items, fallbackIdx = null) {
    const counts = new Map();
    for (const r of items || []) {
      if (!Number.isFinite(r?.lat) || !Number.isFinite(r?.lon)) continue;
      const idx = h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES);
      counts.set(idx, (counts.get(idx) || 0) + 1);
    }
    if (!counts.size) return fallbackIdx;
    let best = null, bestCnt = -1;
    for (const [idx, cnt] of counts.entries()) {
      if (cnt > bestCnt) { best = idx; bestCnt = cnt; }
    }
    return best || fallbackIdx;
  }

  async function openClusterSheetFromFeature(map, feature, clickLngLat) {
    try {
      const src = map.getSource('points');
      if (!src || !feature?.properties?.cluster_id) return;

      const clusterId = feature.properties.cluster_id;
      const leaves = await getClusterLeavesAsync(src, clusterId, 10000, 0);
      const ids = new Set(leaves.map(f => f?.properties?.id).filter(Boolean));

      const items = (rowsFilteredRef.current || []).filter(r => ids.has(r.id));

      const fallbackIdx = clickLngLat
        ? h3.latLngToCell(clickLngLat.lat, clickLngLat.lng, HEX_RES)
        : null;
      const idx = pickMajorityHex(items, fallbackIdx);

      const payload = buildSheetData(idx, items);
      setPanelData(payload);
      setPanelOpen(true);
      setSelectedIdx(idx);
      updateSelectionOverlay(mapRef.current, idx);
    } catch (e) {
      derr('[clusters] open sheet failed:', e);
    }
  }

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

      map.addLayer({ id: 'clusters', type: 'circle', source: 'points', filter: ['has', 'point_count'], paint: { 'circle-color': PALETTE.greyDark, 'circle-stroke-width': 1.5, 'circle-stroke-color': PALETTE.white, 'circle-opacity': 0.9, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 16, 12, 22, 16, 28, 20, 34] } });
      map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'points', filter: ['has', 'point_count'], layout: { 'text-field': ['to-string', ['get', 'point_count']], 'text-font': ['Inter Regular', 'Arial Unicode MS Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 12, 12, 14, 16, 16, 20, 18], 'text-allow-overlap': true }, paint: { 'text-color': PALETTE.white } });
      map.addLayer({ id: 'unclustered-point', type: 'circle', source: 'points', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': PALETTE.greyDark, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 8, 6, 12, 7, 16, 8, 20, 9], 'circle-opacity': 0.9, 'circle-stroke-width': 1, 'circle-stroke-color': PALETTE.white } });

      map.addLayer({ id: 'hex-outline', type: 'line', source: 'hexes', paint: { 'line-color': PALETTE.green, 'line-width': 1, 'line-opacity': 0.55 }});
      map.addLayer({ id: 'hex-fill-active', type: 'fill', source: 'hex-fills', paint: { 'fill-color': PALETTE.greenLight, 'fill-opacity': 0.25 }});
      map.addLayer({
        id: 'hex-count-bubble',
        type: 'circle',
        source: 'hex-centers',
        paint: {
          'circle-color': PALETTE.greenDark,
          'circle-radius': 14,
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': PALETTE.white
        }
      });
      map.addLayer({ id: 'hex-count-label', type: 'symbol', source: 'hex-centers', layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': PALETTE.white }});

      map.addSource('hex-selected', { type: 'geojson', data: emptyFC() });
      map.addSource('hex-center-selected', { type: 'geojson', data: emptyFC() });

      map.addLayer({
        id: 'hex-selected-fill',
        type: 'fill',
        source: 'hex-selected',
        paint: { 'fill-color': TYPE_COLORS.default.fill, 'fill-opacity': 0.20 }
      });

      map.addLayer({
        id: 'hex-selected-outline',
        type: 'line',
        source: 'hex-selected',
        paint: { 'line-color': TYPE_COLORS.default.outline, 'line-width': 3, 'line-opacity': 0.95 }
      });

      map.addLayer({
        id: 'hex-selected-bubble',
        type: 'circle',
        source: 'hex-center-selected',
        paint: {
          'circle-color': PALETTE.greenDark,
          'circle-radius': 18,
          'circle-opacity': 0.95,
          'circle-stroke-width': 3,
          'circle-stroke-color': PALETTE.white
        }
      });

      map.addLayer({
        id: 'hex-selected-label',
        type: 'symbol',
        source: 'hex-center-selected',
        layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': PALETTE.white, 'text-halo-color': PALETTE.greenDark, 'text-halo-width': 1.5 }
      });

      map.once('idle', async () => {
        const initialRows = await fetchViewportRows(map);
        setRowsAll(initialRows);
        safeSetGeoJSON(map, 'points', rowsToPointFeatures(initialRows));
        redrawHexes(map, initialRows, modeRef.current);
        applyModeVisibility(map, modeRef.current);
        updateSelectionOverlay(map, selectedIdxRef.current);
        setMapReady(true);
        flog('initial viewport', { rowsAll: initialRows.length });
      });

      const stop = (e) => { e.preventDefault?.(); e.originalEvent?.preventDefault?.(); e.originalEvent?.stopPropagation?.(); };

      map.on('click', 'clusters', async (e) => {
        stop(e);
        const f = e.features?.[0];
        await openClusterSheetFromFeature(map, f, e.lngLat);
      });

      map.on('click', 'cluster-count', async (e) => {
        stop(e);
        const f = e.features?.[0];
        await openClusterSheetFromFeature(map, f, e.lngLat);
      });

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
          updateSelectionOverlay(map, selectedIdxRef.current);
          raf = 0;
        });
      };
      map.on('moveend', refresh);
      map.on('zoomend', refresh);

      map.on('zoomend', () => {
        applyModeVisibility(map, modeRef.current);
        redrawHexes(map, rowsAllRef.current, modeRef.current);
      });
    });

    map.on('error', (e) => derr('[Mapbox] error:', e?.error || e));

    return () => {
      try { map.remove(); } catch {}
      mapRef.current = null;
      setMapReady(false);
      cellItemsRef.current = new Map();
    };
  }, []); // init once

  async function fetchViewportRows(map) {
    const b = map.getBounds();
    const west = b.getWest(), east = b.getEast(), south = b.getSouth(), north = b.getNorth();
    const locs = await fetchLocationsInBox({ south, west, north, east });
    if (!locs?.length) return [];
    const measIds = locs.map(l => l.measurement_id);
    const measMap = await fetchMeasurementsByIds(measIds);
    const cellsMap = await fetchCellsByMeasurementIds(measIds);

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

      const genHint = cellsMap.get(l.measurement_id) || null;
      const __stats = extractStats(base);
      const __conn = deriveConnTag(base, genHint);
      const __providerBucket = normalizeProviderBucket(base.provider);

      return { ...base, __stats, __conn, __providerBucket };
    });

    flog('fetchViewportRows result', { count: rows.length, bbox: { west, east, south, north } });
    return rows;
  }

  const openHexSheet = (idx) => {
    if (!idx) return;
    const items =
      cellItemsRef.current.get(idx) ||
      (rowsFiltered || []).filter(r => h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) === idx);
    const payload = buildSheetData(idx, items);
    setPanelData(payload);
    setPanelOpen(true);
    setSelectedIdx(idx);
    updateSelectionOverlay(mapRef.current, idx);
    // Fly to hex center for context
    try {
      const [lat, lng] = h3.cellToLatLng(idx);
      mapRef.current?.flyTo({ center: [lng, lat], zoom: Math.max(mapRef.current.getZoom(), 12), speed: 0.9 });
    } catch {}
  };

  const openDotSheet = (lng, lat, clickedId) => {
    const idx = h3.latLngToCell(lat, lng, HEX_RES);
    const allInHex =
      cellItemsRef.current.get(idx) ||
      (rowsFiltered || []).filter(r => h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) === idx);
    const clicked = clickedId ? allInHex.find(m => m.id === clickedId) : null;
    const items = clicked ? [clicked, ...allInHex.filter(m => m.id !== clicked.id)] : allInHex;
    const payload = buildSheetData(idx, items);
    setPanelData(payload);
    setPanelOpen(true);
    setSelectedIdx(idx);
    updateSelectionOverlay(mapRef.current, idx);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    safeSetGeoJSON(map, 'points', rowsToPointFeatures(rowsFiltered));
    redrawHexes(map, rowsFiltered, modeRef.current);
    applyModeVisibility(map, modeRef.current);
    updateSelectionOverlay(map, selectedIdxRef.current);
  }, [rowsFiltered, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applyModeVisibility(map, mode);
    redrawHexes(map, rowsFiltered, mode);
    updateSelectionOverlay(map, selectedIdxRef.current);
  }, [mapReady, mode, rowsFiltered]);

  async function* iterateAllLocations() {
    for (let page = 0; page < GLOBAL_MAX_PAGES; page++) {
      const from = page * GLOBAL_PAGE_SIZE;
      const to = from + GLOBAL_PAGE_SIZE - 1;
      let resp;
      try {
        resp = await supabase.from('locations').select('id,measurement_id,lat,lon').range(from, to);
      } catch (e) {
        derr('[Export][locations] fetch crashed:', e);
        return;
      }
      const { data, error } = resp || {};
      if (error) { derr('[Export][locations] fetch error:', error); return; }
      if (!data?.length) break;
      yield data;
      if (data.length < GLOBAL_PAGE_SIZE) break;
    }
  }

  async function buildRowsForBatch(locsBatch) {
    const measIds = locsBatch.map(l => l.measurement_id);
    const [measMap, cellsMap] = await Promise.all([
      fetchMeasurementsByIds(measIds),
      fetchCellsByMeasurementIds(measIds),
    ]);

    return locsBatch.map(l => {
      const m = measMap.get(l.measurement_id) || { id: l.measurement_id };
      const base = {
        loc_id: l.id, id: m.id, timestamp: m.timestamp || null,
        provider: m.provider || null, type: m.type || null,
        upload_download_data: m.upload_download_data,
        latency_data: m.latency_data, extra_data: m.extra_data,
        lat: Number(l.lat), lon: Number(l.lon),
      };
      const genHint = cellsMap.get(l.measurement_id) || null;
      const __stats = extractStats(base);
      const __conn = deriveConnTag(base, genHint);
      const __providerBucket = normalizeProviderBucket(base.provider);
      return { ...base, __stats, __conn, __providerBucket };
    });
  }

  function rowPassesAllFilters(r) {
    return providerPass(r) && connPass(r) && datePass(r) && typePass(r);
  }

  function rowToCsvLine(r) {
    const s = r.__stats || extractStats(r);
    const idx = (Number.isFinite(r?.lat) && Number.isFinite(r?.lon))
      ? h3.latLngToCell(Number(r.lat), Number(r.lon), HEX_RES) : '';
    const vals = [
      idx, r.id ?? '', r.provider ?? '', r.type ?? '', r.timestamp ?? '',
      r.lat ?? '', r.lon ?? '', s.down ?? '', s.up ?? '', s.ping ?? '', s.jitter ?? '', s.loss ?? ''
    ];
    return vals.map(v => {
      if (v == null) return '';
      const str = String(v);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
    }).join(',');
  }

  async function globalExportFilteredCsv() {
    console.log('[Export] Button pressed — starting GLOBAL export');
    setExporting(true);
    const header = 'hex_idx,id,provider,type,timestamp,lat,lon,down_mbps,up_mbps,ping_ms,jitter_ms,loss_pct\n';
    const parts = [header];

    let scanned = 0, emitted = 0, batchIndex = 0;

    for await (const locs of iterateAllLocations()) {
      batchIndex++;
      scanned += locs.length;
      console.log(`[Export] Batch ${batchIndex}: scanned+=${locs.length} totalScanned=${scanned}`);

      const rows = await buildRowsForBatch(locs);
      const filtered = rows.filter(rowPassesAllFilters);

      if (filtered.length) {
        parts.push(filtered.map(rowToCsvLine).join('\n') + '\n');
        emitted += filtered.length;
      }

      console.log(`[Export] Batch ${batchIndex} done. matched=${filtered.length}, totalEmitted=${emitted}`);
    }

    const csv = new Blob(parts, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(csv);
    const a = document.createElement('a');
    const when = new Date().toISOString().replace(/[:.]/g,'-');
    const filename = `cellwatch_filtered_GLOBAL_${emitted}_rows_${when}.csv`;
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    console.log('[Export] Done. rows=', emitted);
    setExporting(false);
  }

  useEffect(() => {
    window.__hexmap.doExportAllFiltered = globalExportFilteredCsv;
    return () => { if (window.__hexmap?.doExportAllFiltered) delete window.__hexmap.doExportAllFiltered; };
  }, [typeFilters, connTypes, providers, dateBounds]);

  useEffect(() => {
  if (!onRegisterSearch) return;
  onRegisterSearch({
    getMapCenter,
    onPick: onSearchPick,
    onPickHex: onSearchPickHex
  });

  }, [onRegisterSearch]);

  // ================= SEARCH INTEGRATION =================

  const getMapCenter = () => {
    const m = mapRef.current;
    if (!m) return null;
    const c = m.getCenter();
    return { lng: c.lng, lat: c.lat };
  };

  const haversineMeters = (a, b) => {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI/180;
    const dLng = (b.lng - a.lng) * Math.PI/180;
    const s1 = Math.sin(dLat/2) ** 2;
    const s2 = Math.cos(a.lat*Math.PI/180) * Math.cos(b.lat*Math.PI/180) * Math.sin(dLng/2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s1 + s2));
  };

  const findNearestRows = (lng, lat, limitMeters = 200) => {
    const src = rowsFilteredRef.current || [];
    const here = { lng, lat };
    const candidates = [];
    for (const r of src) {
      if (!Number.isFinite(r?.lat) || !Number.isFinite(r?.lon)) continue;
      const d = haversineMeters(here, { lng: r.lon, lat: r.lat });
      if (d <= limitMeters) candidates.push({ d, r });
    }
    candidates.sort((a,b)=>a.d-b.d);
    return candidates.map(x=>x.r);
  };

  const onSearchPickHex = (maybeIdx) => {
    try {
      const [lat, lng] = h3.cellToLatLng(maybeIdx);
      flyToSwing(mapRef.current, { lng, lat }, { minZoom: 12 });
      setPanelOpen(false);
      setSelectedIdx(null);
      updateSelectionOverlay(mapRef.current, null);
    } catch {}
  };

 const onSearchPick = ({ lng, lat }) => {
   const map = mapRef.current;
   if (!map) return;
   flyToSwing(map, { lng, lat }, { minZoom: 13 });
   setPanelOpen(false);
   setSelectedIdx(null);
   updateSelectionOverlay(mapRef.current, null);
 };

  function flyToSwing(map, { lng, lat }, { minZoom = 13 } = {}) {
    if (!map) return;
    const targetZoom = Math.max(map.getZoom() || 0, minZoom);
    map.flyTo({
      center: [lng, lat],
      zoom: targetZoom,
      speed: 0.7,
      curve: 1.6,
      essential: true
    });
  }

  // =====================================================

  return (
    <>
      {exporting && (
        <div style={{
          position:'fixed', right:16, bottom:16, background:PALETTE.greenDark,
          color:'#fff', padding:'10px 12px', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.2)', zIndex: 10003
        }}>
          Exporting filtered data… check console for progress.
        </div>
      )}

      <div
        ref={mapEl}
        style={{
          position: 'absolute',
          inset: 0,
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none'
        }}
      />
      {}
      <RightPanel
        open={panelOpen}
        data={panelData}
        onClose={() => {
          setPanelOpen(false);
          setSelectedIdx(null);
          updateSelectionOverlay(mapRef.current, null);
        }}
      />
    </>
  );
}
