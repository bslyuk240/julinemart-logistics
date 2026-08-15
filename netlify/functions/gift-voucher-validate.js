/**
 * POST /api/gift-voucher-validate
 *
 * Validate campaign voucher for gift checkout (discount on customer gift subtotal).
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import { resolveBoxItemLines, resolveBuilderItemLines } from './services/gift-order-resolve.js';
import {
  computeCustomerGiftTotal,
  loadGiftCommercialSettings,
} from './services/gift-commercial.js';
import { validateGiftCampaignVoucher } from './services/gift-voucher.js';

async function resolveGfc(code, gfcId) {
  let q = adminClient.from('gift_fulfilment_centres').select('id, code').eq('active', true);
  if (gfcId) q = q.eq('id', gfcId);
  else if (code) q = q.eq('code', String(code).trim().toLowerCase());
  else q = q.eq('is_default', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveGiftContext(body) {
  const gfc = await resolveGfc(body.gfc_code, body.gfc_id);
  if (!gfc) throw new Error('Gift fulfilment centre not found');

  if (body.builder_session_token) {
    const { data: session, error: sessErr } = await adminClient
      .from('gift_builder_sessions')
      .select('id, gift_packaging_type_id')
      .eq('session_token', String(body.builder_session_token).trim())
      .maybeSingle();
    if (sessErr) throw sessErr;
    if (!session) throw new Error('Builder session not found');

    const { data: builderItems, error: biErr } = await adminClient
      .from('gift_builder_items')
      .select(
        'product_id, variation_id, quantity, component_cost, line_source, pool_sourced_item_id'
      )
      .eq('gift_builder_session_id', session.id);
    if (biErr) throw biErr;

    const resolved = await resolveBuilderItemLines(adminClient, builderItems || [], gfc.id);
    let packagingFee = 0;
    if (session.gift_packaging_type_id) {
      const { data: pkg } = await adminClient
        .from('gift_packaging_types')
        .select('price')
        .eq('id', session.gift_packaging_type_id)
        .maybeSingle();
      packagingFee = Number(pkg?.price || 0);
    }

    const settings = await loadGiftCommercialSettings(adminClient, gfc.id);
    const pricing = computeCustomerGiftTotal({
      componentCostTotal: resolved.componentCostTotal,
      packagingFee,
      settings,
    });

    return {
      lines: resolved.lines,
      customerSubtotal: pricing.customerSubtotal,
    };
  }

  if (body.gift_box_slug || body.gift_box_id) {
    let boxQuery = adminClient
      .from('gift_boxes')
      .select('id, list_price')
      .eq('gift_fulfilment_centre_id', gfc.id)
      .eq('active', true);

    if (body.gift_box_id) boxQuery = boxQuery.eq('id', body.gift_box_id);
    else boxQuery = boxQuery.eq('slug', String(body.gift_box_slug).trim().toLowerCase());

    const { data: box, error: boxErr } = await boxQuery.maybeSingle();
    if (boxErr) throw boxErr;
    if (!box) throw new Error('Gift box not found');

    const { data: boxItems, error: itemsErr } = await adminClient
      .from('gift_box_items')
      .select(
        'product_id, variation_id, quantity, component_cost, line_source, pool_sourced_item_id'
      )
      .eq('gift_box_id', box.id);
    if (itemsErr) throw itemsErr;

    const resolved = await resolveBoxItemLines(adminClient, boxItems || [], gfc.id);
    return {
      lines: resolved.lines,
      customerSubtotal: Number(box.list_price || 0),
    };
  }

  if (body.order_subtotal != null) {
    return {
      lines: [],
      customerSubtotal: Number(body.order_subtotal),
    };
  }

  throw new Error('gift_box_slug, builder_session_token, or order_subtotal required');
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { success: false, error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-voucher-validate',
    max: 40,
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

  const voucherCode = body.voucher_code || body.coupon_code;
  const customerEmail = body.customer_email || body.email;

  if (!voucherCode?.trim()) {
    return jsonResponse(400, { success: false, error: 'voucher_code required' });
  }
  if (!customerEmail?.trim()) {
    return jsonResponse(400, { success: false, error: 'customer_email required' });
  }

  try {
    const { lines, customerSubtotal } = await resolveGiftContext(body);
    const result = await validateGiftCampaignVoucher(adminClient, {
      code: voucherCode,
      customerEmail: customerEmail.trim(),
      customerSubtotal,
      lines,
    });

    return jsonResponse(200, {
      success: true,
      data: {
        code: result.code,
        campaign_name: result.campaign_name,
        discount_amount: result.discountAmount,
        order_subtotal: customerSubtotal,
        discounted_subtotal: Math.max(customerSubtotal - result.discountAmount, 0),
      },
    });
  } catch (err) {
    return jsonResponse(400, { success: false, error: err?.message || String(err) });
  }
}
