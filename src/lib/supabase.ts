import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/supabase';

// Vite exposes VITE_* vars via import.meta.env in the browser bundle
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify → Site configuration → Environment variables.'
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
