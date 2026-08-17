/**
 * POST /api/gift-delivery-dates
 *
 * Preview earliest/latest delivery dates for a gift order context.
 *
 * Body: gfc_code | gfc_id, gift_box_slug | builder_session_token, delivery_state (optional)
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import { resolveBoxItemLines, resolveBuilderItemLines } from './services/gift-order-resolve.js';
import { loadGiftCommercialSettings } from './services/gift-commercial.js';
import {
  computeEarliestDeliveryDate,
  loadGfcSchedulingContext,
  maxLeadTimeForGiftLines,
} from './services/gift-delivery-schedule.js';

async function resolveGfc(code, gfcId) {
  let q = adminClient.from('gift_fulfilment_centres').select('id').eq('active', true);
  if (gfcId) q = q.eq('id', gfcId);
  else if (code) q = q.eq('code', String(code).trim().toLowerCase());
  else q = q.eq('is_default', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveLines(body, gfcId) {
  if (body.builder_session_token) {
    const { data: session } = await adminClient
      .from('gift_builder_sessions')
      .select('id')
      .eq('session_token', String(body.builder_session_token).trim())
      .maybeSingle();
    if (!session) throw new Error('Builder session not found');

    const { data: items } = await adminClient
      .from('gift_builder_items')
      .select(
        'product_id, variation_id, quantity, line_source, pool_sourced_item_id'
      )
      .eq('gift_builder_session_id', session.id);

    return resolveBuilderItemLines(adminClient, items || [], gfcId);
  }

  if (body.gift_box_slug || body.gift_box_id) {
    let boxQuery = adminClient
      .from('gift_boxes')
      .select('id')
      .eq('gift_fulfilment_centre_id', gfcId)
      .eq('active', true);

    if (body.gift_box_id) boxQuery = boxQuery.eq('id', body.gift_box_id);
    else boxQuery = boxQuery.eq('slug', String(body.gift_box_slug).trim().toLowerCase());

    const { data: box } = await boxQuery.maybeSingle();
    if (!box) throw new Error('Gift box not found');

    const { data: boxItems } = await adminClient
      .from('gift_box_items')
      .select(
        'product_id, variation_id, quantity, line_source, pool_sourced_item_id'
      )
      .eq('gift_box_id', box.id);

    return resolveBoxItemLines(adminClient, boxItems || [], gfcId);
  }

  return { lines: [] };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { success: false, error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-delivery-dates',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  try {
    const gfcRow = await resolveGfc(body.gfc_code, body.gfc_id);
    if (!gfcRow) return jsonResponse(404, { success: false, error: 'Hub not found' });

    const gfc = await loadGfcSchedulingContext(adminClient, gfcRow.id);
    const resolved = await resolveLines(body, gfcRow.id);
    let maxLead = await maxLeadTimeForGiftLines(adminClient, resolved.lines || [], gfcRow.id);
    if (body.builder_session_token) {
      const settings = await loadGiftCommercialSettings(adminClient, gfcRow.id);
      maxLead = Math.max(maxLead, Number(settings.byo_lead_time_days ?? 1));
    }
    const earliest = computeEarliestDeliveryDate({ gfc, maxLeadTimeDays: maxLead });
    const latest = new Date(earliest.getTime());
    latest.setUTCDate(latest.getUTCDate() + 90);

    return jsonResponse(200, {
      success: true,
      data: {
        earliest_date: earliest.toISOString().slice(0, 10),
        latest_date: latest.toISOString().slice(0, 10),
        max_lead_time_days: maxLead,
        same_day_supported: Boolean(gfc?.same_day_supported),
        next_day_supported: Boolean(gfc?.next_day_supported),
        cutoff_time: gfc?.cutoff_time || null,
      },
    });
  } catch (err) {
    return jsonResponse(400, { success: false, error: err?.message || String(err) });
  }
}
