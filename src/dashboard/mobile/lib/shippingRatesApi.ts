import { supabase } from '../../contexts/AuthContext';

export interface ZoneRow {
  id: string;
  name: string;
  code: string;
}

export interface ShippingRateRow {
  id: string;
  origin_hub_id: string;
  destination_zone_id: string;
  courier_id: string;
  flat_rate: number;
  base_rate: number;
  additional_weight_rate: number;
  per_kg_rate: number;
  vat_percentage: number;
  min_weight: number;
  max_weight: number;
  free_shipping_threshold: number;
  delivery_timeline_days: number;
  is_active: boolean;
  hubs?: { name: string; code: string };
  zones?: { name: string; code: string };
  couriers?: { name: string; code: string };
}

export interface ShippingRateFormData {
  origin_hub_id: string;
  destination_zone_id: string;
  courier_id: string;
  flat_rate: number;
  additional_weight_rate: number;
  vat_percentage: number;
  min_weight: number;
  max_weight: number;
  free_shipping_threshold: number;
  delivery_timeline_days: number;
  is_active: boolean;
}

export const emptyRateForm = (): ShippingRateFormData => ({
  origin_hub_id: '',
  destination_zone_id: '',
  courier_id: '',
  flat_rate: 0,
  additional_weight_rate: 0,
  vat_percentage: 7.5,
  min_weight: 0.5,
  max_weight: 4,
  free_shipping_threshold: 0,
  delivery_timeline_days: 3,
  is_active: true,
});

export function rateFormFromRow(rate: ShippingRateRow): ShippingRateFormData {
  return {
    origin_hub_id: rate.origin_hub_id,
    destination_zone_id: rate.destination_zone_id,
    courier_id: rate.courier_id,
    flat_rate: rate.flat_rate || rate.base_rate || 0,
    additional_weight_rate: rate.additional_weight_rate || rate.per_kg_rate || 0,
    vat_percentage: rate.vat_percentage ?? 7.5,
    min_weight: rate.min_weight ?? 0.5,
    max_weight: rate.max_weight ?? 4,
    free_shipping_threshold: rate.free_shipping_threshold ?? 0,
    delivery_timeline_days: rate.delivery_timeline_days ?? 3,
    is_active: rate.is_active ?? true,
  };
}

export function rateDisplayPrice(rate: ShippingRateRow): number {
  return rate.flat_rate || rate.base_rate || 0;
}

export function ratePerKg(rate: ShippingRateRow): number {
  return rate.additional_weight_rate || rate.per_kg_rate || 0;
}

function apiUrls(path: string): string[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const full = normalized.startsWith('/api/') ? normalized : `/api${normalized}`;
  const urls = [full];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${full}`);
  }
  return urls;
}

async function ratesFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    ...(init?.headers || {}),
  };

  let lastError: Error | null = null;
  const urls = apiUrls(path);
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.status === 404 && i < urls.length - 1) continue;
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
      return json as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
      if (i < urls.length - 1) continue;
    }
  }
  throw lastError || new Error('Request failed');
}

export async function fetchShippingRates(): Promise<ShippingRateRow[]> {
  const res = await ratesFetch<{ data?: ShippingRateRow[] }>('/shipping-rates');
  return res.data || [];
}

export async function fetchZones(): Promise<ZoneRow[]> {
  const res = await ratesFetch<{ data?: ZoneRow[] }>('/zones');
  return res.data || [];
}

export async function saveShippingRate(editingId: string | null, body: ShippingRateFormData) {
  const path = editingId ? `/shipping-rates/${editingId}` : '/shipping-rates';
  return ratesFetch<{ success?: boolean; data?: ShippingRateRow }>(path, {
    method: editingId ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteShippingRate(id: string) {
  return ratesFetch<{ success?: boolean }>(`/shipping-rates/${id}`, { method: 'DELETE' });
}
