function setupMap() {
  try {
    mapboxgl.accessToken = window.mapboxToken

    let map
    map = new mapboxgl.Map({
      container: 'map', // container ID
      style: 'mapbox://styles/mapbox/streets-v12', // style URL
      center: [-84.396, 33.777], // starting position [lng, lat]
      zoom: 12, // starting zoom
    });

    map.addControl(new MapboxGeocoder({
      accessToken: mapboxgl.accessToken,
      mapboxgl,
    }), 'top-left')

    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: {enableHighAccuracy: true},
    }), 'top-left')

    map.addControl(new LegendControl(
      measurementColorMinSaturation,
      {
        name: 'latency (ms)',
        minLabel: 0,
        maxLabel: measurementColors.latency.max,
        hue: measurementColors.latency.hue,
        invert: measurementColors.latency.invert,
      },
      {
        name: 'download (Mbps)',
        minLabel: 0,
        maxLabel: measurementColors.download.max * 1e-6,
        hue: measurementColors.download.hue,
        invert: measurementColors.download.invert,
      },
      {
        name: 'upload (Mbps)',
        minLabel: 0,
        maxLabel: measurementColors.upload.max * 1e-6,
        hue: measurementColors.upload.hue,
        invert: measurementColors.upload.invert,
      },
    ), 'bottom-right')


    const measurementsPromise = fetchMeasurements()

    map.on('load', async () => {
      const measurements = await measurementsPromise
      const features = measurements.map(measurementToFeature)
      const collection = {type: 'FeatureCollection', features}

      map.addSource('measurements', {type: 'geojson', data: collection})
      map.addLayer({
        id: 'measurements',
        type: 'circle',
        source: 'measurements',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 8,
        }
      })

      map.addControl(new FilterControl(
        collection,
        map.getSource('measurements'),
        {name: 'Type', field: 'type'},
        {name: 'Provider', field: 'provider'},
      ), 'top-right')
    })


    map.on('click', 'measurements', e => {
      const m = JSON.parse(e.features[0].properties.measurement)
      console.log('clicked!', m)
      new mapboxgl.Popup()
        .setHTML(measurementToHtml(m))
        .setLngLat(e.features[0].geometry.coordinates)
        .addTo(map)
    })

    map.on('mouseenter', 'measurements', () => {map.getCanvas().style.cursor = 'pointer'})
    map.on('mouseleave', 'measurements', () => {map.getCanvas().style.cursor = ''})
  } catch (e) {
    if (typeof e === 'object' && e && e.message === 'Invalid token') {
      console.log('invalid mapbox token -- clearing and reloading')
      localStorage.clear()
      window.location.reload()
    } else {
      throw e
    }
  }
}