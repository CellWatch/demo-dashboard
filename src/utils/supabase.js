// src/utils/supabase.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// if you have extra headers (x-device-id, service role, etc) bring them in here:
export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    global: {
      headers: {
        // standard PostgREST headers
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,

        // any custom headers your RLS policies expect:
        'x-device-id':     import.meta.env.VITE_DEVICE_ID,
        'x-device-secret': import.meta.env.VITE_SUPABASE_SERVICE_KEY,
      },
    },
  }
);
