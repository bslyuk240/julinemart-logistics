/**
 * API client for JLO Netlify functions.
 * All rider endpoints require a Supabase JWT in the Authorization header —
 * see netlify/functions/services/requireRider.js in the main JLO repo.
 */
import { supabase } from './supabase';
import { getDeviceId } from './device';

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

export type EarningsDelivery = {
  id: string;
  tracking_number: string | null;
  order_number: string | null;
  fee: number;
  delivered_at: string;
};

export type EarningsResponse = {
  weekly_total: number;
  delivery_count: number;
  breakdown: EarningsDelivery[];
  sparkline: { date: string; amount: number }[];
};

export type RiderProfile = {
  full_name: string;
  email: string;
  phone: string;
  vehicle_type: string;
  vehicle_plate: string;
  guarantor_name: string;
  guarantor_phone: string;
  status: string;
  selfie_url: string | null;
  selfie_captured_at: string | null;
  member_since: string;
  town: string | null;
};

export const api = {
  ping: () => request<{ rider_id: string; status: string }>(`rider-ping?device_id=${encodeURIComponent(getDeviceId())}`),
  register: (payload: RiderApplicationPayload) =>
    request<{ rider_id: string; status: string }>('rider-register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getJobs: () => request<JobsResponse>('rider-jobs'),
  // job.id is a shipments.id — opaque to the caller, works the same
  // whether the job came from a marketplace order or a manual shipment.
  acceptJob: (shipment_id: string) =>
    request<{ accepted: boolean }>('rider-jobs', { method: 'POST', body: JSON.stringify({ shipment_id, action: 'accept' }) }),
  declineJob: (shipment_id: string) =>
    request<{ declined: boolean }>('rider-jobs', { method: 'POST', body: JSON.stringify({ shipment_id, action: 'decline' }) }),
  advanceJob: (shipment_id: string, target_status: string, opts: { delivery_proof_url?: string; scanned_code?: string } = {}) =>
    request<{ status: string }>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ shipment_id, action: 'advance', target_status, ...opts }),
    }),
  setOnline: (online: boolean) =>
    request<{ online: boolean }>('rider-online', { method: 'POST', body: JSON.stringify({ online }) }),
  checkinSelfie: (selfie_url: string) =>
    request<void>('rider-selfie-checkin', { method: 'POST', body: JSON.stringify({ selfie_url }) }),
  pingLocation: (lat: number, lng: number, accuracy?: number) =>
    request<void>('rider-location-ping', { method: 'POST', body: JSON.stringify({ lat, lng, accuracy }) }),
  getEarnings: () => request<EarningsResponse>('rider-earnings'),
  getProfile: () => request<RiderProfile>('rider-profile'),
  registerPushToken: (fcm_token: string) =>
    request<{ success: boolean }>('rider-register-push', { method: 'POST', body: JSON.stringify({ fcm_token }) }),
};
