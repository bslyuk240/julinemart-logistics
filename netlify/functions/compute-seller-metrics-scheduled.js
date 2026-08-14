import { createClient } from '@supabase/supabase-js';
import { computeAllSellerMetrics } from './services/sellerMetrics.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[compute-seller-metrics-scheduled] Missing Supabase credentials');
    return { statusCode: 500 };
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  try {
    const result = await computeAllSellerMetrics(adminClient);
    console.log('[compute-seller-metrics-scheduled] Done', result);
    return { statusCode: 200 };
  } catch (err) {
    console.error('[compute-seller-metrics-scheduled] Failed:', err?.message);
    return { statusCode: 500 };
  }
};
