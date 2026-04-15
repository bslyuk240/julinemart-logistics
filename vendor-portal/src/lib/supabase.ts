import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnon) {
  console.warn('Supabase env vars not set — auth will not work');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnon || '');

/**
 * Public Storage URLs must include `/object/public/{bucket}/...`.
 * URLs like `/object/{bucket}/...` (missing `public`) return 400 in the browser.
 */
export function ensureSupabaseStoragePublicUrl(url: string | null | undefined): string {
  if (!url || typeof url !== 'string') return '';
  const t = url.trim();
  if (!t) return '';
  if (t.includes('/storage/v1/object/public/')) return t;
  if (t.includes('/storage/v1/object/sign/')) return t;
  return t.replace(
    /(\/storage\/v1\/object\/)(?!public\/|sign\/)([^/]+)\//,
    '$1public/$2/'
  );
}
