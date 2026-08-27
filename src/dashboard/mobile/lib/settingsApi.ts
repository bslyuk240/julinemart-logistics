import { supabase } from '../../contexts/AuthContext';
import { adminFetchUrls } from '../../lib/settingsDeveloperUtils';

export {
  API_ENDPOINT_GROUPS,
  DB_TABLES,
  type ApiEndpoint,
  type ApiEndpointGroup,
  type DbTableInfo,
} from '../../lib/settingsDeveloperContent';

export interface SettingsHealthCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string | null;
}

export interface SettingsHealthData {
  deployment: { node_env: string; site_url: string | null };
  summary: { total: number; ok: number; needs_attention: number };
  checks: SettingsHealthCheck[];
  email: {
    provider: string | null;
    enabled: boolean;
    secrets_configured: boolean;
    encryption_active: boolean;
  };
}

export interface SettingsStatus {
  configured: boolean;
  checks: Record<string, boolean>;
  cj_connected?: boolean | null;
  authenticated?: boolean;
  expires_at?: string;
  cached?: boolean;
  cj_connection_error?: string | null;
  connection_tested_at?: string | null;
}

export interface CourierSettingsRow {
  id: string;
  name: string;
  code: string;
  api_enabled: boolean;
  api_base_url: string;
  api_user_id: string;
  api_password: string;
  supports_live_tracking: boolean;
  supports_label_generation: boolean;
  is_active: boolean;
}

export interface EmailConfig {
  provider: 'gmail' | 'sendgrid' | 'smtp' | 'resend';
  gmail_user: string;
  gmail_password: string;
  sendgrid_api_key: string;
  resend_api_key: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  email_from: string;
  email_enabled: boolean;
  portal_url: string;
  order_alert_emails: string[];
  secrets_configured?: {
    gmail_password: boolean;
    sendgrid_api_key: boolean;
    resend_api_key: boolean;
    smtp_password: boolean;
  };
  email_secrets_encryption_active?: boolean;
}

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

function apiUrls(path: string): string[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const full = normalized.startsWith('/api/') ? normalized : `/api${normalized}`;
  const urls = [full, `${functionsBase}${normalized.startsWith('/api') ? normalized.replace('/api', '') : normalized}`];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${full}`);
    urls.push(`http://localhost:8888${functionsBase}${normalized.startsWith('/api') ? normalized.replace('/api', '') : normalized}`);
  }
  return Array.from(new Set(urls));
}

function endpointCandidates(endpoint: string) {
  const path = endpoint.startsWith('/') ? endpoint.replace(/^\//, '') : endpoint;
  return adminFetchUrls(path);
}

export function formatSettingsDate(value?: string | null) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function sanitizeSettingsError(message?: string | null, fallback = 'Request failed') {
  const raw = String(message || '').trim();
  if (!raw) return fallback;
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw;
}

export async function callAdmin<T>(endpoint: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const urls = endpointCandidates(endpoint);
  let lastError: Error | null = null;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const isLast = index === urls.length - 1;
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(init.headers || {}),
        },
      });
      if (response.status === 404 && !isLast) continue;
      const raw = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = raw ? { raw } : {};
      }
      if (!response.ok) {
        throw new Error(String(body?.message || body?.error || body?.raw || `Request failed (${response.status})`));
      }
      return body as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Request failed');
      if (isLast) throw lastError;
    }
  }
  throw lastError || new Error('Request failed');
}

export async function fetchCjSettingsStatus(token: string) {
  const res = await callAdmin<{ data: SettingsStatus }>('cj-auth', token, { method: 'GET' });
  return res.data;
}

export async function testCjSettingsAuth(token: string) {
  const res = await callAdmin<{ data: SettingsStatus }>('cj-auth', token, { method: 'POST' });
  return res.data;
}

export interface GlobalSourcingFxSettings {
  provider: string;
  manual_override_enabled: boolean;
  manual_rate: number | null;
  manual_rate_note: string | null;
  live_api_enabled: boolean;
  last_fetched_rate: number | null;
  last_fetched_at: string | null;
  cache_expires_at: string | null;
  effective_rate: number | null;
  effective_source: string;
  effective_fetched_at: string | null;
  effective_note: string | null;
}

export interface GlobalSourcingPricingSettings {
  provider: string;
  saved: boolean;
  updated_at: string | null;
  values: {
    import_buffer_usd: number | null;
    markup_percent: number | null;
    markup_flat_ngn: number | null;
    usd_to_ngn_rate: number | null;
  };
  fx?: GlobalSourcingFxSettings;
}

export interface FxSyncLogEntry {
  id: string;
  created_at: string;
  reason: string;
  rate_used: number;
  previous_rate: number | null;
  change_pct: number | null;
  updated_simple: number;
  updated_variations: number;
  skipped: number;
  errors: string[] | null;
}

export interface FxSyncStatusData {
  last_sync_rate: number | null;
  last_sync_at: string | null;
  logs: FxSyncLogEntry[];
}

export function formatFxSourceLabel(source?: string | null) {
  switch (String(source || '').trim()) {
    case 'manual_override':
      return 'Manual override';
    case 'cached_api':
      return 'Cached API';
    case 'live_api':
      return 'Live API';
    case 'env_fallback':
      return 'Env fallback';
    case 'hardcoded_fallback':
      return 'Hardcoded fallback';
    default:
      return source || 'Not set';
  }
}

export function formatSyncReason(reason: string) {
  switch (reason) {
    case 'threshold_triggered':
      return 'Rate shift ≥3%';
    case 'initial_sync':
      return 'Initial sync';
    case 'weekly_scheduled':
      return 'Weekly cron';
    case 'manual':
      return 'Manual';
    default:
      return reason;
  }
}

export async function fetchGlobalSourcingPricingSettings(token: string) {
  const res = await callAdmin<{ data: GlobalSourcingPricingSettings }>('global-sourcing-settings', token, {
    method: 'GET',
  });
  return res.data;
}

export async function saveGlobalSourcingPricingSettings(
  token: string,
  body: Record<string, unknown>,
): Promise<GlobalSourcingPricingSettings> {
  const res = await callAdmin<{ data: GlobalSourcingPricingSettings }>('global-sourcing-settings', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function refreshGlobalSourcingFxRate(token: string) {
  return callAdmin<{
    data: GlobalSourcingPricingSettings;
    note?: string | null;
    price_sync?: { synced: boolean; reason?: string; updatedSimple?: number; updatedVariations?: number } | null;
  }>('global-sourcing-settings', token, {
    method: 'POST',
    body: JSON.stringify({ action: 'refresh_fx_rate' }),
  });
}

export async function fetchFxSyncStatus(token: string) {
  const res = await callAdmin<{ data: FxSyncStatusData }>('fx-price-sync', token);
  return res.data;
}

export async function runFxPriceSync(token: string) {
  const res = await callAdmin<{
    data: { synced: boolean; updatedSimple: number; updatedVariations: number; skipped: number; errors: string[] | null };
  }>('fx-price-sync', token, {
    method: 'POST',
    body: JSON.stringify({ action: 'run_sync' }),
  });
  return res.data;
}

export async function fetchCourierSettings(): Promise<CourierSettingsRow[]> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  let lastError: Error | null = null;
  for (const url of apiUrls('/couriers')) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load couriers');
      return json.data || [];
    } catch (e) {
      lastError = e instanceof Error ? e : new Error('Failed');
    }
  }
  throw lastError || new Error('Failed to load couriers');
}

export async function saveCourierCredentials(
  courierId: string,
  payload: Record<string, unknown>,
  method: 'PUT' | 'POST' = 'PUT',
) {
  const urls = [
    `${functionsBase}/save-courier-credentials/${courierId}`,
    `/api/save-courier-credentials/${courierId}`,
  ];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${functionsBase}/save-courier-credentials/${courierId}`);
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || json?.error || 'Save failed');
      return json;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error('Save failed');
    }
  }
  throw lastError || new Error('Save failed');
}

export async function fetchEmailConfig(): Promise<EmailConfig> {
  const res = await fetch('/api/email/config');
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || 'Failed to load email config');
  return json.data || json.config || json;
}

export async function saveEmailConfig(config: Partial<EmailConfig>, token: string) {
  const res = await fetch('/api/email/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(config),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || json?.detail || 'Save failed');
  return json;
}

export async function sendTestEmail(email: string, token: string) {
  const res = await fetch('/api/email/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: email }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || json?.detail || 'Test failed');
  return json;
}

export interface EmailLogRow {
  id: string;
  order_id: string | null;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed';
  error_message: string | null;
  sent_at: string;
  created_at?: string;
  orders?: { order_number: string | number } | null;
}

export async function fetchSettingsHealth(token: string): Promise<SettingsHealthData> {
  const res = await callAdmin<{ data: SettingsHealthData }>('admin/settings-health', token, { method: 'GET' });
  return res.data;
}

export async function fetchEmailLogs(token: string, limit = 100): Promise<{ rows: EmailLogRow[]; total: number | null }> {
  const res = await fetch(`/api/email/logs?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.detail || json.error || 'Failed to load email logs');
  }
  return {
    rows: json.data || [],
    total: typeof json.total === 'number' ? json.total : null,
  };
}

