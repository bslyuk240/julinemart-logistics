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
 * rider live location is advertised in the manifest but not enabled —
 * see capabilityCatalog.js. Customer profile (name/phone) is available
 * under customers.read / customers.orders.read.
 */
import { authenticateServiceApiRequest, jsonError } from './services/serviceApiKeyAuth.js';
import { fetchSourceDetails, summarizeShipment, SHIPMENT_LIST_SELECT } from './services/shipmentSummary.js';
import { getCapabilityManifest } from './services/capabilityCatalog.js';
import { sendTransactionalEmail, sendTransactionalEmailBulk, RESEND_BATCH_LIMIT } from './services/emailNotifications.js';
import { sendPushViaPwa } from './services/pushSendProxy.js';
import { logNotificationHistory, PUSH_HISTORY_ACTION } from './services/notificationHistory.js';
import {
  getCampaigns as getMetaCampaigns,
  syncCampaigns as syncMetaCampaigns,
  getDrafts as getMetaDrafts,
  createDraft as createMetaDraft,
  approveDraft as approveMetaDraft,
  updateCampaignBudget as updateMetaCampaignBudget,
  updateCampaignStatus as updateMetaCampaignStatus,
  publishDraft as publishMetaDraft,
  getAccountInfo as getMetaAccountInfo,
  getRecommendations as getMetaRecommendations,
} from './meta-ads.js';
import {
  postToFacebookPage,
  postToInstagram,
  getFacebookPageProfile,
  listFacebookPagePosts,
  getFacebookPageInsights,
  getInstagramProfile,
  listInstagramMedia,
  getInstagramInsights,
} from './services/metaOrganicPost.js';
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  listWhatsAppThreads,
  readWhatsAppThread,
  listWhatsAppTemplates,
} from './services/internalWhatsapp.js';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function paginationParams(query) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
}

// Strips characters significant to PostgREST's .or() filter-string syntax
// (comma separates conditions, parens nest logic groups) before a caller-
// supplied search term is spliced into one. Without this, a `q` containing
// a comma appends an independent filter clause against ANY column on the
// table — e.g. a key scoped only to orders.search (customer_name/order_number)
// could probe order_notes/payment_method, which are only meant to be
// reachable via the separate orders.read capability. Query-builder methods
// like .eq()/.ilike() parameterize correctly; only .or()'s raw string
// argument needs this.
function sanitizeSearchTerm(value) {
  return String(value || '').replace(/[,()%]/g, '').trim().slice(0, 200);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  const searchTerm = sanitizeSearchTerm(query.q);
  if (searchTerm) q = q.or(`customer_name.ilike.%${searchTerm}%,order_number.eq.${Number(searchTerm) || 0}`);

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

const CUSTOMER_PUBLIC_FIELDS = 'id, first_name, last_name, phone, created_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveCustomer(adminClient, idOrPhone) {
  const key = String(idOrPhone || '').trim();
  if (!key) return { status: 400, error: 'Customer id is required' };

  if (UUID_RE.test(key)) {
    const { data, error } = await adminClient.from('customers').select(CUSTOMER_PUBLIC_FIELDS).eq('id', key).maybeSingle();
    if (error) return { status: 500, error: error.message };
    if (!data) return { status: 404, error: 'Customer not found' };
    return { customer: data };
  }

  const digits = key.replace(/\D/g, '');
  if (digits.length < 7) return { status: 404, error: 'Customer not found' };
  const last10 = digits.slice(-10);
  const { data, error } = await adminClient
    .from('customers')
    .select(CUSTOMER_PUBLIC_FIELDS)
    .like('phone', `%${last10}%`)
    .limit(5);
  if (error) return { status: 500, error: error.message };
  const rows = data || [];
  if (rows.length === 0) return { status: 404, error: 'Customer not found' };
  if (rows.length > 1) {
    return { status: 400, error: 'Multiple customers match that phone', matches: rows.map((r) => r.id) };
  }
  return { customer: rows[0] };
}

async function getCustomer(adminClient, idOrPhone) {
  const found = await resolveCustomer(adminClient, idOrPhone);
  if (!found.customer) {
    return json(found.status, { error: found.error, ...(found.matches ? { matches: found.matches } : {}) });
  }
  const c = found.customer;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null;
  return json(200, { data: { id: c.id, name, first_name: c.first_name || null, last_name: c.last_name || null, phone: c.phone || null, created_at: c.created_at } });
}

async function getCustomerOrders(adminClient, idOrPhone, query) {
  const found = await resolveCustomer(adminClient, idOrPhone);
  if (!found.customer) {
    return json(found.status, { error: found.error, ...(found.matches ? { matches: found.matches } : {}) });
  }
  const phone = String(found.customer.phone || '').replace(/\D/g, '');
  const last10 = phone.slice(-10);
  if (last10.length < 7) return json(200, { data: [], count: 0 });

  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('orders')
    .select(ORDER_LIST_FIELDS, { count: 'exact' })
    .like('customer_phone', `%${last10}%`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.status) q = q.eq('overall_status', query.status);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data: data || [], count });
}

// ── gift.* ──────────────────────────────────────────────────────────────
const GIFT_BOX_LIST_FIELDS = 'id, slug, name, description, image_url, list_price, active, recipient_types, occasion_types, sku, average_rating, rating_count, gift_fulfilment_centre_id';

async function listGiftBoxes(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('gift_boxes')
    .select(GIFT_BOX_LIST_FIELDS, { count: 'exact' })
    .order('sort_order', { ascending: true })
    .range(offset, offset + limit - 1);

  if (query.active === 'true') q = q.eq('active', true);
  if (query.active === 'false') q = q.eq('active', false);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getGiftBox(adminClient, id) {
  const { data: box, error } = await adminClient.from('gift_boxes').select(`${GIFT_BOX_LIST_FIELDS}, gallery_urls`).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!box) return json(404, { error: 'Gift box not found' });

  const { data: items } = await adminClient
    .from('gift_box_items')
    .select('id, product_id, variation_id, quantity, sort_order')
    .eq('gift_box_id', id)
    .order('sort_order', { ascending: true });

  return json(200, { data: { ...box, items: items || [] } });
}

const GIFT_ORDER_LIST_FIELDS = 'id, order_id, gift_box_id, gift_fulfilment_centre_id, gift_status, recipient_city, recipient_state, occasion, requested_delivery_date, created_at, updated_at';
const GIFT_ORDER_DETAIL_FIELDS = `${GIFT_ORDER_LIST_FIELDS}, recipient_name, recipient_phone, recipient_address, recipient_zone, gift_message, sender_visible, customer_subtotal, pack_photo_url, qc_notes, packed_at, dispatched_at, completed_at, occasion_date`;

async function listGiftOrders(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('gift_orders')
    .select(GIFT_ORDER_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('gift_status', query.status);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getGiftOrder(adminClient, id) {
  const { data, error } = await adminClient.from('gift_orders').select(GIFT_ORDER_DETAIL_FIELDS).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Gift order not found' });
  return json(200, { data });
}

async function getGiftOrderEvents(adminClient, id) {
  const { data: giftOrder } = await adminClient.from('gift_orders').select('id').eq('id', id).maybeSingle();
  if (!giftOrder) return json(404, { error: 'Gift order not found' });

  const { data, error } = await adminClient
    .from('gift_order_events')
    .select('id, status, note, actor_email, created_at')
    .eq('gift_order_id', id)
    .order('created_at', { ascending: true });

  if (error) return json(500, { error: error.message });
  return json(200, { data: data || [] });
}

async function listGiftFulfilmentCentres(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  const { data, error, count } = await adminClient
    .from('gift_fulfilment_centres')
    .select('id, name, code, country, state, city, address, active, is_default, supported_delivery_zones, cutoff_time, same_day_supported, next_day_supported', { count: 'exact' })
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function listGiftPackagingTypes(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('gift_packaging_types')
    .select('id, code, name, description, price, max_items, sku, active', { count: 'exact' })
    .order('sort_order', { ascending: true })
    .range(offset, offset + limit - 1);

  if (query.active === 'true') q = q.eq('active', true);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
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
  const searchTerm = sanitizeSearchTerm(query.q);
  if (searchTerm) q = q.or(`name.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%`);

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

// ── returns.* ───────────────────────────────────────────────────────────
const RETURN_LIST_FIELDS = 'id, order_number, status, reason, reason_code, complaint_type, preferred_resolution, refund_amount, refund_status, created_at, updated_at';
const RETURN_DETAIL_FIELDS = `${RETURN_LIST_FIELDS}, customer_name, hub_id, reason_note, images, evidence_urls, fez_tracking, inspection_result, inspection_notes, inspected_at, refund_method, refund_currency, refund_initiated_at, refund_expected_by, refund_completed_at, rejection_reason, seller_response, seller_responded_at, resolution_timeline`;

async function listReturns(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('return_requests')
    .select(RETURN_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getReturn(adminClient, id) {
  const { data, error } = await adminClient.from('return_requests').select(RETURN_DETAIL_FIELDS).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Return request not found' });
  return json(200, { data });
}

async function getReturnShipments(adminClient, id) {
  const { data: returnRequest } = await adminClient.from('return_requests').select('id').eq('id', id).maybeSingle();
  if (!returnRequest) return json(404, { error: 'Return request not found' });

  const { data, error } = await adminClient
    .from('return_shipments')
    .select('id, method, return_code, status, fez_tracking, waybill_number, destination_type, destination_address, tracking_submitted_at, created_at, updated_at')
    .eq('return_request_id', id)
    .order('created_at', { ascending: false });

  if (error) return json(500, { error: error.message });
  return json(200, { data: data || [] });
}

// ── influencers.* ───────────────────────────────────────────────────────
const INFLUENCER_LIST_FIELDS = 'id, name, handle, platform, coupon_code, tier, status, total_orders, total_sales, commission_rate, total_commission_earned, total_commission_paid, start_date, last_sale_date, created_at';
const INFLUENCER_DETAIL_FIELDS = `${INFLUENCER_LIST_FIELDS}, email, phone, shipping_discount_type, shipping_discount_value, minimum_order_value, maximum_uses, commission_based_on`;

async function listInfluencers(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('influencers')
    .select(INFLUENCER_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);
  if (query.tier) q = q.eq('tier', query.tier);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getInfluencer(adminClient, id) {
  const { data, error } = await adminClient.from('influencers').select(INFLUENCER_DETAIL_FIELDS).eq('id', id).maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Influencer not found' });
  return json(200, { data });
}

async function getInfluencerSales(adminClient, id, query) {
  const { data: influencer } = await adminClient.from('influencers').select('id').eq('id', id).maybeSingle();
  if (!influencer) return json(404, { error: 'Influencer not found' });

  const { limit, offset } = paginationParams(query);
  const { data, error, count } = await adminClient
    .from('influencer_sales')
    .select('id, order_number, product_total, influencer_commission_rate, influencer_commission_amount, commission_status, sale_date, order_status, payment_date, notes, created_at', { count: 'exact' })
    .eq('influencer_id', id)
    .order('sale_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

// ── custom_orders.* ─────────────────────────────────────────────────────
const CUSTOM_ORDER_LIST_FIELDS = 'id, order_id, order_item_id, status, price_adjustment, approved_at, created_at, updated_at';

async function listCustomOrders(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('custom_order_specs')
    .select(CUSTOM_ORDER_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);
  if (query.order_id) q = q.eq('order_id', query.order_id);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getCustomOrder(adminClient, id) {
  const { data, error } = await adminClient
    .from('custom_order_specs')
    .select(`${CUSTOM_ORDER_LIST_FIELDS}, field_values, schema_id, approved_proof_url`)
    .eq('id', id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Custom order spec not found' });
  return json(200, { data });
}

// ── campaigns.* ─────────────────────────────────────────────────────────
const CAMPAIGN_LIST_FIELDS = 'id, slug, internal_name, public_title, campaign_objective, status, approval_status, start_date, end_date, target_type, created_at, updated_at';

async function listCampaigns(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('campaigns')
    .select(CAMPAIGN_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (query.status) q = q.eq('status', query.status);
  if (query.approval_status) q = q.eq('approval_status', query.approval_status);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function getCampaign(adminClient, id) {
  const { data, error } = await adminClient
    .from('campaigns')
    .select(`${CAMPAIGN_LIST_FIELDS}, target_id, template_id, section_layout, hero_config, product_selection_rules, offer_config, meta_seo, vendor_id`)
    .eq('id', id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!data) return json(404, { error: 'Campaign not found' });
  return json(200, { data });
}

function slugifyCampaignTitle(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * campaigns.giveaway.submit — deliberately narrow input surface. Whitelists
 * exactly the marketing-facts fields an agent may set; anything financial
 * (voucher links, discount terms) or lifecycle-controlling (status,
 * approval_status, campaign_kind) is fixed server-side, never taken from the
 * caller, so a Custom API key can't grant itself more than "propose a draft."
 * Lands as approval_status='pending' in the SAME queue vendor-submitted
 * campaigns use (admin-vendor-campaigns.js) — no separate approval path.
 */
async function submitGiveawayCampaign(adminClient, body) {
  const publicTitle = String(body.public_title || '').trim();
  const secretCode = String(body.secret_code || '').trim();
  const grandPrizeDescription = String(body.grand_prize_description || '').trim();
  if (!publicTitle || !secretCode || !grandPrizeDescription) {
    return json(400, { error: 'public_title, secret_code, and grand_prize_description are required' });
  }

  const heroHeadline = String(body.hero_headline || publicTitle).trim();
  const heroSubtitle = String(body.hero_subtitle || '').trim();
  const startDate = body.start_date ? new Date(body.start_date).toISOString() : null;
  const endDate = body.end_date ? new Date(body.end_date).toISOString() : null;
  const entryLimit = body.entry_limit != null ? Number(body.entry_limit) : null;
  const earlyBirdLimit = body.early_bird_limit != null ? Number(body.early_bird_limit) : null;

  const baseSlug = slugifyCampaignTitle(publicTitle) || 'giveaway';
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

  const payload = {
    internal_name: `[Skola proposal] ${publicTitle}`.slice(0, 120),
    public_title: publicTitle,
    slug,
    campaign_objective: 'ai_proposed_giveaway',
    status: 'draft',
    campaign_kind: 'giveaway',
    target_type: 'general',
    approval_status: 'pending',
    submitted_via: 'skola_agent',
    submitted_at: new Date().toISOString(),
    start_date: startDate,
    end_date: endDate,
    secret_code: secretCode,
    entry_limit: Number.isFinite(entryLimit) ? entryLimit : null,
    early_bird_limit: Number.isFinite(earlyBirdLimit) ? earlyBirdLimit : null,
    grand_prize_description: grandPrizeDescription,
    hero_config: { headline: heroHeadline, subtitle: heroSubtitle, ctaLabel: 'Enter Now' },
    product_selection_rules: {},
    review_rules: {},
  };

  const { data: created, error: insertError } = await adminClient
    .from('campaigns')
    .insert(payload)
    .select('id, slug, approval_status, status')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return json(409, { error: 'Generated slug collided — retry the request' });
    }
    return json(500, { error: insertError.message });
  }

  const sections = [
    { campaign_id: created.id, section_type: 'hero', order_index: 0, is_visible: true, config: {} },
    { campaign_id: created.id, section_type: 'giveaway_entry', order_index: 1, is_visible: true, config: {} },
    { campaign_id: created.id, section_type: 'cta_footer', order_index: 2, is_visible: true, config: {} },
  ];
  const { error: sectionError } = await adminClient.from('campaign_sections').insert(sections);
  if (sectionError) return json(500, { error: sectionError.message });

  return json(201, {
    data: {
      ...created,
      message: 'Submitted for review in JulineMart\'s campaign approval queue — a human will attach the real reward voucher(s) and activate it after review.',
    },
  });
}

// ── meta.ads.* / meta.social.* ──────────────────────────────────────────
// meta.ads.* wraps meta-ads.js's own functions unchanged — same logic JLO's
// internal Ads Manager dashboard uses, reused rather than duplicated. Those
// functions return { statusCode, body: JSON.stringify({ success, data|error }) }
// (meta-ads.js's own response convention); this adapts that into this
// router's { data } / { error } convention. No user session exists on this
// path, so their optional userId/audit-log argument is passed as null —
// same as any other unauthenticated-user call those functions already support.
async function callMetaAdsHandler(fn, ...args) {
  const res = await fn(...args);
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return json(502, { error: 'Unexpected response from Meta Ads module' });
  }
  if (parsed.success) return json(res.statusCode, { data: parsed.data });
  return json(res.statusCode, { error: parsed.error });
}

async function postFacebookPage(body) {
  if (!isPlainObject(body)) return json(400, { error: 'Invalid JSON body' });
  const imageUrl = body.image_url ? String(body.image_url).trim() : undefined;
  const message = body.message ? String(body.message).trim() : undefined;
  const link = body.link ? String(body.link).trim() : undefined;
  if (!imageUrl && !message) return json(400, { error: 'message is required (or image_url for a photo post)' });
  try {
    const data = await postToFacebookPage({ message, link, imageUrl });
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

async function callMetaSocialRead(fn, ...args) {
  try {
    const data = await fn(...args);
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

function insightsQueryArgs(query) {
  return {
    metrics: query.metrics ? String(query.metrics).split(',').map((m) => m.trim()).filter(Boolean) : undefined,
    period: query.period || undefined,
    since: query.since || undefined,
    until: query.until || undefined,
  };
}

async function postInstagramImage(body) {
  if (!isPlainObject(body)) return json(400, { error: 'Invalid JSON body' });
  const imageUrl = String(body.image_url || '').trim();
  if (!imageUrl) return json(400, { error: 'image_url is required' });
  const caption = body.caption ? String(body.caption).trim() : undefined;
  try {
    const data = await postToInstagram({ imageUrl, caption });
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

// ── whatsapp.* (internal outreach — vendors/leads, not customer care) ───
async function sendWhatsAppMessageRoute(body) {
  if (!isPlainObject(body)) return json(400, { error: 'Invalid JSON body' });
  const to = String(body.to || '').trim();
  const message = String(body.message || '').trim();
  if (!to) return json(400, { error: 'to is required' });
  if (!message) return json(400, { error: 'message is required' });
  try {
    const data = await sendWhatsAppText({
      to,
      message,
      contactName: body.contact_name ? String(body.contact_name).trim() : undefined,
      contactType: body.contact_type === 'vendor' ? 'vendor' : 'lead',
      vendorId: body.vendor_id ? String(body.vendor_id) : undefined,
      sentByAgent: body.sent_by_agent ? String(body.sent_by_agent) : undefined,
    });
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

async function sendWhatsAppTemplateRoute(body) {
  if (!isPlainObject(body)) return json(400, { error: 'Invalid JSON body' });
  const to = String(body.to || '').trim();
  const templateName = String(body.template_name || '').trim();
  if (!to) return json(400, { error: 'to is required' });
  if (!templateName) return json(400, { error: 'template_name is required' });
  const variables = Array.isArray(body.variables) ? body.variables.map(String) : [];
  try {
    const data = await sendWhatsAppTemplate({
      to,
      templateName,
      variables,
      language: body.language ? String(body.language) : undefined,
      contactName: body.contact_name ? String(body.contact_name).trim() : undefined,
      contactType: body.contact_type === 'vendor' ? 'vendor' : 'lead',
      vendorId: body.vendor_id ? String(body.vendor_id) : undefined,
      sentByAgent: body.sent_by_agent ? String(body.sent_by_agent) : undefined,
      headerImageUrl: body.header_image_url ? String(body.header_image_url).trim() : undefined,
    });
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

async function listWhatsAppThreadsRoute(query) {
  try {
    const data = await listWhatsAppThreads({ contactType: query.contact_type || undefined });
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

async function readWhatsAppThreadRoute(query) {
  const phone = String(query.phone || '').trim();
  if (!phone) return json(400, { error: 'phone is required' });
  try {
    const data = await readWhatsAppThread({ phone, limit: query.limit ? Number(query.limit) : undefined });
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

async function listWhatsAppTemplatesRoute() {
  try {
    const data = await listWhatsAppTemplates();
    return json(200, { data });
  } catch (e) {
    return json(502, { error: e.message });
  }
}

// ── notifications.* ─────────────────────────────────────────────────────
async function listEmailTemplates(adminClient, query) {
  const { limit, offset } = paginationParams(query);
  let q = adminClient
    .from('email_templates')
    .select('id, name, type, subject, variables, is_active', { count: 'exact' })
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (query.type) q = q.eq('type', query.type);
  if (query.active === 'true') q = q.eq('is_active', true);

  const { data, error, count } = await q;
  if (error) return json(500, { error: error.message });
  return json(200, { data, count });
}

async function sendEmail(body, source) {
  if (!isPlainObject(body)) return json(400, { error: 'Invalid JSON body' });
  const templateName = String(body.template_name || '').trim();
  const to = String(body.to || '').trim();
  if (!templateName) return json(400, { error: 'template_name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json(400, { error: 'A valid "to" email address is required' });

  const data = isPlainObject(body.data) ? body.data : {};
  const orderId = body.order_id ? String(body.order_id) : null;

  const result = await sendTransactionalEmail({ templateName, to, data, orderId, source });
  if (result.sent) return json(200, { data: { sent: true } });
  if (result.reason === 'no_template') return json(400, { error: `Unknown template_name "${templateName}"` });
  if (result.reason === 'disabled') return json(503, { error: 'Email sending is currently disabled' });
  return json(200, { data: { sent: false, reason: result.reason } });
}

async function sendEmailBulk(body, source) {
  if (!isPlainObject(body)) return json(400, { error: 'Invalid JSON body' });
  const templateName = String(body.template_name || '').trim();
  if (!templateName) return json(400, { error: 'template_name is required' });
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (recipients.length === 0) return json(400, { error: 'recipients must be a non-empty array of { to, data? }' });
  if (recipients.length > RESEND_BATCH_LIMIT) {
    return json(400, { error: `recipients is capped at ${RESEND_BATCH_LIMIT} per request` });
  }
  const sharedData = isPlainObject(body.data) ? body.data : {};
  const result = await sendTransactionalEmailBulk({ templateName, recipients, data: sharedData, source });
  if (result.reason === 'no_template') return json(400, { error: `Unknown template_name "${templateName}"` });
  if (result.reason === 'disabled') return json(503, { error: 'Email sending is currently disabled' });
  return json(200, { data: result });
}

const PUSH_TYPES = new Set(['order_update', 'product', 'promotion', 'general']);

async function sendOrSchedulePush(adminClient, body, { allowedAudiences, apiKeyName }) {
  if (!isPlainObject(body)) return json(400, { error: 'Invalid JSON body' });

  const audience = String(body.audience || '');
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();
  const type = String(body.type || '').trim();

  if (!allowedAudiences.has(audience)) {
    return json(400, { error: `audience must be one of: ${[...allowedAudiences].join(', ')}` });
  }
  if (!PUSH_TYPES.has(type)) return json(400, { error: `type must be one of: ${[...PUSH_TYPES].join(', ')}` });
  if (!title) return json(400, { error: 'title is required' });
  if (!message) return json(400, { error: 'message is required' });

  const customerId = audience === 'single' ? String(body.customer_id || '').trim() : '';
  if (audience === 'single' && !customerId) return json(400, { error: 'customer_id is required for audience=single' });

  let segment;
  if (audience === 'segment') {
    const platform = body.segment?.platform ? String(body.segment.platform).toLowerCase() : '';
    if (!['android', 'web'].includes(platform)) return json(400, { error: 'segment.platform must be android or web' });
    segment = { platform };
  }

  const requestPayload = {
    audience, title, message, type,
    ...(isPlainObject(body.data) ? { data: body.data } : {}),
    ...(audience === 'single' ? { customerId } : {}),
    ...(audience === 'segment' ? { segment } : {}),
  };

  // Any valid schedule_at queues. Never fall through to an immediate send —
  // a too-soon or already-past timestamp used to do that silently (the old
  // 60s buffer), which made HITL-approved "send in 5 minutes" fires fire now.
  const scheduleAtRaw = body.schedule_at ?? body.scheduleAt ?? body.scheduled_at;
  const scheduleAt = scheduleAtRaw ? String(scheduleAtRaw).trim() : '';
  if (scheduleAt) {
    const scheduledAtMs = Date.parse(scheduleAt);
    if (Number.isNaN(scheduledAtMs)) {
      return json(400, { error: 'schedule_at must be a valid datetime string' });
    }
    const { data: queued, error } = await adminClient
      .from('scheduled_push_notifications')
      .insert({ schedule_at: new Date(scheduledAtMs).toISOString(), status: 'pending', payload: requestPayload })
      .select('id, schedule_at')
      .single();
    if (error) return json(500, { error: error.message });
    return json(202, { data: { scheduled: true, id: queued.id, schedule_at: queued.schedule_at } });
  }

  const pwaBaseUrl = process.env.PWA_BASE_URL;
  if (!pwaBaseUrl) return json(503, { error: 'Push notification service is not configured' });

  const result = await sendPushViaPwa({
    pwaBaseUrl,
    notificationsAdminSecret: process.env.NOTIFICATIONS_ADMIN_SECRET,
    payload: requestPayload,
  });

  logNotificationHistory(adminClient, {
    action: PUSH_HISTORY_ACTION,
    actorEmail: `service-api:${apiKeyName}`,
    request: requestPayload,
    response: result.body,
    success: !!result.body?.success,
    statusCode: result.statusCode,
    meta: result.body?.meta,
  }).catch(() => {});

  return json(result.statusCode, result.body);
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

    // --- gift ---
    if (segments[0] === 'gift-boxes') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'gift_boxes.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listGiftBoxes(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'gift_boxes.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getGiftBox(auth.adminClient, segments[1]);
      }
    }
    if (segments[0] === 'gift-orders') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'gift_orders.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listGiftOrders(auth.adminClient, query);
      }
      if (segments.length === 3 && segments[2] === 'events' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'gift_orders.events.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getGiftOrderEvents(auth.adminClient, segments[1]);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'gift_orders.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getGiftOrder(auth.adminClient, segments[1]);
      }
    }
    if (segments[0] === 'gift-fulfilment-centres' && segments.length === 1 && method === 'GET') {
      const auth = await authenticateServiceApiRequest(event, 'gift_fulfilment_centres.list');
      if (auth.errorResponse) return auth.errorResponse;
      return await listGiftFulfilmentCentres(auth.adminClient, query);
    }
    if (segments[0] === 'gift-packaging-types' && segments.length === 1 && method === 'GET') {
      const auth = await authenticateServiceApiRequest(event, 'gift_packaging_types.list');
      if (auth.errorResponse) return auth.errorResponse;
      return await listGiftPackagingTypes(auth.adminClient, query);
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

    // --- customers ---
    if (segments[0] === 'customers') {
      if (segments.length === 3 && segments[2] === 'orders' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'customers.orders.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getCustomerOrders(auth.adminClient, segments[1], query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'customers.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getCustomer(auth.adminClient, segments[1]);
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

    // --- returns ---
    if (segments[0] === 'returns') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'returns.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listReturns(auth.adminClient, query);
      }
      if (segments.length === 3 && segments[2] === 'shipments' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'returns.shipments.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getReturnShipments(auth.adminClient, segments[1]);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'returns.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getReturn(auth.adminClient, segments[1]);
      }
    }

    // --- influencers ---
    if (segments[0] === 'influencers') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'influencers.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listInfluencers(auth.adminClient, query);
      }
      if (segments.length === 3 && segments[2] === 'sales' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'influencers.sales.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getInfluencerSales(auth.adminClient, segments[1], query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'influencers.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getInfluencer(auth.adminClient, segments[1]);
      }
    }

    // --- custom orders ---
    if (segments[0] === 'custom-orders') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'custom_orders.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listCustomOrders(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'custom_orders.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getCustomOrder(auth.adminClient, segments[1]);
      }
    }

    // --- campaigns ---
    if (segments[0] === 'campaigns') {
      if (segments.length === 1 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'campaigns.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listCampaigns(auth.adminClient, query);
      }
      if (segments.length === 2 && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'campaigns.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await getCampaign(auth.adminClient, segments[1]);
      }
      if (segments.length === 1 && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'campaigns.giveaway.submit');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await submitGiveawayCampaign(auth.adminClient, body);
      }
    }

    // --- notifications ---
    if (segments[0] === 'notifications') {
      if (segments.length === 2 && segments[1] === 'email-templates' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'notifications.email_templates.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listEmailTemplates(auth.adminClient, query);
      }
      if (segments.length === 2 && segments[1] === 'email' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'notifications.email.send');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await sendEmail(body, auth.apiKey?.name || null);
      }
      if (segments.length === 3 && segments[1] === 'email' && segments[2] === 'bulk' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'notifications.email.send_bulk');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await sendEmailBulk(body, auth.apiKey?.name || null);
      }
      if (segments.length === 2 && segments[1] === 'push' && method === 'POST') {
        const body = JSON.parse(event.body || '{}');
        const requestedAudience = String(body?.audience || '');
        const isBulk = requestedAudience !== 'single';
        const auth = await authenticateServiceApiRequest(
          event,
          isBulk ? 'notifications.push.broadcast' : ['notifications.push.send', 'notifications.push.broadcast']
        );
        if (auth.errorResponse) return auth.errorResponse;
        const allowedAudiences = auth.apiKey.scopes.includes('notifications.push.broadcast')
          ? new Set(['single', 'all_customers', 'all_vendors', 'all_staff', 'segment'])
          : new Set(['single']);
        return await sendOrSchedulePush(auth.adminClient, body, { allowedAudiences, apiKeyName: auth.apiKey.name });
      }
    }

    // --- meta (ads + organic social) ---
    if (segments[0] === 'meta' && segments[1] === 'ads') {
      if (segments.length === 3 && segments[2] === 'campaigns' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.campaigns.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaAdsHandler(getMetaCampaigns);
      }
      if (segments.length === 4 && segments[2] === 'campaigns' && segments[3] === 'sync' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.campaigns.sync');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaAdsHandler(syncMetaCampaigns, null);
      }
      if (segments.length === 5 && segments[2] === 'campaigns' && segments[4] === 'status' && method === 'PUT') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.campaigns.status.update');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await callMetaAdsHandler(updateMetaCampaignStatus, segments[3], body.status, null);
      }
      if (segments.length === 5 && segments[2] === 'campaigns' && segments[4] === 'budget' && method === 'PUT') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.campaigns.budget.update');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await callMetaAdsHandler(updateMetaCampaignBudget, segments[3], body.daily_budget, null);
      }
      if (segments.length === 3 && segments[2] === 'drafts' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.drafts.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaAdsHandler(getMetaDrafts, query.status);
      }
      if (segments.length === 3 && segments[2] === 'drafts' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.drafts.create');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await callMetaAdsHandler(createMetaDraft, body, null);
      }
      if (segments.length === 5 && segments[2] === 'drafts' && segments[4] === 'approve' && method === 'PUT') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.drafts.approve');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaAdsHandler(approveMetaDraft, segments[3], null);
      }
      if (segments.length === 5 && segments[2] === 'drafts' && segments[4] === 'publish' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.drafts.publish');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await callMetaAdsHandler(publishMetaDraft, segments[3], body, null);
      }
      if (segments.length === 3 && segments[2] === 'account' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.account.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaAdsHandler(getMetaAccountInfo);
      }
      if (segments.length === 3 && segments[2] === 'recommendations' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.ads.recommendations.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaAdsHandler(getMetaRecommendations);
      }
    }
    if (segments[0] === 'meta' && segments[1] === 'social') {
      if (segments.length === 4 && segments[2] === 'facebook' && segments[3] === 'post' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.facebook.post');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await postFacebookPage(body);
      }
      if (segments.length === 4 && segments[2] === 'instagram' && segments[3] === 'post' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.instagram.post');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await postInstagramImage(body);
      }
      if (segments.length === 4 && segments[2] === 'facebook' && segments[3] === 'page' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.page.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaSocialRead(getFacebookPageProfile);
      }
      if (segments.length === 4 && segments[2] === 'facebook' && segments[3] === 'posts' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.page.posts.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaSocialRead(listFacebookPagePosts, { limit: query.limit });
      }
      if (segments.length === 4 && segments[2] === 'facebook' && segments[3] === 'insights' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.page.insights.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaSocialRead(getFacebookPageInsights, insightsQueryArgs(query));
      }
      if (segments.length === 4 && segments[2] === 'instagram' && segments[3] === 'account' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.instagram.account.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaSocialRead(getInstagramProfile);
      }
      if (segments.length === 4 && segments[2] === 'instagram' && segments[3] === 'media' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.instagram.media.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaSocialRead(listInstagramMedia, { limit: query.limit });
      }
      if (segments.length === 4 && segments[2] === 'instagram' && segments[3] === 'insights' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'meta.social.instagram.insights.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await callMetaSocialRead(getInstagramInsights, insightsQueryArgs(query));
      }
    }

    // --- whatsapp.* (internal outreach) ---
    if (segments[0] === 'whatsapp') {
      if (segments.length === 2 && segments[1] === 'threads' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'whatsapp.threads.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listWhatsAppThreadsRoute(query);
      }
      if (segments.length === 2 && segments[1] === 'thread' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'whatsapp.thread.read');
        if (auth.errorResponse) return auth.errorResponse;
        return await readWhatsAppThreadRoute(query);
      }
      if (segments.length === 2 && segments[1] === 'templates' && method === 'GET') {
        const auth = await authenticateServiceApiRequest(event, 'whatsapp.templates.list');
        if (auth.errorResponse) return auth.errorResponse;
        return await listWhatsAppTemplatesRoute();
      }
      if (segments.length === 2 && segments[1] === 'message' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'whatsapp.message.send');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await sendWhatsAppMessageRoute(body);
      }
      if (segments.length === 2 && segments[1] === 'template' && method === 'POST') {
        const auth = await authenticateServiceApiRequest(event, 'whatsapp.template.send');
        if (auth.errorResponse) return auth.errorResponse;
        const body = JSON.parse(event.body || '{}');
        return await sendWhatsAppTemplateRoute(body);
      }
    }

    return json(404, { error: `No route for ${method} /api/v1/${path}` });
  } catch (err) {
    if (err instanceof SyntaxError) return json(400, { error: 'Invalid JSON body' });
    console.error('[public-api] unhandled error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
