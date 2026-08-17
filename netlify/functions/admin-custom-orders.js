/**
 * Admin oversight for marketplace custom orders (Trusted Local Commerce Phase 4).
 * Read-only visibility + force-cancel + admin messaging into the vendor/customer thread.
 * This is the only admin-facing surface for custom_order_specs — the vendor<->customer
 * flow (schema setup, ordering, proofing, approval, production) has no other admin touchpoint.
 *
 * GET   /api/admin-custom-orders                — list, optional ?status=
 * GET   /api/admin-custom-orders?id=<uuid>       — one spec + full message thread
 * PATCH /api/admin-custom-orders?id=<uuid>       — { action: 'cancel' | 'set_status', status?, note? }
 * POST  /api/admin-custom-orders?id=<uuid>       — { message } — admin message into the thread
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';

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

const LIST_SELECT = `
  id, order_id, order_item_id, schema_id, field_values, price_adjustment,
  status, approved_proof_url, approved_at, created_at, updated_at,
  orders ( id, order_number, customer_name, customer_email, overall_status, created_at ),
  order_items ( id, product_name, quantity, unit_price, vendor_id, vendors ( id, store_name ) )
`;

async function messageCount(specIds) {
  if (!specIds.length) return new Map();
  const { data } = await adminClient
    .from('custom_order_messages')
    .select('custom_order_spec_id')
    .in('custom_order_spec_id', specIds);
  const counts = new Map();
  for (const row of data || []) {
    counts.set(row.custom_order_spec_id, (counts.get(row.custom_order_spec_id) || 0) + 1);
  }
  return counts;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager', 'staff']);
  if (auth.errorResponse) return auth.errorResponse;

  const qs = event.queryStringParameters || {};
  const specId = qs.id;

  if (event.httpMethod === 'GET') {
    if (specId) {
      const { data: spec, error } = await adminClient
        .from('custom_order_specs')
        .select(`${LIST_SELECT}, product_customisation_schemas ( id, fields, pilot_vertical, requires_approval )`)
        .eq('id', specId)
        .maybeSingle();

      if (error) return jsonResponse(500, { success: false, error: error.message });
      if (!spec) return jsonResponse(404, { success: false, error: 'Custom order not found' });

      const { data: messages, error: msgErr } = await adminClient
        .from('custom_order_messages')
        .select('*')
        .eq('custom_order_spec_id', specId)
        .order('created_at', { ascending: true });

      if (msgErr) return jsonResponse(500, { success: false, error: msgErr.message });

      return jsonResponse(200, { success: true, data: { ...spec, messages: messages || [] } });
    }

    const status = (qs.status || '').toLowerCase();
    let query = adminClient
      .from('custom_order_specs')
      .select(LIST_SELECT)
      .order('created_at', { ascending: false })
      .limit(200);

    if (status && STATUS_FLOW.has(status)) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return jsonResponse(500, { success: false, error: error.message });

    const specs = data || [];
    const counts = await messageCount(specs.map((s) => s.id));
    const enriched = specs.map((s) => ({ ...s, message_count: counts.get(s.id) || 0 }));

    return jsonResponse(200, { success: true, data: enriched });
  }

  if (!specId) return jsonResponse(400, { success: false, error: 'id required' });

  const { data: spec, error: loadErr } = await adminClient
    .from('custom_order_specs')
    .select('id, status')
    .eq('id', specId)
    .maybeSingle();

  if (loadErr) return jsonResponse(500, { success: false, error: loadErr.message });
  if (!spec) return jsonResponse(404, { success: false, error: 'Custom order not found' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  if (event.httpMethod === 'PATCH') {
    const action = body.action;
    let nextStatus;

    if (action === 'cancel') {
      nextStatus = 'cancelled';
    } else if (action === 'set_status') {
      if (!body.status || !STATUS_FLOW.has(body.status)) {
        return jsonResponse(400, { success: false, error: 'Invalid status' });
      }
      nextStatus = body.status;
    } else {
      return jsonResponse(400, { success: false, error: 'Unknown action' });
    }

    const { data, error } = await adminClient
      .from('custom_order_specs')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', specId)
      .select('*')
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });

    const note = body.note ? String(body.note).trim().slice(0, 4000) : null;
    if (note) {
      await adminClient.from('custom_order_messages').insert({
        custom_order_spec_id: specId,
        sender_type: 'admin',
        message: note,
        attachments: [],
      });
    }

    return jsonResponse(200, { success: true, data });
  }

  if (event.httpMethod === 'POST') {
    const message = String(body.message || '').trim();
    if (!message) return jsonResponse(400, { success: false, error: 'message required' });

    const { data, error } = await adminClient
      .from('custom_order_messages')
      .insert({
        custom_order_spec_id: specId,
        sender_type: 'admin',
        message: message.slice(0, 4000),
        attachments: [],
      })
      .select('*')
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
