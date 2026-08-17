/**
 * Admin GET/PUT gift commercial settings per GFC.
 *
 * GET /api/admin-gift-commercial-settings?gfc_id=<uuid>
 * PUT /api/admin-gift-commercial-settings?gfc_id=<uuid>
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';

const SELECT =
  'id, gift_fulfilment_centre_id, packaging_markup, profit_margin_percent, profit_margin_fixed, byo_lead_time_days, active';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;

  const gfcId = event.queryStringParameters?.gfc_id;
  if (!gfcId) return jsonResponse(400, { success: false, error: 'gfc_id required' });

  if (event.httpMethod === 'GET') {
    const { data, error } = await adminClient
      .from('gift_commercial_settings')
      .select(SELECT)
      .eq('gift_fulfilment_centre_id', gfcId)
      .maybeSingle();

    if (error) return jsonResponse(500, { success: false, error: error.message });

    return jsonResponse(200, {
      success: true,
      data: data || {
        gift_fulfilment_centre_id: gfcId,
        packaging_markup: 500,
        profit_margin_percent: 15,
        profit_margin_fixed: 0,
        byo_lead_time_days: 1,
        active: true,
      },
    });
  }

  if (event.httpMethod === 'PUT') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const row = {
      gift_fulfilment_centre_id: gfcId,
      packaging_markup: Math.max(0, Number(body.packaging_markup ?? 500)),
      profit_margin_percent: Math.max(0, Number(body.profit_margin_percent ?? 15)),
      profit_margin_fixed: Math.max(0, Number(body.profit_margin_fixed ?? 0)),
      byo_lead_time_days: Math.max(0, Math.round(Number(body.byo_lead_time_days ?? 1))),
      active: body.active !== false,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await adminClient
      .from('gift_commercial_settings')
      .select('id')
      .eq('gift_fulfilment_centre_id', gfcId)
      .maybeSingle();

    let result;
    if (existing?.id) {
      const { data, error } = await adminClient
        .from('gift_commercial_settings')
        .update(row)
        .eq('id', existing.id)
        .select(SELECT)
        .single();
      if (error) return jsonResponse(500, { success: false, error: error.message });
      result = data;
    } else {
      const { data, error } = await adminClient
        .from('gift_commercial_settings')
        .insert(row)
        .select(SELECT)
        .single();
      if (error) return jsonResponse(500, { success: false, error: error.message });
      result = data;
    }

    return jsonResponse(200, { success: true, data: result });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
