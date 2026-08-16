/**
 * API client for JLO Netlify functions.
 * All rider endpoints require a Supabase JWT in the Authorization header —
 * see netlify/functions/services/requireRider.js in the main JLO repo.
 */
import { supabase } from './supabase';

const JLO_BASE = ((import.meta.env.VITE_JLO_API_URL as string) || '').replace(/\/$/, '');

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const url = `${JLO_BASE}/.netlify/functions/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data as T;
}

export const api = {
  ping: () => request<{ rider_id: string; status: string }>('rider-ping'),
};
