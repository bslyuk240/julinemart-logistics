/**
 * Versioned public/service API — /api/v1/* (see netlify.toml redirect to
 * this function; event.path retains the real incoming path, same pattern
 * as meta-ads.js / save-courier-credentials.js).
 *
 * Every request needs `Authorization: Bearer <service_api_key>`. Every
 * response is JSON, including errors: { "error": "message" }.
 *
 * This router is a mechanical translation of the capability manifest in
 * services/capabilityCatalog.js — that file is the source of truth for
 * what exists and what each capability id means; this file just wires
 * each enabled capability to its handler. GET /api/v1/capabilities serves
 * the manifest itself so a Custom API consumer (Skola Workforce or
 * anything else) can discover what's available without reading this code.
 *
 * PII is intentionally minimized for an external/agent audience: customer
 * email is never returned, list endpoints omit street addresses, and
 * rider live location / customer PII domains are advertised in the
 * manifest but not enabled — see capabilityCatalog.js for why.
 */
import { authenticateServiceApiRequest, jsonError } from './services/serviceApiKeyAuth.js';
import { fetchSourceDetails, summarizeShipment, SHIPMENT_LIST_SELECT } from './services/shipmentSummary.js';
import { getCapabilityManifest } from './services/capabilityCatalog.js';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function paginationParams(query) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
}

// ── orders.* ────────────────────────────────────────────────────────────
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
  if (query.q) q = q.or(`customer_name.ilike.%${query.q}%,order_number.eq.${Number(query.q) || 0}`);

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

async function getOrderStatus(adminClient, id) {
  const { data, error } = await adminClient
    .from('orders')
    .select('id, order_number, overall_status, payment_status, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Order not found' });
  return json(200, { data });
}

async function getOrderItems(adminClient, id) {
  const { data: order } = await adminClient.from('orders').select('id').eq('id', id).maybeSingle();
  if (!order) return json(404, { error: 'Order not found' });

  const { data, error } = await adminClient
    .from('order_items')
    .select('id, product_id, product_name, product_sku, variation_id, variation_details, unit_price, quantity, subtotal, tax, warranty_type, warranty_months')
    .eq('order_id', id);

  if (error) return json(500, { error: error.message });
  return json(200, { data: data || [] });
}

// ── shipments.* ─────────────────────────────────────────────────────────
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

async function getShipmentTimeline(adminClient, id) {
  const { data: shipment } = await adminClient.from('shipments').select('id').eq('id', id).maybeSingle();
  if (!shipment) return json(404, { error: 'Shipment not found' });

  const { data, error } = await adminClient
    .from('tracking_events')
    .select('id, status, event_time, location_name, location_city, location_state, description, remarks, actor_type, actor_name, source, created_at')
    .eq('shipment_id', id)
    .order('event_time', { ascending: true });

  if (error) return json(500, { error: error.message });
  return json(200, { data: data || [] });
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

// ── vendors.* ───────────────────────────────────────────────────────────
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

async function getVendorOrders(adminClient, id, query) {
  const { data: vendor } = await adminClient.from('vendors').select('id').eq('id', id).maybeSingle();
  if (!vendor) return json(404, { error: 'Vendor not found' });

  const { limit, offset } = paginationParams(query);
  const { data, error, count } = await adminClient
    .from('sub_orders')
    .select('id, status, subtotal, created_at, orders:main_order_id ( order_number, overall_status )', { count: 'exact' })
    .eq('vendor_id', id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return json(500, { error: error.message });
  return json(200, {
    data: (data || []).map((so) => ({
      id: so.id,
      status: so.status,
      subtotal: so.subtotal,
      created_at: so.created_at,
      order_number: so.orders?.order_number || null,
      order_status: so.orders?.overall_status || null,
    })),
    count,
  });
}

async function getVendorPerformance(adminClient, id) {
  const { data, error } = await adminClient
    .from('vendors')
    .select('id, store_name, total_orders, fulfilled_orders, average_processing_time_hours, seller_quality_score')
    .eq('id', id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Vendor not found' });
  return json(200, { data });
}

// ── riders.* ────────────────────────────────────────────────────────────
async function listRiders(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('riders')
    .select('id, full_name, phone, status, is_online, last_online_at, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);
  if (query.online === 'true') q = q.eq('is_online', true);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getRider(adminClient, id) {
  const { data, error } = await adminClient
    .from('riders')
    .select('id, full_name, email, phone, status, vehicle_type, vehicle_plate, is_online, last_online_at, approved_at, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Rider not found' });
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

// ── catalogue: products.* / categories.* ───────────────────────────────
const PRODUCT_LIST_FIELDS =
  'id, name, slug, sku, status, type, regular_price, sale_price, stock_status, stock_quantity, vendor_id, average_rating, rating_count, created_at, updated_at';
const PRODUCT_DETAIL_FIELDS =
  `${PRODUCT_LIST_FIELDS}, description, short_description, weight, length, width, height, is_virtual, warranty_type, warranty_months`;

async function listProducts(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('products')
    .select(PRODUCT_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);
  if (query.vendor_id) q = q.eq('vendor_id', query.vendor_id);
  if (query.stock_status) q = q.eq('stock_status', query.stock_status);
  if (query.q) q = q.or(`name.ilike.%${query.q}%,sku.ilike.%${query.q}%`);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getProduct(adminClient, id) {
  const { data, error } = await adminClient.from('products').select(PRODUCT_DETAIL_FIELDS).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Product not found' });
  return json(200, { data });
}

async function listCategories(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  const { data, error, count } = await adminClient
    .from('categories')
    .select('id, name, slug, parent_id, description, display_order', { count: 'exact' })
    .order('display_order', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
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
    // --- discovery ---
    if (segments[0] === 'capabilities' && segments.length === 1 && method === 'GET') {
      const auth = await authenticateServiceApiRequest(event); // any valid active key, no specific capability
      if (auth.errorResponse) return auth.errorResponse;
      return json(200, getCapabilityManifest());
    }

    // --- orders ---
    if (segments[0] === 'orders') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, ['orders.list', 'orders.search']);
        if (auth.errorResponse) return auth.errorResponse;
        return await listOrders(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'orders.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getOrder(auth.adminClient, segments[1]);
      }
      if (segments.length === 3 && segments[2] === 'status' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'orders.status');
        if (auth.errorResponse) return auth.errorResponse;
        return await getOrderStatus(auth.adminClient, segments[1]);
      }
      if (segments.length === 3 && segments[2] === 'items' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'orders.items.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getOrderItems(auth.adminClient, segments[1]);
      }
    }

    // --- shipments ---
    if (segments[0] === 'shipments') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'shipments.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listShipments(auth.adminClient, query);
      }
      if (segments.length === 2 && segments[1] === 'delayed' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'shipments.delayed.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listShipments(auth.adminClient, query, { delayedOnly: true });
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, ['shipments.read', 'shipments.track']);
        if (auth.errorResponse) return auth.errorResponse;
        return await getShipment(auth.adminClient, segments[1]);
      }
      if (segments.length === 3 && segments[2] === 'timeline' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'shipments.timeline.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getShipmentTimeline(auth.adminClient, segments[1]);
      }
      if (segments.length === 3 && segments[2] === 'notes' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'shipments.notes.write');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await addShipmentNote(auth.adminClient, segments[1], body, auth.apiKey.name);
      }
    }

    // --- vendors ---
    if (segments[0] === 'vendors') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'vendors.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listVendors(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'vendors.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getVendor(auth.adminClient, segments[1]);
      }
      if (segments.length === 3 && segments[2] === 'orders' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'vendors.orders.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getVendorOrders(auth.adminClient, segments[1], query);
      }
      if (segments.length === 3 && segments[2] === 'performance' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'vendors.performance.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getVendorPerformance(auth.adminClient, segments[1]);
      }
    }

    // --- riders ---
    if (segments[0] === 'riders') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'riders.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listRiders(auth.adminClient, query);
      }
      if (segments.length === 3 && segments[2] === 'status' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'riders.status.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getRiderStatus(auth.adminClient, segments[1]);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'riders.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getRider(auth.adminClient, segments[1]);
      }
    }

    // --- catalogue ---
    if (segments[0] === 'products') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, ['products.list', 'products.search']);
        if (auth.errorResponse) return auth.errorResponse;
        return await listProducts(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'products.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getProduct(auth.adminClient, segments[1]);
      }
    }
    if (segments[0] === 'categories' && segments.length === 1 && method === 'GET') {
      const auth = await authenticateServiceApiRequest(event, 'categories.list');
      if (auth.errorResponse) return auth.errorResponse;
      return await listCategories(auth.adminClient, query);
    }

    return json(404, { error: `No route for ${method} /api/v1/${path}` });
  } catch (err) {
    if (err instanceof SyntaxError) return json(400, { error: 'Invalid JSON body' });
    console.error('[public-api] unhandled error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
