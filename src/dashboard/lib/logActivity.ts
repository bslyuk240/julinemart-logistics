import { supabase } from '../contexts/AuthContext';

export async function logActivity(params: {
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await fetch('/.netlify/functions/log-activity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ...params, source: 'jlo' }),
    });
  } catch {
    // Non-critical
  }
}
