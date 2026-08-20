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
  id_document_issue_date?: string;
  id_document_expiry_date?: string;
  selfie_url: string;
  vehicle_type: 'okada' | 'keke' | 'car' | 'foot';
  vehicle_plate: string;
  vehicle_document_url?: string;
  vehicle_document_issue_date?: string;
  vehicle_document_expiry_date?: string;
  guarantor_name: string;
  guarantor_phone: string;
  approved_location_id: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
};

export type DocumentType = 'id' | 'selfie' | 'vehicle';
export type DocumentStatus = 'pending' | 'verified' | 'rejected';

export type RiderDocument = {
  id: string;
  type: DocumentType;
  file_url: string;
  issue_date: string | null;
  expiry_date: string | null;
  status: DocumentStatus;
  verified_at: string | null;
  rejection_reason: string | null;
  created_at: string;
};

export type RiderDocumentsResponse = {
  current: RiderDocument[];
  history: RiderDocument[];
};

export type RiderNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  data: { targetPath?: string; [key: string]: unknown };
  read_at: string | null;
  created_at: string;
};

export type RiderNotificationsResponse = {
  items: RiderNotification[];
  unread_count: number;
};

// vendor: the vendor's own shop. hub: a JLO/courier hub or depot. sender:
// a manual shipment's free-text sender — could be anyone, not a vendor.
export type PickupKind = 'vendor' | 'hub' | 'sender';

// A pickup isn't always a marketplace vendor — showing "Vendor:"/"Call
// Vendor" for all of them was misleading. Shared by Home.tsx and
// ActiveDelivery.tsx.
export function pickupLabel(kind: PickupKind | undefined): string {
  if (kind === 'hub') return 'Hub';
  if (kind === 'sender') return 'Pickup';
  return 'Vendor';
}
export type JobLocation = {
  name?: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone?: string;
  kind?: PickupKind;
};
export type JobDropoff = {
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  landmark: string | null;
};

export type ProblemReason =
  | 'vendor_not_ready'
  | 'vendor_closed'
  | 'package_unavailable'
  | 'wrong_address'
  | 'customer_unreachable'
  | 'customer_refused'
  | 'package_damaged'
  | 'vehicle_breakdown'
  | 'safety_issue'
  | 'other';

export const PROBLEM_REASON_LABEL: Record<ProblemReason, string> = {
  vendor_not_ready: 'Vendor not ready',
  vendor_closed: 'Vendor closed',
  package_unavailable: 'Package unavailable',
  wrong_address: 'Wrong address',
  customer_unreachable: 'Customer unreachable',
  customer_refused: 'Customer refused delivery',
  package_damaged: 'Package damaged',
  vehicle_breakdown: 'Vehicle breakdown',
  safety_issue: 'Safety issue',
  other: 'Other',
};

export type ScanVerification = {
  verified: true;
  tracking_number: string | null;
  rider_name: string;
  from_custodian: string;
  to_custodian: string;
  pickup_name: string | null;
};

export type PodLevel = 'standard' | 'verified';

// Frozen at the same moment `fee` (rider_payout) itself gets frozen — see
// assign-rider.js/broadcast-rider.js. Only present for jobs dispatched after
// this existed; older/legacy ones just show the total with no breakdown.
export type FeeBreakdown = {
  base_rate: number;
  weight_charge: number;
  pickup_surcharge: number;
  total: number;
};

export type Job = {
  id: string;
  tracking_number: string | null;
  status: 'assigned' | 'picked_up' | 'out_for_delivery' | 'delivered' | 'return_required' | 'returning';
  accepted: boolean;
  fee: number;
  fee_breakdown: FeeBreakdown | null;
  order_number: string | null;
  pickup: JobLocation;
  dropoff: JobDropoff;
  delivery_proof_url: string | null;
  signature_url: string | null;
  pod_level: PodLevel;
  assigned_at: string | null;
  picked_up_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
};

export type JobsResponse = {
  pending: Job[];
  active: Job | null;
  available: Job[];
  today: { count: number; earnings: number };
  online: boolean;
  rider_name: string;
  rider_area: { city: string; state: string } | null;
};

export type ActivityStatusFilter = 'all' | 'active' | 'delivered' | 'failed' | 'returned';
export type ActivityStatus =
  | 'assigned'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'return_required'
  | 'returning'
  | 'returned';

export type ActivityItem = {
  id: string;
  tracking_number: string | null;
  order_number: string | null;
  status: ActivityStatus;
  fee: number;
  customer_name: string | null;
  dropoff_city: string | null;
  timestamp: string;
};

export type ActivityDetail = {
  id: string;
  tracking_number: string | null;
  order_number: string | null;
  status: ActivityStatus;
  fee: number;
  fee_breakdown: FeeBreakdown | null;
  pickup: JobLocation;
  dropoff: JobDropoff;
  delivery_proof_url: string | null;
  signature_url: string | null;
  pod_level: PodLevel;
  assigned_at: string | null;
  picked_up_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  failed_at: string | null;
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
  today_total: number;
  today_count: number;
  breakdown: EarningsDelivery[];
  sparkline: { date: string; amount: number }[];
  available_balance: number;
};

export type Withdrawal = {
  id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  bank_name: string | null;
  bank_account_number: string | null;
  notes: string | null;
  payment_reference: string | null;
  payment_date: string | null;
  created_at: string;
};

export type PendingBankChange = {
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  requested_at: string;
};

export type PendingVehicleChange = {
  vehicle_type: string;
  vehicle_plate: string;
  requested_at: string;
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
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  pending_bank_change: PendingBankChange | null;
  pending_vehicle_change: PendingVehicleChange | null;
};

export type RiderStatus = 'pending_review' | 'active' | 'rejected' | 'suspended';

export const api = {
  ping: () =>
    request<{ rider_id: string; status: RiderStatus; reject_reason: string | null; created_at: string }>(
      `rider-ping?device_id=${encodeURIComponent(getDeviceId())}`
    ),
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
  // Claiming a broadcast job races every other online rider in the same
  // area — the server resolves the race, so a 409 here just means someone
  // else got there first, not a real error.
  claimJob: (shipment_id: string) =>
    request<{ claimed: boolean }>('rider-jobs', { method: 'POST', body: JSON.stringify({ shipment_id, action: 'claim' }) }),
  advanceJob: (
    shipment_id: string,
    target_status: string,
    opts: { delivery_proof_url?: string; signature_url?: string; scanned_code?: string } = {}
  ) =>
    request<{ status: string }>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ shipment_id, action: 'advance', target_status, ...opts }),
    }),
  reportProblem: (shipment_id: string, reason: ProblemReason, note?: string) =>
    request<{ reported: boolean }>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ shipment_id, action: 'report_problem', reason, note }),
    }),
  // Ends a delivery attempt (only from picked_up/out_for_delivery — the
  // rider still holds the package). Staff decides what happens next from
  // the Delivery Problems queue; startReturn/confirmReturned pick it back
  // up once staff calls for a return.
  failDelivery: (shipment_id: string, reason: ProblemReason, note?: string) =>
    request<{ status: string }>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ shipment_id, action: 'fail_delivery', reason, note }),
    }),
  startReturn: (shipment_id: string) =>
    request<{ status: string }>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ shipment_id, action: 'start_return' }),
    }),
  confirmReturned: (shipment_id: string) =>
    request<{ status: string }>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ shipment_id, action: 'confirm_returned' }),
    }),
  verifyScan: (shipment_id: string, scanned_code: string) =>
    request<ScanVerification>('rider-jobs', {
      method: 'POST',
      body: JSON.stringify({ shipment_id, action: 'verify_scan', scanned_code }),
    }),
  setOnline: (online: boolean) =>
    request<{ online: boolean }>('rider-online', { method: 'POST', body: JSON.stringify({ online }) }),
  checkinSelfie: (selfie_url: string) =>
    request<void>('rider-selfie-checkin', { method: 'POST', body: JSON.stringify({ selfie_url }) }),
  pingLocation: (lat: number, lng: number, accuracy?: number) =>
    request<void>('rider-location-ping', { method: 'POST', body: JSON.stringify({ lat, lng, accuracy }) }),
  getEarnings: () => request<EarningsResponse>('rider-earnings'),
  getActivity: (status: ActivityStatusFilter = 'all') =>
    request<ActivityItem[]>(`rider-activity?status=${status}`),
  getActivityDetail: (id: string) => request<ActivityDetail>(`rider-activity?id=${encodeURIComponent(id)}`),
  getWithdrawals: () => request<Withdrawal[]>('rider-withdrawals'),
  requestWithdrawal: (amount: number) =>
    request<Withdrawal>('rider-withdrawals', { method: 'POST', body: JSON.stringify({ amount }) }),
  getProfile: () => request<RiderProfile>('rider-profile'),
  getDocuments: () => request<RiderDocumentsResponse>('rider-documents'),
  getNotifications: () => request<RiderNotificationsResponse>('rider-notifications'),
  markNotificationRead: (id: string) =>
    request<{ marked: boolean }>('rider-notifications', { method: 'POST', body: JSON.stringify({ action: 'mark_read', id }) }),
  markAllNotificationsRead: () =>
    request<{ marked: boolean }>('rider-notifications', { method: 'POST', body: JSON.stringify({ action: 'mark_all_read' }) }),
  requestBankChange: (bank_name: string, bank_account_number: string, bank_account_name: string) =>
    request<void>('rider-profile-update', {
      method: 'POST',
      body: JSON.stringify({ field: 'bank', bank_name, bank_account_number, bank_account_name }),
    }),
  updatePhone: (phone: string) =>
    request<void>('rider-profile-update', { method: 'POST', body: JSON.stringify({ field: 'phone', phone }) }),
  requestVehicleChange: (vehicle_type: string, vehicle_plate: string) =>
    request<void>('rider-profile-update', {
      method: 'POST',
      body: JSON.stringify({ field: 'vehicle', vehicle_type, vehicle_plate }),
    }),
  registerPushToken: (fcm_token: string) =>
    request<{ success: boolean }>('rider-register-push', { method: 'POST', body: JSON.stringify({ fcm_token }) }),
};
