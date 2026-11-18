/**
 * Scheduled (hourly, see netlify.toml): vests pending JulinePoints awards.
 * An award moves to the ledger once every sub-order is delivered and the
 * return/refund hold stored on the config version it was earned under has
 * elapsed; it is voided if the order was cancelled or refunded first.
 * rewards_vest_pending is idempotent, so overlapping or repeated runs are safe.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

export const handler = async () => {
  if (!supabaseUrl || !serviceKey) return { statusCode: 500, body: 'not configured' };
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.rpc('rewards_vest_pending', { p_limit: 500 });
  if (error) {
    console.error('rewards-vest-scheduled failed:', error.message);
    return { statusCode: 500, body: error.message };
  }
  console.log('rewards-vest-scheduled:', JSON.stringify(data));
  return { statusCode: 200, body: JSON.stringify(data) };
};
