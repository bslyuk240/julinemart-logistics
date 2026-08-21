import { functionsAuthHeader, functionsBase } from '../mobile/lib/functionsAuth';

const primaryPath = '/api/admin/device-tokens';
const fallbackPath = `${functionsBase}/admin-device-tokens-list`;

export type PushSubscriberType = 'customer' | 'vendor' | 'staff' | 'admin' | 'rider' | 'unknown';

export type PushDeviceRecord = {
  id: number;
  platform: string;
  token_hint: string | null;
  last_used_at: string | null;
  registered_at: string | null;
};

export type PushSubscriber = {
  user_id: string;
  user_id_short: string;
  user_type: PushSubscriberType;
  display_name: string;
  email_masked: string | null;
  phone_masked: string | null;
  role: string | null;
  is_active: boolean | null;
  token_count: number;
  platforms: string[];
  last_active_at: string | null;
  devices: PushDeviceRecord[];
};

export type PushSubscriberSummary = {
  total_users: number;
  total_tokens: number;
  by_type: Record<string, number>;
  by_platform: Record<string, number>;
};

export type PushSubscriberListResponse = {
  success: boolean;
  summary: PushSubscriberSummary;
  data: PushSubscriber[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
  error?: string;
};

export type PushSubscriberFilters = {
  user_type?: 'all' | PushSubscriberType;
  platform?: 'all' | 'web' | 'android' | 'ios';
  search?: string;
  page?: number;
  per_page?: number;
};

function buildQuery(filters: PushSubscriberFilters = {}) {
  const params = new URLSearchParams();
  if (filters.user_type && filters.user_type !== 'all') params.set('user_type', filters.user_type);
  if (filters.platform && filters.platform !== 'all') params.set('platform', filters.platform);
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.page) params.set('page', String(filters.page));
  if (filters.per_page) params.set('per_page', String(filters.per_page));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function fetchRegistry(url: string, authHeader: Record<string, string>) {
  const res = await fetch(url, { headers: { ...authHeader } });
  const body = (await res.json()) as PushSubscriberListResponse;
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function loadPushSubscribers(filters: PushSubscriberFilters = {}) {
  const authHeader = await functionsAuthHeader();
  const query = buildQuery(filters);
  const urls = [`${primaryPath}${query}`, `${fallbackPath}${query}`];

  if (import.meta.env.DEV) {
    urls.unshift(`http://localhost:8888${primaryPath}${query}`);
    urls.push(`http://localhost:8888${fallbackPath}${query}`);
  }

  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      return await fetchRegistry(url, authHeader);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('Failed to load push subscribers');
}

export function getUserTypeLabel(type: PushSubscriberType) {
  switch (type) {
    case 'customer':
      return 'Customer';
    case 'vendor':
      return 'Vendor';
    case 'staff':
      return 'Staff';
    case 'admin':
      return 'Admin';
    case 'rider':
      return 'Rider';
    default:
      return 'Unknown';
  }
}

export function getUserTypeBadgeClass(type: PushSubscriberType) {
  switch (type) {
    case 'customer':
      return 'bg-blue-100 text-blue-800';
    case 'vendor':
      return 'bg-orange-100 text-orange-800';
    case 'staff':
      return 'bg-violet-100 text-violet-800';
    case 'admin':
      return 'bg-gray-900 text-white';
    case 'rider':
      return 'bg-emerald-100 text-emerald-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export function formatSubscriberDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
