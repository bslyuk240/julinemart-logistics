/**
 * Shared vendor auth helper.
 * Extracts the Supabase JWT from the Authorization header,
 * verifies it, and returns the linked vendor record.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

export function getAdminClient() {
  return createClient(supabaseUrl, serviceKey);
}

/**
 * Authenticate vendor from Authorization header.
 * Returns { vendor, userId, error }.
 */
export async function authenticateVendor(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;

  if (!token) return { error: 'No authorization token' };

  // Verify JWT with Supabase
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return { error: 'Invalid or expired token' };

  const adminClient = getAdminClient();
  const { data: vendor, error: vendorErr } = await adminClient
    .from('vendors')
    .select('id, store_name, store_slug, email, phone, commission_rate, is_active, logo_url, banner_url, description, bank_name, bank_account_number, bank_account_name, city, state, woocommerce_vendor_id, total_orders, fulfilled_orders, created_at')
    .eq('user_id', user.id)
    .single();

  if (vendorErr || !vendor) return { error: 'No vendor account linked to this user' };
  if (!vendor.is_active)    return { error: 'Vendor account is inactive' };

  return { vendor, userId: user.id, adminClient };
}
