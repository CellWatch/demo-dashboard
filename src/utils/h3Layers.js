import * as h3 from 'h3-js'

const HEX_RES = 8
const INNER_RES = 9
const HEX_MAXZOOM = 12

let map
let mode = 'dots'
let measurements = []
let hexAgg
let innerActive = null

export function initH3Layers(m, initialMeasurements) {
  map = m
  measurements = initialMeasurements
  hexAgg = aggregateToHex(measurements, HEX_RES)
  addSources()
  addLayers()
  bindEvents()
  setMode('dots')
}

export function setMode(next) {
  mode = next
  const dotsVisible = mode === 'dots' ? 'visible' : 'none'
  const hexVisible = mode === 'hex' ? 'visible' : 'none'
  setVis('dots-circle', dotsVisible)
  setVis('hex-fill', hexVisible)
  setVis('hex-center-point', hexVisible)
  setVis('hex-count', hexVisible)
  const innerVis = mode === 'hex' && innerActive ? 'visible' : 'none'
  setVis('inner-hex-fill', innerVis)
  setVis('inner-hex-center-point', innerVis)
  setVis('inner-hex-count', innerVis)
  if (mode === 'dots') clearSidebar()
}

export function setMeasurements(nextPoints) {
  measurements = nextPoints
  hexAgg = aggregateToHex(measurements, HEX_RES)
  setGeoJSON('dots', dotsGeoJSON(measurements))
  setGeoJSON('hexes', hexGeoJSON(hexAgg))
  setGeoJSON('hex-centers', hexCentersGeoJSON(hexAgg))
  innerActive = null
  setGeoJSON('inner-hexes', emptyFC())
  setGeoJSON('inner-hex-centers', emptyFC())
  setMode(mode)
  clearSidebar()
}

function aggregateToHex(points, res) {
  const m = new Map()
  for (const p of points) {
    const i = h3.geoToH3(p.lat, p.lon, res)
    const v = m.get(i)
    if (v) { v.count++; v.points.push(p) } else { m.set(i, {count:1, points:[p]}) }
  }
  return m
}

function hexGeoJSON(agg) {
  const features = []
  for (const [hex, v] of agg.entries()) {
    const coords = h3.h3ToGeoBoundary(hex, true).map(([lat, lon]) => [lon, lat])
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]]},
      properties: { hex, count: v.count }
    })
  }
  return { type: 'FeatureCollection', features }
}

function hexCentersGeoJSON(agg) {
  const features = []
  for (const [hex, v] of agg.entries()) {
    const [lat, lon] = h3.h3ToGeo(hex)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat]},
      properties: { hex, count: v.count }
    })
  }
  return { type: 'FeatureCollection', features }
}

function dotsGeoJSON(points) {
  return {
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat]},
      properties: {}
    }))
  }
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] }
}

function addSources() {
  map.addSource('dots', { type:'geojson', data: dotsGeoJSON(measurements) })
  map.addSource('hexes', { type:'geojson', data: hexGeoJSON(hexAgg) })
  map.addSource('hex-centers', { type:'geojson', data: hexCentersGeoJSON(hexAgg) })
  map.addSource('inner-hexes', { type:'geojson', data: emptyFC() })
  map.addSource('inner-hex-centers', { type:'geojson', data: emptyFC() })
}

function addLayers() {
  map.addLayer({
    id:'dots-circle',
    type:'circle',
    source:'dots',
    paint:{'circle-radius':4,'circle-opacity':0.9}
  })
  map.addLayer({
    id:'hex-fill',
    type:'fill',
    source:'hexes',
    maxzoom: HEX_MAXZOOM,
    paint:{
      'fill-color':['case',['>', ['get','count'], 0], '#4B7BEC', '#00000000'],
      'fill-opacity':['interpolate',['linear'],['zoom'],6,0.35, HEX_MAXZOOM,0.2],
      'fill-outline-color':'#34495e'
    }
  })
  map.addLayer({
    id:'hex-center-point',
    type:'circle',
    source:'hex-centers',
    maxzoom: HEX_MAXZOOM,
    paint:{'circle-radius':3,'circle-color':'#ffffff','circle-stroke-color':'#2c3e50','circle-stroke-width':1}
  })
  map.addLayer({
    id:'hex-count',
    type:'symbol',
    source:'hex-centers',
    maxzoom: HEX_MAXZOOM,
    layout:{'text-field':['to-string',['get','count']],'text-size':12,'text-offset':[0,1.1]},
    paint:{'text-halo-color':'#ffffff','text-halo-width':1}
  })
  map.addLayer({
    id:'inner-hex-fill',
    type:'fill',
    source:'inner-hexes',
    paint:{
      'fill-color':'#20BF6B',
      'fill-opacity':['interpolate',['linear'],['zoom'],10,0.35,16,0.15],
      'fill-outline-color':'#0B5345'
    }
  })
  map.addLayer({
    id:'inner-hex-center-point',
    type:'circle',
    source:'inner-hex-centers',
    paint:{'circle-radius':3,'circle-color':'#ffffff','circle-stroke-color':'#145A32','circle-stroke-width':1}
  })
  map.addLayer({
    id:'inner-hex-count',
    type:'symbol',
    source:'inner-hex-centers',
    layout:{'text-field':['to-string',['get','count']],'text-size':12,'text-offset':[0,1.1]},
    paint:{'text-halo-color':'#ffffff','text-halo-width':1}
  })
}

function bindEvents() {
  map.on('click','hex-fill', e => {
    if (!e.features?.length) return
    const f = e.features[0]
    const parent = f.properties?.hex
    innerActive = buildInnerHexes(parent)
    setGeoJSON('inner-hexes', {type:'FeatureCollection', features: innerActive.features})
    setGeoJSON('inner-hex-centers', innerCenters(innerActive.features))
    setMode('hex')
    clearSidebar()
  })
  map.on('click','inner-hex-fill', e => {
    if (!e.features?.length) return
    const hex = e.features[0].properties?.hex
    const items = measurements.filter(m => h3.geoToH3(m.lat, m.lon, INNER_RES) === hex)
    renderSidebar(items)
  })
}

function setGeoJSON(sourceId, fc) {
  const s = map.getSource(sourceId)
  s.setData(fc)
}

function setVis(id, v) {
  if (!map.getLayer(id)) return
  map.setLayoutProperty(id,'visibility', v)
}

function buildInnerHexes(parent) {
  const children = h3.h3ToChildren(parent, INNER_RES)
  const pc = h3.h3ToGeo(parent)
  const centerChild = children.map(c => ({c, d: dist(pc, h3.h3ToGeo(c))})).sort((a,b)=>a.d-b.d)[0].c
  const ring = children.filter(c => c !== centerChild)
  const features = []
  for (const ch of ring) {
    let count = 0
    for (const m of measurements) if (h3.geoToH3(m.lat, m.lon, INNER_RES) === ch) count++
    const coords = h3.h3ToGeoBoundary(ch, true).map(([lat, lon]) => [lon, lat])
    features.push({
      type:'Feature',
      geometry:{type:'Polygon', coordinates:[[...coords, coords[0]]]},
      properties:{hex: ch, count}
    })
  }
  return {parent, features}
}

function innerCenters(features) {
  return {
    type:'FeatureCollection',
    features: features.map(f => {
      const [lat, lon] = h3.h3ToGeo(f.properties.hex)
      return {type:'Feature', geometry:{type:'Point', coordinates:[lon, lat]}, properties:{hex:f.properties.hex, count:f.properties.count}}
    })
  }
}

function dist(a,b) {
  const r=x=>x*Math.PI/180
  const R=6371
  const dLat=r(b[0]-a[0])
  const dLon=r(b[1]-a[1])
  const s1=Math.sin(dLat/2)**2
  const s2=Math.cos(r(a[0]))*Math.cos(r(b[0]))*Math.sin(dLon/2)**2
  return 2*R*Math.asin(Math.sqrt(s1+s2))
}

function renderSidebar(items) {
  const el = document.getElementById('sidebar')
  if (!el) return
  el.innerHTML = ''
  const head = document.createElement('div')
  head.textContent = `Measurements: ${items.length}`
  el.appendChild(head)
  const list = document.createElement('ul')
  items.forEach(it => {
    const li = document.createElement('li')
    li.textContent = JSON.stringify(it)
    list.appendChild(li)
  })
  el.appendChild(list)
}

function clearSidebar() {
  const el = document.getElementById('sidebar')
  if (el) el.innerHTML = ''
}
