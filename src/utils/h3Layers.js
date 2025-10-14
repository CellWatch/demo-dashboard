// src/utils/h3layers.js
import * as h3 from 'h3-js'; // namespace import to support v3/v4 APIs

// Max how many hexes we'll render at once (keeps memory in check)
const MAX_CELLS = 6000;

// Outline-only rendering
const HEX_MAXZOOM = 22;

let map;
let mode = 'dots';
let measurements = [];
let gridCells = new Set(); // viewport hexes
let countsForCenters = new Map(); // idx -> count for label

// click listener registered by HexMap
let hexClickCb = null;

export function isReady() {
  return !!map;
}

export function initH3Layers(m, initialMeasurements) {
  map = m;
  measurements = initialMeasurements || [];

  addSources();
  addLayers();
  bindEvents();

  updateViewportGrid();
  paintHexesFromGrid(); // builds outlines + centers (with default count=1)
  paintDots();

  // default; HexMap should override based on slider immediately after init
  setMode('dots');
}

export function setMode(next) {
  mode = next;
  const dotsVis = mode === 'dots' ? 'visible' : 'none';
  const hexVis  = mode === 'hex'  ? 'visible' : 'none';

  setVis('dots-circle', dotsVis);

  // hex outline + centers family
  setVis('hex-outline', hexVis);
  setVis('hex-count-hit', hexVis);
  setVis('hex-count-bubble', hexVis);
  setVis('hex-count-label', hexVis);
}

export function setMeasurements(nextPoints) {
  if (!map) return;
  measurements = nextPoints || [];
  paintDots();
}

/**
 * Provide per-hex counts for the current grid:
 * - `counts` can be a Map<string, number> or a plain object { idx: count }
 */
export function setHexCounts(counts) {
  if (!map) return;
  // normalize to Map
  const m = counts instanceof Map ? counts : new Map(Object.entries(counts || {}));
  countsForCenters = m;
  // repaint centers (labels) using the latest counts
  paintCentersOnly();
}

export function onHexClick(cb) {
  hexClickCb = typeof cb === 'function' ? cb : null;
}

/* ---------------- map + layers ---------------- */

function addSources() {
  map.addSource('dots',        { type: 'geojson', data: emptyFC() });
  map.addSource('hexes',       { type: 'geojson', data: emptyFC() }); // polygon source; outline reads from this
  map.addSource('hex-centers', { type: 'geojson', data: emptyFC() }); // centers for bubbles/labels
}

function addLayers() {
  // Points (only in "dots" mode)
  map.addLayer({
    id: 'dots-circle',
    type: 'circle',
    source: 'dots',
    paint: {
      'circle-color': '#374151',
      'circle-radius': 4,
      'circle-opacity': 0.9,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1
    },
  });

  // Hex OUTLINES (line layer over polygon source)
  map.addLayer({
    id: 'hex-outline',
    type: 'line',
    source: 'hexes',
    maxzoom: HEX_MAXZOOM,
    paint: {
      'line-color': '#2B6CB0', // blue outline
      'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 10, 1.5, 16, 2.0, 22, 2.5],
      'line-opacity': 1.0,
    },
  });

  // --- HEX CENTERS (bubbles + label + big almost-invisible hit layer) ---

  // Large hit layer. IMPORTANT: opacity is 0.001 (not 0) so it renders & is clickable.
  map.addLayer({
    id: 'hex-count-hit',
    type: 'circle',
    source: 'hex-centers',
    paint: {
      'circle-radius': 28,
      'circle-opacity': 0.001,
      'circle-stroke-width': 0,
    },
  });

  // Visible bubble
  map.addLayer({
    id: 'hex-count-bubble',
    type: 'circle',
    source: 'hex-centers',
    paint: {
      'circle-color': '#065f46',
      'circle-radius': 11,
      'circle-opacity': 0.95,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  });

  // Label
  map.addLayer({
    id: 'hex-count-label',
    type: 'symbol',
    source: 'hex-centers',
    layout: {
      'text-field': ['to-string', ['get', 'count']],
      'text-size': 12,
      'text-allow-overlap': true,
      'text-font': ['Inter Regular', 'Arial Unicode MS Regular'],
    },
    paint: { 'text-color': '#FFFFFF' },
  });

  // By default, hide hex family until mode switched
  setVis('hex-outline', 'none');
  setVis('hex-count-hit', 'none');
  setVis('hex-count-bubble', 'none');
  setVis('hex-count-label', 'none');
}

function bindEvents() {
  const refresh = () => {
    updateViewportGrid();
    paintHexesFromGrid();
  };
  map.on('moveend', refresh);
  map.on('zoomend', refresh);

  // Clicks (use the big hit first, but support all three)
  const handleHexClick = (e) => {
    const f = e?.features?.[0];
    const idx = f?.properties?.idx; // unified property name
    if (idx && hexClickCb) hexClickCb(idx);
  };

  map.on('click', 'hex-count-hit', handleHexClick);
  map.on('click', 'hex-count-bubble', handleHexClick);
  map.on('click', 'hex-count-label', handleHexClick);

  // Cursor
  map.on('mouseenter', 'hex-count-hit', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'hex-count-hit', () => { map.getCanvas().style.cursor = ''; });
}

/* ---------------- viewport grid (adaptive) ---------------- */

function updateViewportGrid() {
  const b = map.getBounds();
  const zoom = map.getZoom();

  // Adaptive H3 resolution
  let res = zoomToResolution(zoom);

  // Build polygon loops for the current viewport
  const west  = b.getWest();
  const east  = b.getEast();
  const south = b.getSouth();
  const north = b.getNorth();

  const loops = west <= east
    ? [makeLoop(south, west, north, east)]
    : [ makeLoop(south, west, north, 180), makeLoop(south, -180, north, east) ];

  // Try to generate cells; if too many, coarsen (decrease resolution)
  let cells = [];
  let attempts = 0;
  while (attempts < 6) {
    cells = loops.flatMap(loop => toCells([loop], res));
    if (cells.length <= MAX_CELLS) break;
    res = Math.max(0, res - 1); // coarser
    attempts++;
  }

  gridCells = new Set(cells);
}

function zoomToResolution(zoom) {
  if (zoom < 3)   return 3;
  if (zoom < 5)   return 4;
  if (zoom < 6.5) return 5;
  if (zoom < 8)   return 6;
  if (zoom < 10)  return 7;
  if (zoom < 12)  return 8;
  if (zoom < 13.5)return 9;
  return 10;
}

function makeLoop(south, west, north, east) {
  // H3 expects [lat, lng]
  return [
    [south, west],
    [north, west],
    [north, east],
    [south, east],
    [south, west],
  ];
}

/**
 * Cross-version helper:
 * - h3-js v4: polygonToCells(polygon, res)
 * - h3-js v3: polyfill(polygon, res)
 */
function toCells(polygonLoops, res) {
  try {
    if (typeof h3.polygonToCells === 'function') {
      return h3.polygonToCells(polygonLoops, res) || [];
    }
    if (typeof h3.polyfill === 'function') {
      return h3.polyfill(polygonLoops, res) || [];
    }
  } catch (e) {
    console.warn('[h3layers] toCells error (will coarsen or fallback):', e);
  }
  return [];
}

/* ---------------- painting ---------------- */

function paintHexesFromGrid() {
  // OUTLINE polygons
  const outlineFeatures = [];
  for (const idx of gridCells) {
    const ringLL = h3.cellToBoundary(idx, true);         // [lat, lng]
    const ringXY = ringLL.map(([lat, lon]) => [lon, lat]); // [lng, lat]
    outlineFeatures.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...ringXY, ringXY[0]]] },
      properties: { idx },
    });
  }
  setGeoJSON('hexes', { type: 'FeatureCollection', features: outlineFeatures });

  // CENTERS (with counts if provided)
  paintCentersOnly();
}

function paintCentersOnly() {
  const centerFeatures = [];
  for (const idx of gridCells) {
    const [latC, lngC] = h3.cellToLatLng(idx);
    const count = countsForCenters.get(idx) ?? 1;
    centerFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lngC, latC] },
      properties: { idx, count },
    });
  }

  // Fallback: draw one at map center if empty (debug)
  if (centerFeatures.length === 0) {
    try {
      const c = map.getCenter();
      const res = zoomToResolution(map.getZoom());
      const idx = h3.latLngToCell(c.lat, c.lng, res);
      centerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: { idx, count: 1, _debug: true },
      });
      console.warn('[h3layers] grid empty; drew center debug hex:', idx);
    } catch {}
  }

  setGeoJSON('hex-centers', { type: 'FeatureCollection', features: centerFeatures });
}

function paintDots() {
  setGeoJSON('dots', {
    type: 'FeatureCollection',
    features: (measurements || []).map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { id: p.id, type: p.type, provider: p.provider },
    })),
  });
}

/* ---------------- utils ---------------- */

function setGeoJSON(sourceId, fc) {
  const s = map.getSource(sourceId);
  if (s && typeof s.setData === 'function') s.setData(fc);
}

function setVis(id, v) {
  if (!map.getLayer(id)) return;
  map.setLayoutProperty(id, 'visibility', v);
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }
