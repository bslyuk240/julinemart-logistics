import { supabase } from '../../contexts/AuthContext';

export interface HubRow {
  id: string;
  name: string;
  code: string;
  address?: string;
  city: string;
  state: string;
  postcode?: string;
  phone: string;
  email?: string;
  manager_name: string;
  manager_phone?: string;
  is_active: boolean;
  is_sub_hub: boolean;
  parent_hub_id: string | null;
  parent_hub?: { id: string; name: string; city: string } | null;
}

export interface HubFormData {
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  phone: string;
  email: string;
  manager_name: string;
  manager_phone: string;
  is_active: boolean;
  is_sub_hub: boolean;
  parent_hub_id: string;
}

export interface CourierRow {
  id: string;
  name: string;
  code: string;
  contact_person?: string;
  contact_phone?: string;
  contact_email?: string;
  is_active: boolean;
  created_at?: string;
}

export interface CourierFormData {
  name: string;
  code: string;
  contact_person: string;
  contact_phone: string;
  contact_email: string;
  is_active: boolean;
}

export const emptyHubForm = (): HubFormData => ({
  name: '',
  code: '',
  address: '',
  city: '',
  state: '',
  postcode: '',
  phone: '',
  email: '',
  manager_name: '',
  manager_phone: '',
  is_active: true,
  is_sub_hub: false,
  parent_hub_id: '',
});

export const emptyCourierForm = (): CourierFormData => ({
  name: '',
  code: '',
  contact_person: '',
  contact_phone: '',
  contact_email: '',
  is_active: true,
});

export function hubFormFromRow(hub: HubRow): HubFormData {
  return {
    name: hub.name,
    code: hub.code,
    address: hub.address || '',
    city: hub.city,
    state: hub.state,
    postcode: hub.postcode || '',
    phone: hub.phone || '',
    email: hub.email || '',
    manager_name: hub.manager_name || '',
    manager_phone: hub.manager_phone || '',
    is_active: hub.is_active,
    is_sub_hub: hub.is_sub_hub,
    parent_hub_id: hub.parent_hub_id || '',
  };
}

export function courierFormFromRow(courier: CourierRow): CourierFormData {
  return {
    name: courier.name,
    code: courier.code,
    contact_person: courier.contact_person || '',
    contact_phone: courier.contact_phone || '',
    contact_email: courier.contact_email || '',
    is_active: courier.is_active,
  };
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

async function networkFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    ...(init?.headers || {}),
  };

  let lastError: Error | null = null;
  for (let i = 0; i < apiUrls(path).length; i += 1) {
    const url = apiUrls(path)[i];
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.status === 404 && i < apiUrls(path).length - 1) continue;
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
      return json as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
      if (i < apiUrls(path).length - 1) continue;
    }
  }
  throw lastError || new Error('Request failed');
}

export async function fetchHubs(): Promise<HubRow[]> {
  const res = await networkFetch<{ data?: HubRow[]; success?: boolean }>('/hubs');
  return res.data || [];
}

export async function saveHub(editingId: string | null, body: HubFormData) {
  const path = editingId ? `/hubs/${editingId}` : '/hubs';
  return networkFetch<{ success?: boolean; data?: HubRow }>(path, {
    method: editingId ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
}

export async function fetchCouriers(): Promise<CourierRow[]> {
  const res = await networkFetch<{ data?: CourierRow[]; success?: boolean }>('/couriers');
  return res.data || [];
}

export async function saveCourier(editingId: string | null, body: CourierFormData) {
  const path = editingId ? `/couriers/${editingId}` : '/couriers';
  return networkFetch<{ success?: boolean; data?: CourierRow }>(path, {
    method: editingId ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteCourier(id: string) {
  return networkFetch<{ success?: boolean }>(`/couriers/${id}`, { method: 'DELETE' });
}
