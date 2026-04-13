/**
 * API client for JLO Netlify functions.
 * All vendor endpoints require a Supabase JWT in the Authorization header.
 */
import { supabase } from './supabase';

const JLO_BASE = (import.meta.env.VITE_JLO_API_URL as string || '').replace(/\/$/, '');

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
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
  getProfile:    ()              => request<any>('vendor-profile'),
  updateProfile: (body: object)  => request<any>('vendor-profile', { method: 'PUT', body: JSON.stringify(body) }),

  getStats:      ()              => request<any>('vendor-stats'),

  getProducts:   (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`vendor-my-products${qs}`);
  },

  getOrders: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<any>(`vendor-my-orders${qs}`);
  },
  getOrder: (id: string) => request<any>(`vendor-my-orders?id=${id}`),

  getEarnings: (period?: string) => {
    const qs = period ? `?period=${period}` : '';
    return request<any>(`vendor-earnings${qs}`);
  },

  getProductMeta: (type: 'categories' | 'tags') =>
    request<unknown[]>(`vendor-product-meta?type=${type}`),

  /** Next CAT-VEN-### style SKU — same DB-wide sequence as JLO admin (service-backed). */
  suggestNextSku: (body: { prefix: string; extra_skus?: string[] }) =>
    request<{ max_suffix: number; next_suffix: number; next_sku: string }>('product-sku-next', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  upsertProduct: (body: object, id?: string) => {
    const qs = id ? `?id=${id}` : '';
    return request<unknown>(`vendor-product-upsert${qs}`, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    });
  },

  deleteProduct: (id: string) =>
    request<unknown>(`vendor-product-upsert?id=${id}`, { method: 'DELETE' }),

  getWithdrawals:     ()             => request<any[]>('vendor-withdrawals'),
  requestWithdrawal:  (body: object) => request<any>('vendor-withdrawals', { method: 'POST', body: JSON.stringify(body) }),
  updateWithdrawal:   (id: string, body: object) =>
    request<any>(`vendor-withdrawals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
};
