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

export type RiderApplicationPayload = {
  full_name: string;
  phone: string;
  nin: string;
  id_document_url: string;
  selfie_url: string;
  vehicle_type: 'okada' | 'keke' | 'car' | 'foot';
  vehicle_plate: string;
  vehicle_document_url?: string;
  guarantor_name: string;
  guarantor_phone: string;
  approved_location_id: string;
};

export type JobLocation = { name?: string; address: string | null; city: string | null; state: string | null; phone?: string };
export type JobDropoff = {
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  landmark: string | null;
};

export type Job = {
  id: string;
  tracking_number: string | null;
  status: 'assigned' | 'picked_up' | 'out_for_delivery' | 'delivered';
  accepted: boolean;
  fee: number;
  order_number: string | null;
  pickup: JobLocation;
  dropoff: JobDropoff;
  delivery_proof_url: string | null;
  picked_up_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
};

export type JobsResponse = {
  pending: Job[];
  active: Job | null;
  today: { count: number; earnings: number };
  online: boolean;
};

export const api = {
  ping: () => request<{ rider_id: string; status: string }>('rider-ping'),
  register: (payload: RiderApplicationPayload) =>
    request<{ rider_id: string; status: string }>('rider-register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getJobs: () => request<JobsResponse>('rider-jobs'),
  acceptJob: (sub_order_id: string) =>
    request<{ accepted: boolean }>('rider-jobs', { method: 'POST', body: JSON.stringify({ sub_order_id, action: 'accept' }) }),
  declineJob: (sub_order_id: string) =>
    request<{ declined: boolean }>('rider-jobs', { method: 'POST', body: JSON.stringify({ sub_order_id, action: 'decline' }) }),
  advanceJob: (sub_order_id: string, target_status: string, delivery_proof_url?: string) =>
    request<{ status: string }>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ sub_order_id, action: 'advance', target_status, delivery_proof_url }),
    }),
  setOnline: (online: boolean) =>
    request<{ online: boolean }>('rider-online', { method: 'POST', body: JSON.stringify({ online }) }),
};
