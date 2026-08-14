/**
 * Admin gift ops queue — New → Packing → Dispatch → Done
 *
 * GET  /api/admin-gift-ops?tab=new|packing|dispatch|done&gfc_id=<uuid>
 * GET  /api/admin-gift-ops?id=<gift_order_uuid>
 * PATCH /api/admin-gift-ops?id=<gift_order_uuid>
 */
import { requireAdmin, adminClient, jsonResponse, headers } from './services/global-sourcing-utils.js';

const TAB_STATUSES = {
  new: ['new', 'paid'],
  packing: ['packing', 'packed'],
  dispatch: ['dispatch'],
  done: ['delivered'],
};

const GIFT_SELECT = `
  id, order_id, gift_box_id, gift_fulfilment_centre_id, order_kind,
  recipient_name, recipient_phone, recipient_email,
  recipient_address, recipient_city, recipient_state, recipient_zone,
  gift_message, sender_visible, occasion,
  component_cost_total, gift_status,
  pack_photo_url, qc_notes, packed_at, dispatched_at, completed_at,
  created_at, updated_at,
  gift_boxes ( id, name, slug, list_price ),
  gift_fulfilment_centres ( id, name, code, city ),
  orders!inner (
    id, order_number, customer_name, customer_email, customer_phone,
    total_amount, payment_status, overall_status, payment_reference, created_at, order_kind
  )
`;

async function recordEvent(giftOrderId, status, note, actorEmail) {
  await adminClient.from('gift_order_events').insert({
    gift_order_id: giftOrderId,
    status,
    note: note || null,
    actor_email: actorEmail || null,
  });
}

async function loadDetail(giftOrderId) {
  const { data, error } = await adminClient
    .from('gift_orders')
    .select(GIFT_SELECT)
    .eq('id', giftOrderId)
    .maybeSingle();

  if (error) return { error };

  const { data: events } = await adminClient
    .from('gift_order_events')
    .select('id, status, note, actor_email, created_at')
    .eq('gift_order_id', giftOrderId)
    .order('created_at', { ascending: true });

  const orderId = data?.order_id;
  let packingChecklist = [];
  if (orderId) {
    const { data: subOrders } = await adminClient
      .from('sub_orders')
      .select('id, metadata, items')
      .eq('main_order_id', orderId)
      .limit(1);
    const meta = subOrders?.[0]?.metadata;
    packingChecklist = meta?.packing_checklist || [];
  }

  return { data: { ...data, events: events || [], packing_checklist: packingChecklist } };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, ['admin', 'manager', 'staff']);
  if (auth.errorResponse) return auth.errorResponse;

  const qs = event.queryStringParameters || {};
  const giftOrderId = qs.id;
  const actorEmail = auth.user?.email || null;

  if (event.httpMethod === 'GET') {
    if (giftOrderId) {
      const result = await loadDetail(giftOrderId);
      if (result.error) return jsonResponse(500, { success: false, error: result.error.message });
      if (!result.data) return jsonResponse(404, { success: false, error: 'Gift order not found' });
      return jsonResponse(200, { success: true, data: result.data });
    }

    const tab = (qs.tab || 'new').toLowerCase();
    const statuses = TAB_STATUSES[tab] || TAB_STATUSES.new;
    const gfcId = qs.gfc_id;

    let query = adminClient
      .from('gift_orders')
      .select(GIFT_SELECT)
      .in('gift_status', statuses)
      .order('created_at', { ascending: false })
      .limit(100);

    if (gfcId) query = query.eq('gift_fulfilment_centre_id', gfcId);

    const { data, error } = await query;
    if (error) return jsonResponse(500, { success: false, error: error.message });
    return jsonResponse(200, { success: true, data: data || [], tab });
  }

  if (event.httpMethod === 'PATCH') {
    if (!giftOrderId) return jsonResponse(400, { success: false, error: 'id required' });

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    const action = body.action;
    const now = new Date().toISOString();

    const { data: existing, error: loadErr } = await adminClient
      .from('gift_orders')
      .select('id, gift_status, order_id')
      .eq('id', giftOrderId)
      .maybeSingle();

    if (loadErr) return jsonResponse(500, { success: false, error: loadErr.message });
    if (!existing) return jsonResponse(404, { success: false, error: 'Gift order not found' });

    const patch = { updated_at: now };
    let newStatus = existing.gift_status;
    let eventNote = body.note || null;

    switch (action) {
      case 'start_packing':
        newStatus = 'packing';
        break;
      case 'mark_packed':
        newStatus = 'packed';
        patch.packed_at = now;
        if (body.pack_photo_url !== undefined) patch.pack_photo_url = body.pack_photo_url || null;
        if (body.qc_notes !== undefined) patch.qc_notes = body.qc_notes || null;
        break;
      case 'dispatch':
        newStatus = 'dispatch';
        patch.dispatched_at = now;
        break;
      case 'complete':
        newStatus = 'delivered';
        patch.completed_at = now;
        break;
      default:
        return jsonResponse(400, { success: false, error: 'Invalid action' });
    }

    patch.gift_status = newStatus;

    const { error: updErr } = await adminClient
      .from('gift_orders')
      .update(patch)
      .eq('id', giftOrderId);

    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });

    await recordEvent(giftOrderId, newStatus, eventNote, actorEmail);

    if (newStatus === 'delivered' && existing.order_id) {
      await adminClient
        .from('orders')
        .update({ overall_status: 'delivered', updated_at: now })
        .eq('id', existing.order_id);
    }

    const result = await loadDetail(giftOrderId);
    return jsonResponse(200, { success: true, data: result.data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
