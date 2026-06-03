import { supabase } from '../../lib/supabase';

export async function logActivity(params: {
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await fetch('/api/log-activity', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ ...params, source: 'storefront' }),
    });
  } catch {
    // Activity logging should never block the customer experience.
  }
}
