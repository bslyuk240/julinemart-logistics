import { supabase } from '../../contexts/AuthContext';

export const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

export const TABBAR_SPACE = 'calc(58px + env(safe-area-inset-bottom))';

export async function functionsAuthHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}
