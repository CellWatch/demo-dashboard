// src/utils/fetchMeasurements.js
import { supabase } from './supabase';

export async function fetchMeasurements() {
  const { data, error } = await supabase
    .from('measurements')
    .select(`
      *,
      cells(*),
      locations(*),
      upload_download_data(*),
      latency_data(*)
    `);

  if (error) {
    if (error.message === 'Invalid API key') {
      console.log('invalid supabase token — clearing & reloading');
      localStorage.clear();
      window.location.reload();
    } else {
      throw new Error(`error fetching measurements: ${JSON.stringify(error)}`);
    }
  }

  return data;
}
