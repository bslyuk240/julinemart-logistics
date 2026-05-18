import { createClient } from '@supabase/supabase-js';
import { getEffectiveUsdToNgnRate, refreshGlobalSourcingUsdToNgnRate } from './services/global-sourcing-fx.js';
import { runFxPriceSync } from './services/fx-price-sync-service.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

// Runs weekly via Netlify scheduled function.
// Always re-prices all CJ products regardless of the rate delta — this is the
// weekly fallback to catch any drift that never crossed the 3% threshold.
export const handler = async () => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[fx-price-sync-scheduled] Missing Supabase credentials — aborting');
    return { statusCode: 500 };
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let rateResult;
  try {
    rateResult = await refreshGlobalSourcingUsdToNgnRate(adminClient, 'cj');
  } catch (err) {
    console.warn('[fx-price-sync-scheduled] Live rate refresh failed, falling back to cached/env rate:', err?.message);
    rateResult = await getEffectiveUsdToNgnRate(adminClient, { provider: 'cj' });
  }

  console.log(`[fx-price-sync-scheduled] Using rate ${rateResult.rate} (${rateResult.source})`);

  try {
    const result = await runFxPriceSync(adminClient, {
      newRate: rateResult.rate,
      reason: 'weekly_scheduled',
    });

    console.log(
      `[fx-price-sync-scheduled] Done — simple: ${result.updatedSimple}, variations: ${result.updatedVariations}, skipped: ${result.skipped}`,
      result.errors ? `errors: ${result.errors.join('; ')}` : ''
    );

    return { statusCode: 200 };
  } catch (err) {
    console.error('[fx-price-sync-scheduled] Price sync failed:', err?.message);
    return { statusCode: 500 };
  }
};
