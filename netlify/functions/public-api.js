/**
 * Versioned public/service API — /api/v1/* (see netlify.toml redirect to
 * this function; event.path retains the real incoming path, same pattern
 * as meta-ads.js / save-courier-credentials.js).
 *
 * Every request needs `Authorization: Bearer <service_api_key>`. Every
 * response is JSON, including errors: { "error": "message" }. Routes are
 * grouped by CAPABILITY (resource:action) — see serviceApiKeyAuth.js and
 * admin-service-api-keys.js for how keys are granted these capabilities.
 *
 * Capabilities:
 *   orders:read          GET /orders, GET /orders/:id
 *   shipments:read        GET /shipments, GET /shipments/delayed, GET /shipments/:id
 *   vendors:read           GET /vendors, GET /vendors/:id
 *   riders:read              GET /riders/:id/status
 *   shipment_notes:write   POST /shipments/:id/notes
 *
 * PII is intentionally minimized for an external/agent audience: customer
 * email is never returned by this API, and list endpoints omit street
 * addresses (available on the single-resource detail endpoints).
 */
import { authenticateServiceApiRequest, jsonError } from './services/serviceApiKeyAuth.js';
import { fetchSourceDetails, summarizeShipment, SHIPMENT_LIST_SELECT } from './services/shipmentSummary.js';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function paginationParams(query) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
}

const ORDER_LIST_FIELDS =
  'id, order_number, woocommerce_order_id, customer_name, delivery_city, delivery_state, delivery_zone, overall_status, payment_status, total_amount, created_at, updated_at';
const ORDER_DETAIL_FIELDS =
  'id, order_number, woocommerce_order_id, customer_name, customer_phone, delivery_address, delivery_city, delivery_state, delivery_zone, delivery_lga, delivery_landmark, subtotal, total_amount, shipping_fee_paid, tax_amount, discount_amount, payment_status, overall_status, payment_method, paid_at, order_notes, special_instructions, created_at, updated_at';

async function listOrders(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('orders')
    .select(ORDER_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('overall_status', query.status);
  if (query.since) q = q.gte('created_at', query.since);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getOrder(adminClient, id) {
  const { data: order, error } = await adminClient.from('orders').select(ORDER_DETAIL_FIELDS).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!order) return json(404, { error: 'Order not found' });

  const { data: subOrders } = await adminClient
    .from('sub_orders')
    .select('id, status, tracking_number, courier_waybill, vendor_id, hub_id, vendors ( store_name ), hubs ( name )')
    .eq('main_order_id', id);

  return json(200, {
    data: {
      ...order,
      sub_orders: (subOrders || []).map((so) => ({
        id: so.id,
        status: so.status,
        tracking_number: so.tracking_number,
        courier_waybill: so.courier_waybill,
        vendor_name: so.vendors?.store_name || null,
        hub_name: so.hubs?.name || null,
      })),
    },
  });
}

async function listShipments(adminClient, query, { delayedOnly = false } = {}) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('shipments')
    .select(SHIPMENT_LIST_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);

  if (delayedOnly) {
    const hours = Math.max(1, Number(query.hours) || 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    q = q
      .not('status', 'in', '(delivered,failed,cancelled,returned)')
      .lt('created_at', cutoff);
  }

  const { data: shipments, error, count } = await q;
  if (error) return json(500, { error: error.message });

  const { subOrderMap, manualMap } = await fetchSourceDetails(adminClient, shipments || []);
  const summarized = (shipments || [])
    .map((s) => summarizeShipment(s, subOrderMap, manualMap))
    .filter(Boolean);

  return json(200, { data: summarized, count });
}

async function getShipment(adminClient, id) {
  const { data: shipment, error } = await adminClient.from('shipments').select(SHIPMENT_LIST_SELECT).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!shipment) return json(404, { error: 'Shipment not found' });

  const { subOrderMap, manualMap } = await fetchSourceDetails(adminClient, [shipment]);
  const summary = summarizeShipment(shipment, subOrderMap, manualMap);
  if (!summary) return json(404, { error: 'Shipment not found' });
  return json(200, { data: summary });
}

async function addShipmentNote(adminClient, id, body, apiKeyName) {
  const note = String(body?.note || '').trim();
  if (!note) return json(400, { error: 'note is required' });
  if (note.length > 2000) return json(400, { error: 'note must be 2000 characters or fewer' });

  const { data: shipment } = await adminClient.from('shipments').select('id').eq('id', id).maybeSingle();
  if (!shipment) return json(404, { error: 'Shipment not found' });

  const author = String(body?.author || apiKeyName || 'service-api').slice(0, 200);
  const { data: created, error } = await adminClient
    .from('shipment_notes')
    .insert({ shipment_id: id, source: 'api', author, note })
    .select('id, shipment_id, source, author, note, created_at')
    .single();

  if (error) return json(500, { error: error.message });
  return json(201, { data: created });
}

const VENDOR_LIST_FIELDS = 'id, store_name, store_slug, email, phone, city, state, is_active, total_orders, fulfilled_orders, created_at';
const VENDOR_DETAIL_FIELDS = `${VENDOR_LIST_FIELDS}, address, description, logo_url`;

async function listVendors(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('vendors')
    .select(VENDOR_LIST_FIELDS, { count: 'exact' })
    .order('store_name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (query.active === 'true') q = q.eq('is_active', true);
  if (query.active === 'false') q = q.eq('is_active', false);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getVendor(adminClient, id) {
  const { data, error } = await adminClient.from('vendors').select(VENDOR_DETAIL_FIELDS).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Vendor not found' });
  return json(200, { data });
}

async function getRiderStatus(adminClient, id) {
  const { data, error } = await adminClient
    .from('riders')
    .select('id, full_name, phone, status, is_online, last_online_at, updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Rider not found' });
  return json(200, { data });
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }

  const path = String(event.path || '').replace(/^\/api\/v1\/?/, '').replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  const method = event.httpMethod;
  const query = event.queryStringParameters || {};

  try {
    // --- /orders ---
    if (segments[0] === 'orders') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'orders:read');
        if (auth.errorResponse) return auth.errorResponse;
        return await listOrders(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'orders:read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getOrder(auth.adminClient, segments[1]);
      }
    }

    // --- /shipments ---
    if (segments[0] === 'shipments') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'shipments:read');
        if (auth.errorResponse) return auth.errorResponse;
        return await listShipments(auth.adminClient, query);
      }
      if (segments.length === 2 && segments[1] === 'delayed' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'shipments:read');
        if (auth.errorResponse) return auth.errorResponse;
        return await listShipments(auth.adminClient, query, { delayedOnly: true });
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'shipments:read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getShipment(auth.adminClient, segments[1]);
      }
      if (segments.length === 3 && segments[2] === 'notes' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'shipment_notes:write');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await addShipmentNote(auth.adminClient, segments[1], body, auth.apiKey.name);
      }
    }

    // --- /vendors ---
    if (segments[0] === 'vendors') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'vendors:read');
        if (auth.errorResponse) return auth.errorResponse;
        return await listVendors(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'vendors:read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getVendor(auth.adminClient, segments[1]);
      }
    }

    // --- /riders/:id/status ---
    if (segments[0] === 'riders' && segments.length === 3 && segments[2] === 'status' && method === 'GET') {
      const auth = await authenticateServiceApiRequest(event, 'riders:read');
      if (auth.errorResponse) return auth.errorResponse;
      return await getRiderStatus(auth.adminClient, segments[1]);
    }

    return json(404, { error: `No route for ${method} /api/v1/${path}` });
  } catch (err) {
    if (err instanceof SyntaxError) return json(400, { error: 'Invalid JSON body' });
    console.error('[public-api] unhandled error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
