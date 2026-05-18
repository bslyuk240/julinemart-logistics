import {
  asFiniteNumber,
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  isPlainObject,
  jsonResponse,
  loadGlobalSourcingPricingDefaults,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import {
  getEffectiveUsdToNgnRate,
  loadGlobalSourcingFxSettings,
  refreshGlobalSourcingUsdToNgnRate,
  saveGlobalSourcingFxSettings,
} from './services/global-sourcing-fx.js';
import { checkThresholdAndSync } from './services/fx-price-sync-service.js';

function normalizeSettingValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = asFiniteNumber(value);
  return parsed === null ? null : parsed;
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeFxPayload(payload) {
  const row = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'manual_override_enabled')) {
    row.manual_override_enabled = toBoolean(payload.manual_override_enabled, false);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'manual_rate')) {
    row.manual_rate =
      payload.manual_rate === '' || payload.manual_rate === null || payload.manual_rate === undefined
        ? null
        : normalizeSettingValue(payload.manual_rate);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'manual_rate_note')) {
    row.manual_rate_note =
      payload.manual_rate_note === '' ||
      payload.manual_rate_note === null ||
      payload.manual_rate_note === undefined
        ? null
        : String(payload.manual_rate_note).trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'live_api_enabled')) {
    row.live_api_enabled = toBoolean(payload.live_api_enabled, true);
  }

  return row;
}

async function loadCombinedSettings(adminClient) {
  const pricingDefaults = await loadGlobalSourcingPricingDefaults(adminClient, 'cj');
  const effectiveRate = await getEffectiveUsdToNgnRate(adminClient, { provider: 'cj' });
  const fxSettings = await loadGlobalSourcingFxSettings(adminClient, 'cj');

  return {
    ...pricingDefaults,
    fx: {
      provider: fxSettings.fx.provider,
      manual_override_enabled: fxSettings.fx.manual_override_enabled,
      manual_rate: fxSettings.fx.manual_rate,
      manual_rate_note: fxSettings.fx.manual_rate_note,
      live_api_enabled: fxSettings.fx.live_api_enabled,
      last_fetched_rate: fxSettings.fx.last_fetched_rate,
      last_fetched_at: fxSettings.fx.last_fetched_at,
      cache_expires_at: fxSettings.fx.cache_expires_at,
      effective_rate: effectiveRate.rate,
      effective_source: effectiveRate.source,
      effective_fetched_at: effectiveRate.fetchedAt || null,
      effective_note: effectiveRate.note || null,
    },
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  if (event.httpMethod === 'GET') {
    try {
      const settings = await loadCombinedSettings(auth.adminClient);
      return jsonResponse(200, { success: true, data: settings });
    } catch (error) {
      return jsonResponse(500, {
        success: false,
        error: 'Unable to load Global Sourcing settings',
        message: error?.message || 'Settings load failed',
      });
    }
  }

  const payload = parseJsonBody(event.body);
  if (payload === null || !isPlainObject(payload)) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  if (String(payload.action || '').trim() === 'refresh_fx_rate') {
    try {
      const refreshResult = await refreshGlobalSourcingUsdToNgnRate(auth.adminClient, 'cj');

      // Trigger a price re-sync if the new rate crossed the 3% threshold
      let priceSyncResult = null;
      try {
        priceSyncResult = await checkThresholdAndSync(auth.adminClient, refreshResult.rate);
      } catch (syncError) {
        priceSyncResult = { synced: false, error: syncError?.message };
      }

      const settings = await loadCombinedSettings(auth.adminClient);
      return jsonResponse(200, {
        success: true,
        data: settings,
        note: refreshResult.note || null,
        price_sync: priceSyncResult,
      });
    } catch (error) {
      return jsonResponse(502, {
        success: false,
        error: 'Unable to fetch latest live FX rate',
        message: error?.message || 'Live FX refresh failed',
      });
    }
  }

  const row = {
    provider: 'cj',
    default_import_buffer_usd: normalizeSettingValue(payload.import_buffer_usd),
    default_markup_percent: normalizeSettingValue(payload.markup_percent),
    default_markup_flat_ngn: normalizeSettingValue(payload.markup_flat_ngn),
    default_usd_to_ngn_rate: normalizeSettingValue(payload.usd_to_ngn_rate),
  };

  const { error: pricingError } = await auth.adminClient
    .from('global_sourcing_settings')
    .upsert(row, { onConflict: 'provider' });

  if (pricingError) {
    return jsonResponse(500, {
      success: false,
      error: 'Unable to save Global Sourcing settings',
      message: pricingError.message,
    });
  }

  try {
    await saveGlobalSourcingFxSettings(auth.adminClient, 'cj', normalizeFxPayload(payload));
  } catch (error) {
    return jsonResponse(400, {
      success: false,
      error: 'Unable to save FX settings',
      message: error?.message || 'FX settings validation failed',
    });
  }

  const settings = await loadCombinedSettings(auth.adminClient);
  return jsonResponse(200, { success: true, data: settings });
}
