import { functionsAuthHeader } from '../mobile/lib/functionsAuth';

/* Shared by the desktop and mobile JulinePoints admin screens, so the field
   definitions, types and API helper exist exactly once. */

export type Json = Record<string, any>;

export interface Version {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'cancelled';
  effective_from: string | null;
  policy: Json;
  note: string | null;
  created_at: string;
  published_at: string | null;
}
export interface AuditRow { id: string; actor_email: string | null; action: string; created_at: string; reason: string | null }
export interface ReviewItem {
  id: string; order_number: string | number | null; referrer: string; referee: string;
  qualifying_amount: number; points: number; signals: string[]; created_at: string;
}
export interface CostSummary {
  issued_points: number; issued_ngn: number; redeemed_points: number; redeemed_ngn: number;
  restored_points: number; restored_ngn: number; outstanding_points: number; pending_points: number;
}
export interface Payload {
  cost?: CostSummary | null;
  review_queue?: ReviewItem[];
  active_version_id: string | null;
  versions: Version[];
  audit: AuditRow[];
  totals: { wallets: number; outstanding_points: number; reconciliation_drift_accounts: number | null };
}

export type FieldKind = 'bool' | 'int' | 'num' | 'text' | 'datetime' | 'optint' | { select: string[] };
export interface Field { path: string; label: string; kind: FieldKind; hint?: string }

export const SECTIONS: { title: string; fields: Field[] }[] = [
  { title: 'Programme', fields: [
    { path: 'programme.enabled', label: 'Programme enabled', kind: 'bool', hint: 'Master switch. Off = no earning or spending.' },
    { path: 'programme.name', label: 'Reward name', kind: 'text' },
    { path: 'programme.launch_at', label: 'Launch cutoff (new-account bonus)', kind: 'datetime', hint: 'Only accounts registered at/after this get the sign-up bonus.' },
    { path: 'programme.timezone', label: 'Claim timezone (IANA)', kind: 'text' },
    { path: 'programme.points_to_ngn', label: '1 point = ₦', kind: 'num' },
  ] },
  { title: 'Sign-up and daily check-in', fields: [
    { path: 'signup.enabled', label: 'Sign-up bonus enabled', kind: 'bool' },
    { path: 'signup.points', label: 'Sign-up bonus (points)', kind: 'int' },
    { path: 'signup.require_verified_email', label: 'Require verified email', kind: 'bool' },
    { path: 'daily_claim.enabled', label: 'Daily claim enabled', kind: 'bool' },
    { path: 'daily_claim.points', label: 'Daily claim (points)', kind: 'int' },
    { path: 'streak.enabled', label: 'Streak bonus enabled', kind: 'bool' },
    { path: 'streak.length_days', label: 'Streak length (days)', kind: 'int' },
    { path: 'streak.bonus_points', label: 'Streak bonus (points)', kind: 'int' },
    { path: 'streak.reset_policy', label: 'Missed-day policy', kind: { select: ['reset', 'grace'] } },
    { path: 'streak.grace_days', label: 'Grace days', kind: 'int' },
  ] },
  { title: 'Purchase rewards', fields: [
    { path: 'purchase.enabled', label: 'Purchase rewards enabled', kind: 'bool' },
    { path: 'purchase.rate_percent', label: 'Rate (% of eligible merchandise)', kind: 'num' },
    { path: 'purchase.rounding', label: 'Rounding', kind: { select: ['floor', 'round', 'ceil'] } },
    { path: 'purchase.max_points_per_order', label: 'Max points per order', kind: 'optint', hint: 'Empty = no cap.' },
    { path: 'purchase.hold_days', label: 'Return/refund hold (days)', kind: 'int' },
    { path: 'purchase.include_points_funded_value', label: 'Earn on points-funded value', kind: 'bool' },
  ] },
  { title: 'Referral programme', fields: [
    { path: 'referral.enabled', label: 'Referrals enabled', kind: 'bool' },
    { path: 'referral.window_days', label: 'Attribution window (days)', kind: 'int' },
    { path: 'referral.hold_days', label: 'Fulfilment hold (days)', kind: 'int' },
  ] },
  { title: 'Checkout redemption', fields: [
    { path: 'redemption.enabled', label: 'Redemption enabled', kind: 'bool' },
    { path: 'redemption.cap_percent', label: 'Cap (% of eligible merchandise)', kind: 'num' },
    { path: 'redemption.min_points', label: 'Minimum redemption (points)', kind: 'int' },
    { path: 'redemption.max_points_per_order', label: 'Max points per order', kind: 'optint', hint: 'Empty = no cap.' },
    { path: 'redemption.partial_allowed', label: 'Allow partial use', kind: 'bool' },
    { path: 'redemption.reservation_minutes', label: 'Hold points at checkout (minutes)', kind: 'optint', hint: 'Empty = 60.' },
  ] },
  { title: 'Expiry and adjustments', fields: [
    { path: 'expiry.enabled', label: 'Points expire', kind: 'bool' },
    { path: 'expiry.days', label: 'Expire after (days)', kind: 'int' },
    { path: 'expiry.warn_days', label: 'Warn before (days)', kind: 'int' },
    { path: 'adjustments.dual_approval_threshold_points', label: 'Dual-approval threshold (points)', kind: 'int' },
  ] },
];

export const getPath = (o: Json, path: string) => path.split('.').reduce((a: any, k) => (a == null ? a : a[k]), o);
export const setPath = (o: Json, path: string, value: unknown): Json => {
  const next = structuredClone(o);
  const keys = path.split('.');
  let cur: any = next;
  keys.slice(0, -1).forEach((k) => { cur = cur[k]; });
  cur[keys[keys.length - 1]] = value;
  return next;
};
export const toLocalInput = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().slice(0, 16) : '';
export const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export async function api(method: 'GET' | 'POST', body?: Json) {
  const res = await fetch('/api/admin-rewards-config', {
    method,
    headers: { 'Content-Type': 'application/json', ...(await functionsAuthHeader()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const detail = Array.isArray(data.details) ? `: ${data.details.join('; ')}` : '';
    throw new Error(`${data.error || 'Request failed'}${detail}`);
  }
  return data;
}
