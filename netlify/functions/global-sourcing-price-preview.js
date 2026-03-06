import {
  headers,
  isPlainObject,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import { buildLandedPricingPreview } from './services/global-sourcing-cj.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  const payload = parseJsonBody(event.body);
  if (payload === null || !isPlainObject(payload)) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  const receivingHubId = String(payload.receiving_hub_id || '').trim();
  const externalVariantId = String(
    payload.external_variant_id || payload.cj_vid || payload.selected_variant_id || ''
  ).trim();
  const sourcePrice = payload.source_price ?? payload.supplier_price_snapshot ?? null;
  const sourceCurrency = String(payload.currency || 'USD').trim().toUpperCase();

  if (!externalVariantId || sourcePrice === null || sourcePrice === undefined) {
    return jsonResponse(400, {
      success: false,
      error: 'external_variant_id and source_price are required',
    });
  }

  try {
    const pricing = await buildLandedPricingPreview({
      client: auth.adminClient,
      receivingHubId,
      externalVariantId,
      sourcePrice,
      sourceCurrency,
    });

    return jsonResponse(200, {
      success: true,
      data: pricing,
    });
  } catch (error) {
    return jsonResponse(502, {
      success: false,
      error: 'Unable to build landed pricing preview',
      message: error?.message || 'CJ freight quote failed',
      details: error?.details || error?.responseBody || null,
    });
  }
}
