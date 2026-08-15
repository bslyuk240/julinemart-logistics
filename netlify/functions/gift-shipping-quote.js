/**
 * POST /api/gift-shipping-quote
 *
 * Gift checkout shipping — consolidated dispatch from GFC hub via calc-shipping.
 *
 * Body:
 *   delivery_state, delivery_city (required)
 *   gfc_code | gfc_id
 *   gift_box_slug | gift_box_id  OR  builder_session_token
 *   order_value — customer subtotal before shipping (BYO; ready-made uses box list_price)
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { handler as calcShippingHandler } from './calc-shipping.js';
import {
  computeCustomerGiftTotal,
  loadGiftCommercialSettings,
} from './services/gift-commercial.js';
import { checkRateLimit } from './services/rate-limit.js';

const DEFAULT_LINE_WEIGHT_KG = 0.5;

async function resolveGfc(code, gfcId) {
  let q = adminClient.from('gift_fulfilment_centres').select('id, code, name, city, state').eq('active', true);
  if (gfcId) q = q.eq('id', gfcId);
  else if (code) q = q.eq('code', String(code).trim().toLowerCase());
  else q = q.eq('is_default', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveGfcHub(gfc) {
  const { data: hubs, error } = await adminClient.from('hubs').select('id, name, city, state');
  if (error) throw error;
  if (!hubs?.length) return null;

  const city = (gfc.city || '').trim().toLowerCase();
  const state = (gfc.state || '').trim().toLowerCase();

  return (
    hubs.find((h) => h.city?.toLowerCase() === city && h.state?.toLowerCase() === state) ||
    hubs.find((h) => h.state?.toLowerCase() === state) ||
    hubs[0]
  );
}

function lineWeight(product) {
  const w = Number(product?.weight);
  return Number.isFinite(w) && w >= 0 ? w : DEFAULT_LINE_WEIGHT_KG;
}

async function buildCalcItemsFromBox(boxId, hubId, unitPrice) {
  const { data: boxItems, error } = await adminClient
    .from('gift_box_items')
    .select('product_id, quantity, line_source, pool_sourced_item_id')
    .eq('gift_box_id', boxId);

  if (error) throw error;

  const vendorProductIds = (boxItems || [])
    .filter((i) => (i.line_source || 'vendor_catalog') === 'vendor_catalog')
    .map((i) => i.product_id)
    .filter(Boolean);

  const { data: products } = vendorProductIds.length
    ? await adminClient.from('products').select('id, weight').in('id', vendorProductIds)
    : { data: [] };

  const productMap = new Map((products || []).map((p) => [p.id, p]));
  const items = [];

  for (const row of boxItems || []) {
    const qty = Number(row.quantity || 1);
    if ((row.line_source || 'vendor_catalog') === 'jlo_sourced') {
      items.push({
        hubId,
        quantity: qty,
        weight: DEFAULT_LINE_WEIGHT_KG,
        price: 0,
      });
    } else if (row.product_id) {
      items.push({
        hubId,
        quantity: qty,
        weight: lineWeight(productMap.get(row.product_id)),
        price: unitPrice / Math.max((boxItems || []).length, 1),
      });
    }
  }

  if (!items.length) {
    items.push({ hubId, quantity: 1, weight: DEFAULT_LINE_WEIGHT_KG, price: unitPrice });
  }

  return items;
}

async function buildCalcItemsFromBuilder(sessionToken, hubId) {
  const { data: session, error: sessErr } = await adminClient
    .from('gift_builder_sessions')
    .select('id, gift_packaging_type_id')
    .eq('session_token', sessionToken)
    .maybeSingle();

  if (sessErr) throw sessErr;
  if (!session) throw new Error('Builder session not found');

  const { data: builderItems, error: biErr } = await adminClient
    .from('gift_builder_items')
    .select('product_id, quantity, component_cost, line_source, pool_sourced_item_id')
    .eq('gift_builder_session_id', session.id);

  if (biErr) throw biErr;

  const productIds = [...new Set((builderItems || []).map((i) => i.product_id).filter(Boolean))];
  const { data: products } = productIds.length
    ? await adminClient.from('products').select('id, weight').in('id', productIds)
    : { data: [] };

  const productMap = new Map((products || []).map((p) => [p.id, p]));
  const items = [];

  for (const row of builderItems || []) {
    const qty = Number(row.quantity || 1);
    if ((row.line_source || 'vendor_catalog') === 'jlo_sourced') {
      items.push({
        hubId,
        quantity: qty,
        weight: DEFAULT_LINE_WEIGHT_KG,
        price: Number(row.component_cost || 0),
      });
    } else if (row.product_id) {
      items.push({
        hubId,
        quantity: qty,
        weight: lineWeight(productMap.get(row.product_id)),
        price: Number(row.component_cost || 0),
      });
    }
  }

  if (!items.length) {
    items.push({ hubId, quantity: 1, weight: DEFAULT_LINE_WEIGHT_KG, price: 0 });
  }

  return { items, session };
}

async function resolveBuilderOrderValue(session, gfcId) {
  const { data: builderItems } = await adminClient
    .from('gift_builder_items')
    .select('quantity, component_cost')
    .eq('gift_builder_session_id', session.id);

  const componentCostTotal = (builderItems || []).reduce(
    (s, i) => s + Number(i.component_cost || 0) * Number(i.quantity || 0),
    0
  );

  let packagingFee = 0;
  if (session.gift_packaging_type_id) {
    const { data: pkg } = await adminClient
      .from('gift_packaging_types')
      .select('price')
      .eq('id', session.gift_packaging_type_id)
      .maybeSingle();
    packagingFee = Number(pkg?.price || 0);
  }

  const settings = await loadGiftCommercialSettings(adminClient, gfcId);
  return computeCustomerGiftTotal({
    componentCostTotal,
    packagingFee,
    settings,
  }).customerSubtotal;
}

export async function quoteGiftShipping(body) {
  const deliveryState = String(body.delivery_state || body.deliveryState || '').trim();
  const deliveryCity = String(body.delivery_city || body.deliveryCity || '').trim();
  if (!deliveryState || !deliveryCity) {
    throw new Error('delivery_state and delivery_city required');
  }

  const gfc = await resolveGfc(body.gfc_code, body.gfc_id);
  if (!gfc) throw new Error('Gift fulfilment centre not found');

  const hub = await resolveGfcHub(gfc);
  if (!hub?.id) throw new Error('No hub configured for gift fulfilment');

  let calcItems = [];
  let orderValue = Number(body.order_value || body.orderValue || 0);

  if (body.builder_session_token) {
    const built = await buildCalcItemsFromBuilder(body.builder_session_token, hub.id);
    calcItems = built.items;
    if (!orderValue) {
      orderValue = await resolveBuilderOrderValue(built.session, gfc.id);
    }
  } else if (body.gift_box_slug || body.gift_box_id) {
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

    orderValue = Number(box.list_price || orderValue || 0);
    calcItems = await buildCalcItemsFromBox(box.id, hub.id, orderValue);
  } else {
    throw new Error('gift_box_slug, gift_box_id, or builder_session_token required');
  }

  const calcEvent = {
    httpMethod: 'POST',
    body: JSON.stringify({
      deliveryState,
      deliveryCity,
      items: calcItems,
      totalOrderValue: orderValue,
    }),
  };

  const calcResult = await calcShippingHandler(calcEvent);
  const parsed = JSON.parse(calcResult.body || '{}');

  if (calcResult.statusCode !== 200 || !parsed.success) {
    throw new Error(parsed.error || parsed.message || 'Shipping calculation failed');
  }

  return {
    shipping: Number(parsed.data?.totalShippingFee ?? 0),
    zone: parsed.data?.zoneName || null,
    hub: { id: hub.id, name: hub.name },
    order_value: orderValue,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { success: false, error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-shipping-quote',
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
    const result = await quoteGiftShipping(body);
    return jsonResponse(200, { success: true, data: result });
  } catch (err) {
    return jsonResponse(400, { success: false, error: err?.message || String(err) });
  }
}
