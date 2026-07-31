import { supabase } from '../../contexts/AuthContext';

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  total_orders: number;
  paid_orders: number;
  julinemart_revenue: number;
  gross_sales: number;
  commission_revenue: number;
  shipping_revenue: number;
  active_vendors: number;
}

export interface AnalyticsDelivery {
  total: number;
  delivered: number;
  failed: number;
  in_progress: number;
  success_pct: number;
  failed_pct: number;
  avg_delivery_days: number;
}

export interface AnalyticsOperations {
  zones: number;
  active_hubs: number;
  courier_partners: number;
  pending_settlement: number;
}

export interface ZoneStat {
  zone: string;
  orders: number;
  revenue: number;
}

export interface VendorStat {
  store_name: string;
  orders: number;
  gross_sales: number;
  commission: number;
}

export interface MonthRow {
  period: string;
  revenue: number;
  gross_sales: number;
  expenses: number;
  gross_profit: number;
  order_count: number;
}

export interface AnalyticsData {
  overview: AnalyticsOverview;
  delivery: AnalyticsDelivery;
  operations: AnalyticsOperations;
  orders_by_zone: ZoneStat[];
  top_vendors: VendorStat[];
  order_statuses: Record<string, number>;
  monthly_trend: MonthRow[];
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

export async function fetchAnalytics(): Promise<AnalyticsData> {
  let lastError: Error | null = null;
  for (const url of apiUrls('/analytics')) {
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      return json.data as AnalyticsData;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
    }
  }
  throw lastError || new Error('Could not load analytics');
}

export const fmtAnalytics = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  partially_shipped: 'Part. Shipped',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  partially_shipped: 'bg-indigo-100 text-indigo-700',
  shipped: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-600',
};

// ─── Activity logs ────────────────────────────────────────────────────────────

export type ActivitySource = 'all' | 'jlo' | 'storefront' | 'vendor_portal';

export interface ActivityLogRow {
  id: string;
  user_id: string;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  source: string;
  created_at: string;
  users: { email: string; full_name: string; role?: string } | null;
}

export const SOURCE_BADGE: Record<string, string> = {
  jlo: 'bg-purple-100 text-purple-700',
  storefront: 'bg-blue-100 text-blue-700',
  vendor_portal: 'bg-amber-100 text-amber-700',
  system: 'bg-gray-100 text-gray-600',
};

export const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  SIGNUP: 'Signup',
  ORDER_PLACED: 'Order placed',
  CARD_ADDED: 'Card added',
  RETURN_REQUESTED: 'Return requested',
  PASSWORD_CHANGED: 'Password changed',
  INSERT: 'Record created',
  CREATE: 'Record created',
  UPDATE: 'Record updated',
  DELETE: 'Record deleted',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  USER_DELETED: 'User deleted',
  PASSWORD_RESET_SENT: 'Password reset',
  VENDOR_APPLICATION_APPROVED: 'Vendor approved',
  VENDOR_APPLICATION_REJECTED: 'Vendor rejected',
  WITHDRAWAL_REQUESTED: 'Withdrawal requested',
  WITHDRAWAL_APPROVED: 'Withdrawal approved',
  WITHDRAWAL_REJECTED: 'Withdrawal rejected',
  WITHDRAWAL_PAID: 'Withdrawal paid',
  PRODUCT_CREATED: 'Product created',
  PRODUCT_UPDATED: 'Product updated',
  PRODUCT_DELETED: 'Product deleted',
  PRODUCT_MODERATED: 'Product moderated',
  PRODUCT_PUBLISHED: 'Product published',
  courier_shipment_created: 'Shipment created',
  tracking_updated: 'Tracking updated',
  return_shipment_created: 'Return created',
};

export const ACTION_COLOR: Record<string, string> = {
  LOGIN: 'bg-green-50 text-green-700',
  LOGOUT: 'bg-gray-100 text-gray-600',
  SIGNUP: 'bg-green-50 text-green-700',
  INSERT: 'bg-green-50 text-green-700',
  CREATE: 'bg-green-50 text-green-700',
  UPDATE: 'bg-blue-50 text-blue-700',
  DELETE: 'bg-red-50 text-red-700',
  ORDER_PLACED: 'bg-green-50 text-green-700',
  CARD_ADDED: 'bg-emerald-50 text-emerald-700',
  RETURN_REQUESTED: 'bg-orange-50 text-orange-700',
  PASSWORD_CHANGED: 'bg-blue-50 text-blue-700',
  WITHDRAWAL_PAID: 'bg-indigo-50 text-indigo-700',
  courier_shipment_created: 'bg-indigo-50 text-indigo-700',
  VENDOR_APPLICATION_APPROVED: 'bg-green-50 text-green-700',
  VENDOR_APPLICATION_REJECTED: 'bg-red-50 text-red-700',
  WITHDRAWAL_REJECTED: 'bg-red-50 text-red-700',
};

export const AUTH_ACTIONS = new Set(['LOGIN', 'LOGOUT', 'SIGNUP', 'PASSWORD_RESET_SENT', 'PASSWORD_CHANGED']);

export function actionLabel(action: string) {
  return ACTION_LABELS[action] || ACTION_LABELS[action.toUpperCase()] || action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function actionColor(action: string) {
  return ACTION_COLOR[action] || ACTION_COLOR[action.toUpperCase()] || 'bg-gray-100 text-gray-600';
}

export function displayName(log: ActivityLogRow) {
  return log.users?.full_name || log.users?.email || log.actor_email || 'Unknown';
}

export function sourceLabel(source: string) {
  if (source === 'vendor_portal') return 'Vendor';
  if (source === 'storefront') return 'Store';
  return source?.toUpperCase() ?? '—';
}

export async function fetchActivityLogs(params: {
  source?: ActivitySource;
  action?: string;
  limit?: number;
}): Promise<ActivityLogRow[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const qs = new URLSearchParams();
  qs.set('limit', String(params.limit ?? 500));
  qs.set('exclude_whatsapp', 'true');
  if (params.action && params.action !== 'all') qs.set('action', params.action);
  if (params.source && params.source !== 'all') qs.set('source', params.source);

  const path = `/activity-logs?${qs.toString()}`;
  let lastError: Error | null = null;

  for (const url of apiUrls(path)) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      return json.data || [];
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
    }
  }
  throw lastError || new Error('Could not load activity logs');
}
