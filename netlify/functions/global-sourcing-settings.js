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

function normalizeSettingValue(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = asFiniteNumber(value);
  return parsed === null ? null : parsed;
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
    const settings = await loadGlobalSourcingPricingDefaults(auth.adminClient, 'cj');
    return jsonResponse(200, { success: true, data: settings });
  }

  const payload = parseJsonBody(event.body);
  if (payload === null || !isPlainObject(payload)) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  const row = {
    provider: 'cj',
    default_import_buffer_usd: normalizeSettingValue(payload.import_buffer_usd),
    default_markup_percent: normalizeSettingValue(payload.markup_percent),
    default_markup_flat_ngn: normalizeSettingValue(payload.markup_flat_ngn),
    default_usd_to_ngn_rate: normalizeSettingValue(payload.usd_to_ngn_rate),
  };

  const { error } = await auth.adminClient
    .from('global_sourcing_settings')
    .upsert(row, { onConflict: 'provider' });

  if (error) {
    return jsonResponse(500, {
      success: false,
      error: 'Unable to save Global Sourcing settings',
      message: error.message,
    });
  }

  const settings = await loadGlobalSourcingPricingDefaults(auth.adminClient, 'cj');
  return jsonResponse(200, { success: true, data: settings });
}
