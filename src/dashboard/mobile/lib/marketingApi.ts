import { supabase } from '../../contexts/AuthContext';

/**
 * VITE_API_BASE_URL is the Supabase project URL in this repo — not the Netlify
 * /api host. Meta + Google Ads routes live on same-origin /api/* (netlify.toml).
 */
function marketingRequestUrls(path: string): string[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const urls = [normalized];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${normalized}`);
  }
  return urls;
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(res.ok ? 'Invalid JSON from server' : `Request failed (${res.status})`);
  }
}

export async function marketingApi<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    ...(init?.headers || {}),
  };

  const urls = marketingRequestUrls(path);
  let lastError: Error | null = null;

  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], { ...init, headers });
      if (res.status === 404 && i < urls.length - 1) continue;
      return await parseJsonResponse<T>(res);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
      if (i < urls.length - 1) continue;
    }
  }

  throw lastError || new Error('Request failed');
}

export function influencerFunctionsUrl(): string {
  const explicit = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || '').replace(/\/$/, '');
  if (explicit) return explicit;
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  if (supabaseUrl) return `${supabaseUrl}/functions/v1`;
  return '';
}

export function influencerAuthHeaders(): Record<string, string> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  };
}

export async function influencerFetch<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const base = influencerFunctionsUrl();
  if (!base) {
    throw new Error('Influencer API is not configured (missing VITE_SUPABASE_FUNCTIONS_URL or VITE_SUPABASE_URL)');
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${base}${normalized}`, {
    ...init,
    headers: {
      ...influencerAuthHeaders(),
      ...(init?.headers || {}),
    },
  });
  return parseJsonResponse<T>(res);
}

export function slugifyCampaign(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const STOREFRONT_CAMPAIGN_BASE = 'https://julinemart.com/c';

export const fmtNgn = (n: number) => `₦${Number(n || 0).toLocaleString()}`;
