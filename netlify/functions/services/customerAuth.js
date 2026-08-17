/**
 * Verify Supabase customer JWT from Authorization header.
 * Returns { user, email, userId, error }.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';

export async function authenticateCustomer(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;

  if (!token) return { error: 'Sign in required' };

  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !anonKey) return { error: 'Auth not configured' };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user?.email) return { error: 'Invalid or expired token' };

  return {
    user,
    userId: user.id,
    email: user.email.trim().toLowerCase(),
  };
}
