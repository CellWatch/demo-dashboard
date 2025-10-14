// src/utils/supabase.js
import { createClient } from '@supabase/supabase-js';

const url  = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
const dash = import.meta.env.VITE_DASHBOARD_SECRET;

export const supabase = createClient(url, anon, {
  global: {
    headers: {
      'x-dashboard-secret': dash,
      'Prefer': 'count=exact'
    }
  }
});
