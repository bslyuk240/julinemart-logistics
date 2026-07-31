import { functionsAuthHeader, functionsBase } from './functionsAuth';

const JLO_API = import.meta.env.VITE_JLO_API_URL || '';

function apiBase() {
  return JLO_API ? `${JLO_API}/.netlify/functions` : functionsBase;
}

export async function vendorPost<T = Record<string, unknown>>(path: string, body: object): Promise<T> {
  const res = await fetch(`${apiBase()}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await functionsAuthHeader()),
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export async function vendorFetch<T = Record<string, unknown>>(
  path: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  body?: object,
): Promise<T> {
  const qs =
    method === 'GET' && body ? `?${new URLSearchParams(body as Record<string, string>).toString()}` : '';
  const res = await fetch(`${apiBase()}/${path}${qs}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(await functionsAuthHeader()),
    },
    ...(method !== 'GET' && body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json() as Promise<T>;
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return (
    lower.includes('@wcfm.local') ||
    lower.includes('@placeholder') ||
    lower.includes('@localhost') ||
    lower.includes('@example.com')
  );
}

export function formatJsonAddressToPlain(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const t = String(raw).trim();
  if (!t.startsWith('{')) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const street1 = String(o.street_1 ?? '').trim();
    const street2 = String(o.street_2 ?? '').trim();
    const city = String(o.city ?? '').trim();
    const state = String(o.state ?? '').trim();
    const zip = String(o.zip ?? '').trim();
    const country = String(o.country ?? '').trim();
    const line1 = [street1, street2].filter(Boolean).join(', ');
    const line2 = [city, state, zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const lines = [line1, line2, country].filter(Boolean);
    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}
