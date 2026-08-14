/**
 * GET  /api/vendor-custom-orders — list custom specs for vendor
 * PATCH /api/vendor-custom-orders — update status or send proof
 * POST /api/vendor-custom-orders — add vendor message
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';

const STATUS_FLOW = new Set([
  'submitted',
  'seller_reviewing',
  'seller_confirmed',
  'proof_sent',
  'customer_approved',
  'in_production',
  'quality_check',
  'ready',
  'dispatched',
  'delivered',
  'cancelled',
]);

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const { vendor, error } = await authenticateVendor(event);
  if (error) {
    return {
      statusCode: 401,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error }),
    };
  }

  const adminClient = getAdminClient();

  if (event.httpMethod === 'GET') {
    const status = event.queryStringParameters?.status;

    const { data: vendorItems } = await adminClient
      .from('order_items')
      .select('id')
      .eq('vendor_id', vendor.id);

    const itemIds = (vendorItems || []).map((r) => r.id);
    if (!itemIds.length) {
      return {
        statusCode: 200,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: true, data: [] }),
      };
    }

    let specQuery = adminClient
      .from('custom_order_specs')
      .select(`
        id, order_id, order_item_id, schema_id, field_values, price_adjustment,
        status, approved_proof_url, approved_at, created_at, updated_at,
        orders ( id, order_number, customer_name, customer_email, overall_status, created_at ),
        order_items ( id, product_name, quantity, unit_price, vendor_id )
      `)
      .in('order_item_id', itemIds)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status && STATUS_FLOW.has(status)) {
      specQuery = specQuery.eq('status', status);
    }

    const { data, error: listErr } = await specQuery;
    if (listErr) {
      return {
        statusCode: 500,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: listErr.message }),
      };
    }

    const filtered = (data || []).filter(
      (row) => row.order_items?.vendor_id === vendor.id || !row.order_items
    );

    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true, data: filtered }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Invalid JSON' }),
    };
  }

  const specId = body.spec_id || event.queryStringParameters?.spec_id;
  if (!specId) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'spec_id required' }),
    };
  }

  const { data: spec } = await adminClient
    .from('custom_order_specs')
    .select('id, order_item_id, schema_id, status')
    .eq('id', specId)
    .maybeSingle();

  if (!spec) {
    return {
      statusCode: 404,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Custom order not found' }),
    };
  }

  let ownsSpec = false;
  if (spec.order_item_id) {
    const { data: item } = await adminClient
      .from('order_items')
      .select('vendor_id')
      .eq('id', spec.order_item_id)
      .maybeSingle();
    ownsSpec = item?.vendor_id === vendor.id;
  } else if (spec.schema_id) {
    const { data: schema } = await adminClient
      .from('product_customisation_schemas')
      .select('vendor_id')
      .eq('id', spec.schema_id)
      .maybeSingle();
    ownsSpec = schema?.vendor_id === vendor.id;
  }

  if (!ownsSpec) {
    return {
      statusCode: 403,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Not your custom order' }),
    };
  }

  if (event.httpMethod === 'PATCH') {
    const patch = { updated_at: new Date().toISOString() };
    if (body.status && STATUS_FLOW.has(body.status)) patch.status = body.status;
    if (body.approved_proof_url) {
      patch.approved_proof_url = String(body.approved_proof_url).slice(0, 2000);
      if (body.status === 'proof_sent' || !body.status) patch.status = 'proof_sent';
    }

    const { data, error: patchErr } = await adminClient
      .from('custom_order_specs')
      .update(patch)
      .eq('id', specId)
      .select('*')
      .single();

    if (patchErr) {
      return {
        statusCode: 500,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: patchErr.message }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true, data }),
    };
  }

  if (event.httpMethod === 'POST') {
    const message = String(body.message || '').trim();
    if (!message) {
      return {
        statusCode: 400,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: 'message required' }),
      };
    }

    const { data: msg, error: msgErr } = await adminClient
      .from('custom_order_messages')
      .insert({
        custom_order_spec_id: specId,
        sender_type: 'vendor',
        message: message.slice(0, 4000),
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
      })
      .select('*')
      .single();

    if (msgErr) {
      return {
        statusCode: 500,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: msgErr.message }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true, data: msg }),
    };
  }

  return {
    statusCode: 405,
    headers: corsHeaders(origin),
    body: JSON.stringify({ success: false, error: 'Method not allowed' }),
  };
}
