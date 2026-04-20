import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bboxContains,
  buildPointQueryKey,
  buildPointQueryPlans,
  buildSheetData,
  buildTypeFilterPlans,
  dominantTypeOfItems,
  expandBbox,
  extractStats,
  inferKindFromStats,
  mapApiPointToRow,
  normalizeProviderBucket,
  pointRowKey,
  shouldReuseViewportData
} from '../src/utils/hexMapData.js'

test('normalizeProviderBucket maps raw carriers into UI buckets', () => {
  assert.equal(normalizeProviderBucket('AT&T'), 'AT&T')
  assert.equal(normalizeProviderBucket('tmobile'), 'T-Mobile')
  assert.equal(normalizeProviderBucket('verizon wireless'), 'Verizon')
  assert.equal(normalizeProviderBucket('firstnet'), 'Other')
})

test('buildTypeFilterPlans converts enabled filters into backend query branches', () => {
  const plans = buildTypeFilterPlans({
    all: false,
    upload: { enabled: true, mode: 'above', threshold: '10' },
    download: { enabled: true, mode: 'below', threshold: '25' },
    latency: { enabled: true, mode: 'all', threshold: '' }
  })

  assert.deepEqual(plans, [
    { ul_min: 10 },
    { dl_max: 25 },
    { lat_min: 0 }
  ])
})

test('buildPointQueryPlans pushes date, conn, provider aliases, and OR type branches', () => {
  const plans = buildPointQueryPlans({
    bbox: '-84,33,-83,34',
    limit: 20000,
    typeFilters: {
      all: false,
      upload: { enabled: true, mode: 'above', threshold: '10' },
      download: { enabled: false, mode: 'all', threshold: '' },
      latency: { enabled: true, mode: 'below', threshold: '100' }
    },
    connTypes: ['4G', '5G'],
    providers: ['AT&T', 'Verizon'],
    dateBounds: {
      start: new Date('2026-01-01T00:00:00.000Z'),
      end: new Date('2026-01-31T23:59:59.000Z')
    }
  })

  assert.deepEqual(plans, [
    {
      bbox: '-84,33,-83,34',
      limit: 20000,
      conn: '4G,5G',
      providers: 'at&t,att,verizon,verizon wireless',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.000Z',
      ul_min: 10
    },
    {
      bbox: '-84,33,-83,34',
      limit: 20000,
      conn: '4G,5G',
      providers: 'at&t,att,verizon,verizon wireless',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.000Z',
      lat_max: 100
    }
  ])
})

test('buildPointQueryPlans keeps Other provider local by omitting provider param', () => {
  const [plan] = buildPointQueryPlans({
    bbox: '1,2,3,4',
    limit: 100,
    typeFilters: { all: true, upload: {}, download: {}, latency: {} },
    connTypes: ['Other'],
    providers: ['Other'],
    dateBounds: {}
  })

  assert.deepEqual(plan, {
    bbox: '1,2,3,4',
    limit: 100,
    conn: 'Other'
  })
})

test('expandBbox pads and clamps a viewport bbox', () => {
  assert.deepEqual(expandBbox([-10, -20, 10, 20], 0.25), [-15, -30, 15, 30])
  assert.deepEqual(expandBbox([-180, -80, 180, 90], 0.5), [-180, -90, 180, 90])
})

test('buildPointQueryKey ignores bbox while shouldReuseViewportData respects coverage and zoom', () => {
  const plansA = buildPointQueryPlans({
    bbox: '-84,33,-83,34',
    limit: 20000,
    typeFilters: { all: true, upload: {}, download: {}, latency: {} },
    connTypes: ['4G', '5G'],
    providers: ['AT&T'],
    dateBounds: {}
  })
  const plansB = buildPointQueryPlans({
    bbox: '-84.1,33,-83.1,34',
    limit: 20000,
    typeFilters: { all: true, upload: {}, download: {}, latency: {} },
    connTypes: ['4G', '5G'],
    providers: ['AT&T'],
    dateBounds: {}
  })

  const queryKey = buildPointQueryKey(plansA)
  assert.equal(queryKey, buildPointQueryKey(plansB))
  assert.equal(bboxContains([-90, 30, -80, 40], [-84, 33, -83, 34]), true)
  assert.equal(
    shouldReuseViewportData({
      visibleBbox: [-84, 33, -83, 34],
      coverageBbox: [-90, 30, -80, 40],
      currentZoom: 10.1,
      lastZoom: 10,
      queryKey,
      lastQueryKey: queryKey,
      zoomDeltaThreshold: 0.3
    }),
    true
  )
  assert.equal(
    shouldReuseViewportData({
      visibleBbox: [-84, 33, -83, 34],
      coverageBbox: [-90, 30, -80, 40],
      currentZoom: 10.5,
      lastZoom: 10,
      queryKey,
      lastQueryKey: queryKey,
      zoomDeltaThreshold: 0.3
    }),
    false
  )
})

test('extractStats prefers normalized tests and falls back to raw stats', () => {
  assert.deepEqual(
    extractStats({
      tests: {
        download: { mbps: '12.5' },
        upload: { mbps: '5.5' },
        latency: { ping_ms: '44', jitter_ms: '3', loss_pct: '0.5' }
      }
    }),
    { down: 12.5, up: 5.5, ping: 44, jitter: 3, loss: 0.5 }
  )

  assert.deepEqual(
    extractStats({
      stats: { dl_mbps: '20', ul_mbps: '10', rtt: '60', jitter: '8', loss_pct: '1' }
    }),
    { down: 20, up: 10, ping: 60, jitter: 8, loss: 1 }
  )
})

test('inferKindFromStats and dominantTypeOfItems classify measurements', () => {
  assert.equal(inferKindFromStats({ down: 10, up: null, ping: null, jitter: null, loss: null }), 'download')
  assert.equal(inferKindFromStats({ down: null, up: 3, ping: null, jitter: null, loss: null }), 'upload')
  assert.equal(inferKindFromStats({ down: null, up: null, ping: 45, jitter: 2, loss: 0 }), 'latency')
  assert.equal(
    dominantTypeOfItems(
      [
        { __stats: { down: 10, up: null, ping: null, jitter: null, loss: null } },
        { __stats: { down: 11, up: null, ping: null, jitter: null, loss: null } },
        { __stats: { down: null, up: null, ping: 45, jitter: 3, loss: 0 } }
      ],
      { all: true, upload: {}, download: {}, latency: {} }
    ),
    'download'
  )
})

test('buildSheetData summarizes items and preserves dominant type', () => {
  const data = buildSheetData(
    'abc123',
    [
      { __stats: { down: 10, up: 1, ping: 50, jitter: 5, loss: 0 } },
      { __stats: { down: 30, up: 3, ping: 70, jitter: 7, loss: 1 } }
    ],
    { all: false, upload: { enabled: false }, download: { enabled: true }, latency: { enabled: false } }
  )

  assert.equal(data.hexIdx, 'abc123')
  assert.equal(data.summary.count, 2)
  assert.equal(data.summary.down.avg, 20)
  assert.equal(data.summary.down.min, 10)
  assert.equal(data.summary.down.max, 30)
  assert.equal(data.domType, 'download')
})

test('pointRowKey prefers group id and otherwise uses a stable fallback payload', () => {
  assert.equal(pointRowKey({ group_id: 'gid-1' }), 'group:gid-1')
  assert.equal(
    pointRowKey({
      timestamp: '2026-01-01T00:00:00Z',
      provider: 'at&t',
      conn_tag: '4G',
      center: [-84.4, 33.7],
      stats: { down_mbps: 10 }
    }),
    JSON.stringify(['2026-01-01T00:00:00Z', 'at&t', '4G', [-84.4, 33.7], { down_mbps: 10 }])
  )
})

test('mapApiPointToRow normalizes API payloads into map rows', () => {
  const row = mapApiPointToRow({
    group_id: 'gid-2',
    provider: 'verizon wireless',
    conn_tag: '5G',
    timestamp: '2026-02-03T10:00:00Z',
    center: [-84.5, 33.8],
    stats: { down_mbps: 44, up_mbps: 12, ping_ms: 55, jitter_ms: 4, loss_pct: 0 }
  })

  assert.equal(row.id, 'gid-2')
  assert.equal(row.lat, 33.8)
  assert.equal(row.lon, -84.5)
  assert.equal(row.__providerBucket, 'Verizon')
  assert.deepEqual(row.__stats, { down: 44, up: 12, ping: 55, jitter: 4, loss: 0 })
})
