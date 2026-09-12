/**
 * API client for JLO Netlify functions.
 * All influencer endpoints require a Supabase JWT in the Authorization header.
 */
import { supabase } from './supabase';

const JLO_BASE = (import.meta.env.VITE_JLO_API_URL as string || '').replace(/\/$/, '');

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function rawRequest(path: string, options: RequestInit = {}): Promise<any> {
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
  return json;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const json = await rawRequest(path, options);
  return json.data as T;
}

export interface SalesPage<T> {
  data: T;
  count: number;
}

export const api = {
  getProfile:    ()             => request<any>('influencer-profile'),
  updateProfile: (body: object) => request<any>('influencer-profile', { method: 'PUT', body: JSON.stringify(body) }),
  getSales:      async (period: string, offset = 0): Promise<SalesPage<any[]>> => {
    const json = await rawRequest(`influencer-my-sales?period=${period}&offset=${offset}`);
    return { data: json.data || [], count: json.count || 0 };
  },
};
