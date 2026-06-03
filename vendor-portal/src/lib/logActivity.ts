import { supabase } from './supabase';

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
    let uid = user?.id;
    let email = user?.email ?? null;

    if (!uid) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        console.warn('[logActivity] vendor_portal: no session, skipping');
        return;
      }
      uid = session.user.id;
      email = session.user.email ?? null;
    }

    const { error } = await supabase.from('activity_logs').insert({
      user_id: uid,
      actor_email: email,
      action: params.action.trim().toUpperCase(),
      resource_type: params.resource_type ?? null,
      resource_id: params.resource_id ?? null,
      details: params.details ?? null,
      source: 'vendor_portal',
    });
    if (error) console.error('[logActivity] vendor_portal insert error:', error.message, error.code, error.details);
  } catch (err) {
    console.error('[logActivity] vendor_portal unexpected error:', err);
  }
}
