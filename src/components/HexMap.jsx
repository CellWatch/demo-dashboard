// src/components/HexMap.jsx
import React, { useRef, useEffect, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { latLngToCell, cellToBoundary, cellToChildren, cellToLatLng } from 'h3-js'
import {
  fetchMeasurements,
  measurementToFeature,
  extractNumericValueForColoring,
  colorFromTypeValue,
} from '../utils/measurementUtils'

const ZOOM_THRESHOLD = 8
const H3_RESOLUTION = 8
const INNER_RESOLUTION = 9
const HEX_MAXZOOM = 12
const FALLBACK_COLOR = '#4B7BEC'

export default function HexMap({
  mode = 'hex',
  onPointClick = () => {},
  onInnerHexClick = () => {},
}) {
  const mapContainer = useRef(null)
  const mapRef = useRef(null)
  const [features, setFeatures] = useState([])
  const innerActiveRef = useRef(false)

  useEffect(() => {
    let alive = true
    fetchMeasurements()
      .then(rows => {
        if (!alive) return
        const feats = rows.map(measurementToFeature).filter(Boolean)
        setFeatures(feats)
      })
      .catch(err => {
        console.error('fetchMeasurements failed:', err)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v10',
      center: [-84.396, 33.777],
      zoom: 11,
    })
    mapRef.current = map

    let gridTimer = null
    const scheduleUpdateGrid = () => { clearTimeout(gridTimer); gridTimer = setTimeout(updateGrid, 150) }

    map.on('load', () => {
      map.addSource('measurements', { type: 'geojson', data: emptyFC() })
      map.addSource('h3-source', { type: 'geojson', data: emptyFC() })
      map.addSource('h3-centers', { type: 'geojson', data: emptyFC() })
      map.addSource('inner-h3-source', { type: 'geojson', data: emptyFC() })
      map.addSource('inner-h3-centers', { type: 'geojson', data: emptyFC() })

      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'measurements',
        paint: { 'circle-radius': 6, 'circle-color': ['coalesce', ['get', 'color'], FALLBACK_COLOR] },
      })

      map.addLayer({
        id: 'h3-layer',
        type: 'fill',
        source: 'h3-source',
        maxzoom: HEX_MAXZOOM,
        paint: {
          'fill-color': ['coalesce', ['get', 'color'], FALLBACK_COLOR],
          'fill-opacity': 0.6,
          'fill-outline-color': '#ffffff',
        },
      })

      map.addLayer({
        id: 'h3-center-point',
        type: 'circle',
        source: 'h3-centers',
        maxzoom: HEX_MAXZOOM,
        paint: { 'circle-radius': 3, 'circle-color': '#ffffff', 'circle-stroke-color': '#2c3e50', 'circle-stroke-width': 1 },
      })

      map.addLayer({
        id: 'h3-count',
        type: 'symbol',
        source: 'h3-centers',
        maxzoom: HEX_MAXZOOM,
        layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 12, 'text-offset': [0, 1.1] },
        paint: { 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
      })

      map.addLayer({
        id: 'inner-h3-layer',
        type: 'fill',
        source: 'inner-h3-source',
        paint: { 'fill-color': '#20BF6B', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 16, 0.15], 'fill-outline-color': '#0B5345' },
      })

      map.addLayer({
        id: 'inner-h3-center-point',
        type: 'circle',
        source: 'inner-h3-centers',
        paint: { 'circle-radius': 3, 'circle-color': '#ffffff', 'circle-stroke-color': '#145A32', 'circle-stroke-width': 1 },
      })

      map.addLayer({
        id: 'inner-h3-count',
        type: 'symbol',
        source: 'inner-h3-centers',
        layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 12, 'text-offset': [0, 1.1] },
        paint: { 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
      })

      map.on('mouseenter', 'points-layer', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'points-layer', () => { map.getCanvas().style.cursor = '' })
      map.on('click', 'points-layer', e => {
        const f = e.features?.[0]
        if (f) onPointClick(f.properties.measurement)
      })

      map.on('click', 'h3-layer', e => {
        const f = e.features?.[0]
        if (!f) return
        const parent = f.properties?.idx
        if (!parent) return

        const children = cellToChildren(parent, INNER_RESOLUTION)
        const [plat, plon] = cellToLatLng(parent)

        // pick the center child (closest to parent centroid)
        let centerChild = null, best = Infinity
        for (const c of children) {
          const [clat, clon] = cellToLatLng(c)
          const d = Math.hypot(clat - plat, clon - plon)
          if (d < best) { best = d; centerChild = c }
        }

        const polys = []
        const centers = []
        for (const ch of children) {
          if (ch === centerChild) continue
          let count = 0
          for (const pf of features) {
            const [lng, lat] = pf.geometry.coordinates
            if (latLngToCell(lat, lng, INNER_RESOLUTION) === ch) count++
          }
          const ring = cellToBoundary(ch, true).map(([lat, lng]) => [lng, lat])
          polys.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
            properties: { idx: ch, count },
          })
          const [clat, clon] = cellToLatLng(ch)
          centers.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [clon, clat] },
            properties: { idx: ch, count },
          })
        }

        setSourceData(map, 'inner-h3-source', polys)
        setSourceData(map, 'inner-h3-centers', centers)
        innerActiveRef.current = true
        enforceMode()
      })

      map.on('click', 'inner-h3-layer', e => {
        const f = e.features?.[0]
        if (!f) return
        const idx = f.properties?.idx
        const items = []
        for (const pf of features) {
          const [lng, lat] = pf.geometry.coordinates
          if (latLngToCell(lat, lng, INNER_RESOLUTION) === idx) items.push(pf.properties.measurement)
        }
        onInnerHexClick(items)
      })

      map.on('moveend', scheduleUpdateGrid)
      map.on('zoomend', () => { scheduleUpdateGrid(); enforceMode() })

      setSourceData(map, 'measurements', features)
      scheduleUpdateGrid()
      enforceMode()
    })

    function enforceMode() {
      const map = mapRef.current
      if (!map?.isStyleLoaded()) return
      const zoom = map.getZoom()
      const showHex = mode === 'hex' && zoom >= ZOOM_THRESHOLD
      const showPoints = !showHex

      setLayerVis(map, 'h3-layer', showHex)
      setLayerVis(map, 'h3-center-point', showHex)
      setLayerVis(map, 'h3-count', showHex)

      const innerVis = showHex && innerActiveRef.current
      setLayerVis(map, 'inner-h3-layer', innerVis)
      setLayerVis(map, 'inner-h3-center-point', innerVis)
      setLayerVis(map, 'inner-h3-count', innerVis)

      setLayerVis(map, 'points-layer', showPoints)
    }

    function updateGrid() {
      const map = mapRef.current
      if (!map?.isStyleLoaded()) return

      const zoom = map.getZoom()
      if (zoom < ZOOM_THRESHOLD) {
        setSourceData(map, 'h3-source', [])
        setSourceData(map, 'h3-centers', [])
        setSourceData(map, 'inner-h3-source', [])
        setSourceData(map, 'inner-h3-centers', [])
        innerActiveRef.current = false
        return
      }

      // Aggregate all features to res8
      const agg = new Map()
      for (const f of features) {
        const [lng, lat] = f.geometry.coordinates || []
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        const idx = latLngToCell(lat, lng, H3_RESOLUTION)
        let bucket = agg.get(idx)
        if (!bucket) { bucket = { typeCounts: {}, values: {} }; agg.set(idx, bucket) }
        const m = f.properties.measurement
        const val = extractNumericValueForColoring(m)
        const t = m?.type ?? 'unknown'
        bucket.typeCounts[t] = (bucket.typeCounts[t] || 0) + 1
        ;(bucket.values[t] ||= []).push(Number.isFinite(val) ? val : 0)
      }

      const hexFeatures = []
      const centerFeatures = []
      for (const [idx, bucket] of agg.entries()) {
        const dominantType = Object.entries(bucket.typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown'
        const vals = bucket.values[dominantType] || []
        const avg = vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length) : 0
        const ring = cellToBoundary(idx, true).map(([lat, lng]) => [lng, lat])

        hexFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
          properties: {
            idx,
            count: vals.length,
            type: dominantType,
            color: colorFromTypeValue(dominantType, avg) || FALLBACK_COLOR,
          },
        })

        const [clat, clon] = cellToLatLng(idx)
        centerFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [clon, clat] },
          properties: { idx, count: vals.length },
        })
      }

      console.debug('[HexMap] res8 cells:', hexFeatures.length)
      setSourceFC(map, 'h3-source', hexFeatures)
      setSourceFC(map, 'h3-centers', centerFeatures)
      innerActiveRef.current = false
      setSourceData(map, 'inner-h3-source', [])
      setSourceData(map, 'inner-h3-centers', [])
    }

    map.setPointsData = (feats) => setSourceData(mapRef.current, 'measurements', feats)
    map.updateGrid = updateGrid
    map.enforceMode = enforceMode

    return () => {
      clearTimeout(gridTimer)
      map.remove()
      mapRef.current = null
    }
  }, [mode, onPointClick, onInnerHexClick, features])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    setSourceData(map, 'measurements', features)
    map.updateGrid?.()
    map.enforceMode?.()
  }, [features])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    map.enforceMode?.()
    map.updateGrid?.()
  }, [mode])

  return <div ref={mapContainer} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }} />
}

/* ---------- helpers ---------- */

function emptyFC() { return { type: 'FeatureCollection', features: [] } }
function toFC(featuresArray) { return { type: 'FeatureCollection', features: featuresArray } }

function setSourceData(map, sourceId, dataOrFeatures) {
  const src = map.getSource(sourceId)
  if (!src) return
  let fc  
  if (Array.isArray(dataOrFeatures)) fc = toFC(dataOrFeatures)
  else if (Array.isArray(dataOrFeatures.features)) fc = dataOrFeatures
  else fc = toFC(dataOrFeatures) // assume array of Features
  try { src.setData(fc) } catch (e) { console.error(`setData failed for ${sourceId}:`, e) }
}

function setSourceFC(map, sourceId, features) {
  setSourceData(map, sourceId, features)
}

function setLayerVis(map, layerId, visible) {
  if (!map.getLayer(layerId)) return
  map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
}