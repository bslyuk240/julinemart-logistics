/**
 * GET  /api/vendor-product-customisation?product_id=<uuid>
 * PUT  /api/vendor-product-customisation?product_id=<uuid>
 * DELETE /api/vendor-product-customisation?product_id=<uuid>
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';
import { recordAudit, requestMeta } from './services/auditLog.js';
import { sanitizeFieldDefinitions } from './services/custom-order-utils.js';

const ALLOWED_VERTICALS = new Set(['bakers', 'printers', 'tailors']);

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const method = event.httpMethod;
  if (!['GET', 'PUT', 'DELETE'].includes(method)) {
    return {
      statusCode: 405,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const { vendor, userId, error } = await authenticateVendor(event);
  if (error) {
    return {
      statusCode: 401,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error }),
    };
  }

  const productId = event.queryStringParameters?.product_id;
  if (!productId) {
    return {
      statusCode: 400,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'product_id required' }),
    };
  }

  const adminClient = getAdminClient();

  const { data: product } = await adminClient
    .from('products')
    .select('id, vendor_id, name')
    .eq('id', productId)
    .maybeSingle();

  if (!product || product.vendor_id !== vendor.id) {
    return {
      statusCode: 403,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Not your product' }),
    };
  }

  if (method === 'GET') {
    const { data, error: fetchErr } = await adminClient
      .from('product_customisation_schemas')
      .select('*')
      .eq('product_id', productId)
      .maybeSingle();

    if (fetchErr) {
      return {
        statusCode: 500,
        headers: corsHeaders(origin),
        body: JSON.stringify({ success: false, error: fetchErr.message }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true, data: data || null }),
    };
  }

  if (method === 'DELETE') {
    await adminClient.from('product_customisation_schemas').delete().eq('product_id', productId);
    await recordAudit({
      action: 'CUSTOMISATION_SCHEMA_DELETED',
      resource_type: 'product_customisation_schemas',
      resource_id: productId,
      user_id: userId,
      actor_email: vendor.email,
      source: 'vendor_portal',
      details: { product_id: productId, product_name: product.name },
      ...requestMeta(event),
    });
    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true }),
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

  const fields = sanitizeFieldDefinitions(body.fields);
  if (fields.length === 0) {
    await adminClient.from('product_customisation_schemas').delete().eq('product_id', productId);
    await recordAudit({
      action: 'CUSTOMISATION_SCHEMA_DELETED',
      resource_type: 'product_customisation_schemas',
      resource_id: productId,
      user_id: userId,
      actor_email: vendor.email,
      source: 'vendor_portal',
      details: { product_id: productId, product_name: product.name, reason: 'no_fields' },
      ...requestMeta(event),
    });
    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: true, data: null, message: 'Customisation removed — no fields configured' }),
    };
  }

  const pilotVertical =
    body.pilot_vertical && ALLOWED_VERTICALS.has(body.pilot_vertical) ? body.pilot_vertical : null;

  const row = {
    product_id: productId,
    vendor_id: vendor.id,
    pilot_vertical: pilotVertical,
    requires_approval: body.requires_approval !== false,
    production_days_min: body.production_days_min != null ? Number(body.production_days_min) : null,
    production_days_max: body.production_days_max != null ? Number(body.production_days_max) : null,
    fields,
    updated_at: new Date().toISOString(),
  };

  const { data, error: upsertErr } = await adminClient
    .from('product_customisation_schemas')
    .upsert(row, { onConflict: 'product_id' })
    .select('*')
    .single();

  if (upsertErr) {
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: upsertErr.message }),
    };
  }

  await recordAudit({
    action: 'CUSTOMISATION_SCHEMA_SAVED',
    resource_type: 'product_customisation_schemas',
    resource_id: data?.id,
    user_id: userId,
    actor_email: vendor.email,
    source: 'vendor_portal',
    details: {
      product_id: productId,
      product_name: product.name,
      field_count: fields.length,
      pilot_vertical: pilotVertical,
    },
    ...requestMeta(event),
  });

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({ success: true, data }),
  };
}
