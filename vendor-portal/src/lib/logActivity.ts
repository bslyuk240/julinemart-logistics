import { supabase } from './supabase';

const JLO_BASE = ((import.meta.env.VITE_JLO_API_URL as string) || '').replace(/\/$/, '');

export async function logActivity(
  params: {
    action: string;
    resource_type?: string;
    resource_id?: string;
    details?: Record<string, unknown>;
  },
  sessionContext?: { access_token?: string | null; user?: { id: string; email?: string | null } },
) {
  try {
    let sessionToken = sessionContext?.access_token || undefined;

    if (!sessionToken) {
      const { data: { session } } = await supabase.auth.getSession();
      sessionToken = session?.access_token;
    }

    if (!sessionToken) {
      console.warn('[logActivity] vendor_portal: no session token, skipping');
      return;
    }

    if (!JLO_BASE) {
      console.warn('[logActivity] vendor_portal: VITE_JLO_API_URL is not configured');
      return;
    }

    const response = await fetch(`${JLO_BASE}/api/log-activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
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
