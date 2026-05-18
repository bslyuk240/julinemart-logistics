import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  isPlainObject,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import { getEffectiveUsdToNgnRate } from './services/global-sourcing-fx.js';
import { checkThresholdAndSync, runFxPriceSync } from './services/fx-price-sync-service.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  // GET — return last sync status + last 20 log entries
  if (event.httpMethod === 'GET') {
    try {
      const [settingsResult, logsResult] = await Promise.all([
        auth.adminClient
          .from('global_sourcing_settings')
          .select('fx_last_price_sync_rate, fx_last_price_sync_at')
          .eq('provider', 'cj')
          .maybeSingle(),
        auth.adminClient
          .from('fx_price_sync_logs')
          .select('id, created_at, reason, rate_used, previous_rate, change_pct, updated_simple, updated_variations, skipped, errors')
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (settingsResult.error) throw settingsResult.error;
      if (logsResult.error) throw logsResult.error;

      return jsonResponse(200, {
        success: true,
        data: {
          last_sync_rate: settingsResult.data?.fx_last_price_sync_rate ?? null,
          last_sync_at: settingsResult.data?.fx_last_price_sync_at ?? null,
          logs: logsResult.data ?? [],
        },
      });
    } catch (error) {
      return jsonResponse(500, {
        success: false,
        error: 'Unable to load sync status',
        message: error?.message,
      });
    }
  }

  const payload = parseJsonBody(event.body);
  if (payload === null || !isPlainObject(payload)) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  const action = String(payload.action || '').trim();

  // POST { action: 'check_threshold' } — sync only if rate moved ≥ 3%
  if (action === 'check_threshold') {
    try {
      const rateResult = await getEffectiveUsdToNgnRate(auth.adminClient, { provider: 'cj' });
      const syncResult = await checkThresholdAndSync(auth.adminClient, rateResult.rate);
      return jsonResponse(200, {
        success: true,
        data: { ...syncResult, rateSource: rateResult.source },
      });
    } catch (error) {
      return jsonResponse(500, {
        success: false,
        error: 'Threshold check failed',
        message: error?.message,
      });
    }
  }

  // POST { action: 'run_sync' } — force sync at current rate regardless of threshold
  if (action === 'run_sync') {
    try {
      const rateResult = await getEffectiveUsdToNgnRate(auth.adminClient, { provider: 'cj' });
      const syncResult = await runFxPriceSync(auth.adminClient, {
        newRate: rateResult.rate,
        reason: 'manual',
      });
      return jsonResponse(200, {
        success: true,
        data: { ...syncResult, rateSource: rateResult.source },
      });
    } catch (error) {
      return jsonResponse(500, {
        success: false,
        error: 'Price sync failed',
        message: error?.message,
      });
    }
  }

  return jsonResponse(400, {
    success: false,
    error: 'Unknown action',
    message: 'action must be "run_sync" or "check_threshold"',
  });
}
