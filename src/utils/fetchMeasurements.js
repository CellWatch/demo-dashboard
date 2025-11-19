// src/utils/fetchMeasurements.js
import { supabase } from './supabase';

const MEAS_CHUNK = 500;

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows || []) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

export async function fetchMeasurementsByIds(ids) {
  const measById = new Map();
  const uniq = Array.from(new Set(ids || []));
  if (!uniq.length) return measById;

  for (let i = 0; i < uniq.length; i += MEAS_CHUNK) {
    const slice = uniq.slice(i, i + MEAS_CHUNK);

    // 1) Base measurements
    const { data: measRows, error: measErr } = await supabase
      .from('measurements')
      .select('id, provider, type, timestamp, extra_data')
      .in('id', slice);

    if (measErr) {
      console.error('[fetchMeasurementsByIds] measurements error:', measErr);
      continue;
    }

    for (const m of measRows || []) {
      measById.set(m.id, {
        ...m,
        upload_download_data: [],
        latency_data: [],
      });
    }

    // 2) Upload/download rows
    const { data: upRows, error: upErr } = await supabase
      .from('upload_download_data')
      .select(`
        id,
        measurement_id,
        warmup_duration,
        warmup_bytes,
        duration,
        bytes,
        servers,
        application_bytes,
        bytes_per_sec,
        application_bytes_per_sec,
        created_on,
        updated_on
      `)
      .in('measurement_id', slice);

    if (upErr) {
      console.error('[fetchMeasurementsByIds] upload_download_data error:', upErr);
    } else {
      const byMeasUp = groupBy(upRows, 'measurement_id');
      for (const [mid, rows] of byMeasUp.entries()) {
        const base = measById.get(mid);
        if (base) base.upload_download_data = rows;
      }
    }

    // 3) Latency rows
    const { data: latRows, error: latErr } = await supabase
      .from('latency_data')
      .select(`
        id,
        measurement_id,
        rtt,
        jitter,
        sent,
        received,
        servers,
        created_on,
        updated_on
      `)
      .in('measurement_id', slice);

    if (latErr) {
      console.error('[fetchMeasurementsByIds] latency_data error:', latErr);
    } else {
      const byMeasLat = groupBy(latRows, 'measurement_id');
      for (const [mid, rows] of byMeasLat.entries()) {
        const base = measById.get(mid);
        if (base) base.latency_data = rows;
      }
    }
  }

  return measById;
}
