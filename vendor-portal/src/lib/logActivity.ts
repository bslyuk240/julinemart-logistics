import { supabase } from './supabase';

const JLO_BASE = (import.meta.env.VITE_JLO_API_URL as string || '').replace(/\/$/, '');

export async function logActivity(params: {
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await fetch(`${JLO_BASE}/.netlify/functions/log-activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ...params, source: 'vendor_portal' }),
    });
  } catch {
    // Non-critical — never block the user flow
  }
}
