import { supabase } from './supabase';

const JLO_BASE = ((import.meta.env.VITE_JLO_API_URL as string) || '').replace(/\/$/, '');

export async function logActivity(
  params: {
    action: string;
    resource_type?: string;
    resource_id?: string;
    details?: Record<string, unknown>;
  },
  user?: { id: string; email?: string | null },
) {
  try {
    let sessionToken: string | undefined;

    const { data: { session } } = await supabase.auth.getSession();
    sessionToken = session?.access_token;

    if (!sessionToken) {
      if (!user?.id) {
        console.warn('[logActivity] vendor_portal: no session, skipping');
        return;
      }
    }

    const token = sessionToken;
    if (!token) return;

    const response = await fetch(`${JLO_BASE}/.netlify/functions/log-activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...params, source: 'vendor_portal' }),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      console.error('[logActivity] vendor_portal request failed:', response.status, message);
    }
  } catch (err) {
    console.error('[logActivity] vendor_portal unexpected error:', err);
  }
}
