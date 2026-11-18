/**
 * Scheduled (hourly, see netlify.toml): cancels storefront checkouts that were
 * never paid. It gives back the voucher use and any JulinePoints hold, marks the
 * sub-orders failed, and writes an ORDER_EXPIRED activity-log entry.
 *
 * Only unpaid, still-pending orders created by the storefront checkout in the
 * last 30 days are touched (custom and gift orders have their own payment flows).
 * The cut-off is ABANDONED_ORDER_HOURS (default 48). Idempotent: an order that
 * has been paid or already cancelled is never selected.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

export const handler = async () => {
  if (!supabaseUrl || !serviceKey) return { statusCode: 500, body: 'not configured' };

  const parsed = Number.parseInt(process.env.ABANDONED_ORDER_HOURS || '', 10);
  const hours = Number.isFinite(parsed) && parsed >= 6 ? parsed : 48; // never below 6h

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.rpc('expire_abandoned_orders', { p_hours: hours, p_limit: 200 });
  if (error) {
    console.error('expire-abandoned-orders-scheduled failed:', error.message);
    return { statusCode: 500, body: error.message };
  }
  console.log('expire-abandoned-orders-scheduled:', JSON.stringify(data));
  return { statusCode: 200, body: JSON.stringify(data) };
};
