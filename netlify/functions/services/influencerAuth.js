/**
 * Shared influencer auth helper.
 * Extracts the Supabase JWT from the Authorization header,
 * verifies it, and returns the linked influencer record.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

export function getAdminClient() {
  return createClient(supabaseUrl, serviceKey);
}

/**
 * Authenticate influencer from Authorization header.
 * Returns { influencer, userId, adminClient, error }.
 */
export async function authenticateInfluencer(event) {
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
  const { data: influencer, error: influencerErr } = await adminClient
    .from('influencers')
    .select('id, name, email, phone, platform, handle, coupon_code, shipping_discount_type, shipping_discount_value, minimum_order_value, maximum_uses, commission_rate, commission_based_on, tier, status, total_orders, total_sales, total_shipping_discounts, total_commission_earned, total_commission_paid, bank_name, account_number, account_name, start_date, last_sale_date, created_at')
    .eq('user_id', user.id)
    .single();

  if (influencerErr || !influencer) return { error: 'No influencer account linked to this user' };
  if (influencer.status !== 'active') return { error: 'Influencer account is not active' };

  return { influencer, userId: user.id, adminClient };
}
