import test from 'node:test'
import assert from 'node:assert/strict'

import { buildQuery } from '../src/utils/api.js'

test('buildQuery serializes only present values', () => {
  assert.equal(
    buildQuery({
      bbox: '-84,33,-83,34',
      limit: 20000,
      providers: 'at&t',
      empty: '',
      skip: null
    }),
    '?bbox=-84%2C33%2C-83%2C34&limit=20000&providers=at%26t'
  )
})

test('buildQuery returns empty string when nothing is set', () => {
  assert.equal(buildQuery({ empty: '', skip: null, nope: undefined }), '')
})
