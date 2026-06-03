import { supabase } from './supabase';

export async function logActivity(params: {
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { user } = session;
    await supabase.from('activity_logs').insert({
      user_id: user.id,
      actor_email: user.email ?? null,
      action: params.action.trim().toUpperCase(),
      resource_type: params.resource_type ?? null,
      resource_id: params.resource_id ?? null,
      details: params.details ?? null,
      source: 'vendor_portal',
    });
  } catch {
    // Non-critical — never block the user flow
  }
}
