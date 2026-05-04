/**
 * Courier Settlements API
 *
 * GET  /api/settlements/pending          → list couriers with unsettled delivered sub-orders
 * GET  /api/settlements                  → settlement history
 * POST /api/settlements                  → create a new settlement batch for a courier
 * PUT  /api/settlements/:id/mark-paid    → mark a settlement as paid + record expense
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

function json(statusCode, body) {
  return { statusCode, headers: corsHeaders, body: JSON.stringify(body) };
}

// Parse path: /api/settlements, /api/settlements/pending, /api/settlements/:id/mark-paid
function parsePath(path) {
  const parts = path.split('/').filter(Boolean);
  const base  = parts.findIndex((p) => p === 'settlements');
  const after  = parts.slice(base + 1); // e.g. ['pending'] or [':id', 'mark-paid'] or []
  return { sub: after[0] || null, action: after[1] || null };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(503, { success: false, error: 'Database not configured' });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { sub, action } = parsePath(event.path);

  try {

    // ─── GET /api/settlements/pending ────────────────────────────────────────
    if (event.httpMethod === 'GET' && sub === 'pending') {
      // Use the view (fixed to use settlement_status, not allocated_shipping_fee)
      const { data, error } = await db
        .from('pending_courier_payments')
        .select('*')
        .order('total_amount_due', { ascending: false });

      if (error) throw error;

      // Enrich each entry with oldest/newest delivery dates from sub_orders
      const enriched = await Promise.all((data || []).map(async (row) => {
        const { data: dates } = await db
          .from('sub_orders')
          .select('delivered_at, created_at')
          .eq('courier_id', row.courier_id)
          .eq('status', 'delivered')
          .not('settlement_status', 'in', '("paid","approved")')
          .order('delivered_at', { ascending: true });

        const timestamps = (dates || []).map((d) => d.delivered_at || d.created_at).filter(Boolean);
        return {
          ...row,
          approved_amount: 0, // approval step not implemented yet — defaults to 0
          oldest_shipment: timestamps[0] || null,
          newest_shipment: timestamps[timestamps.length - 1] || null,
        };
      }));

      return json(200, { success: true, data: enriched });
    }

    // ─── GET /api/settlements ─────────────────────────────────────────────────
    if (event.httpMethod === 'GET' && !sub) {
      const { data, error } = await db
        .from('courier_settlement_summary')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      return json(200, { success: true, data: data || [] });
    }

    // ─── POST /api/settlements/pay-delivery ──────────────────────────────────
    // Quick-pay a single delivery (individual local rider — no batch needed)
    if (event.httpMethod === 'POST' && sub === 'pay-delivery') {
      const body = JSON.parse(event.body || '{}');
      const { sub_order_id, amount, paid_to, payment_reference, payment_method, payment_date, notes } = body;

      if (!sub_order_id || !payment_reference) {
        return json(400, { success: false, error: 'sub_order_id and payment_reference are required' });
      }

      // Fetch the sub_order
      const { data: subOrder, error: soErr } = await db
        .from('sub_orders')
        .select('id, courier_id, real_shipping_cost, allocated_shipping_fee, courier_charge, delivered_at, main_order_id, settlement_status')
        .eq('id', sub_order_id)
        .single();

      if (soErr || !subOrder) return json(404, { success: false, error: 'Sub-order not found' });
      if (['paid', 'settled'].includes(subOrder.settlement_status)) {
        return json(400, { success: false, error: 'This delivery has already been settled' });
      }

      const amountPaid = amount != null
        ? Number(amount)
        : Number(subOrder.real_shipping_cost ?? subOrder.allocated_shipping_fee ?? subOrder.courier_charge ?? 0);

      const paidAt      = payment_date ? new Date(payment_date).toISOString() : new Date().toISOString();
      const deliveryDay = subOrder.delivered_at
        ? subOrder.delivered_at.split('T')[0]
        : new Date().toISOString().split('T')[0];

      // Create settlement record (already paid)
      const { data: settlement, error: settlErr } = await db
        .from('courier_settlements')
        .insert({
          courier_id:              subOrder.courier_id,
          settlement_period_start: deliveryDay,
          settlement_period_end:   deliveryDay,
          total_shipments:         1,
          total_amount_due:        amountPaid,
          total_amount_paid:       amountPaid,
          status:                  'paid',
          payment_reference,
          payment_method:          payment_method || 'cash',
          payment_date:            paidAt,
          paid_at:                 paidAt,
          notes: paid_to
            ? `Rider: ${paid_to}${notes ? ` — ${notes}` : ''}`
            : (notes || null),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (settlErr) throw settlErr;

      // Link the delivery to the settlement
      await db.from('settlement_items').insert({
        settlement_id: settlement.id,
        sub_order_id,
        amount:        amountPaid,
        created_at:    new Date().toISOString(),
      });

      // Mark sub_order as paid immediately
      await db.from('sub_orders').update({
        settlement_status: 'paid',
        settlement_date:   paidAt,
        payment_reference,
        updated_at:        new Date().toISOString(),
      }).eq('id', sub_order_id);

      // Record as ledger expense with rider name in paid_to
      await db.from('ledger_expenses').insert({
        source:           'courier_settlement',
        source_reference: settlement.id,
        category:         'courier',
        subcategory:      'delivery_fees',
        amount:           amountPaid,
        currency:         'NGN',
        tax_deductible:   true,
        vat_amount:       0,
        payment_method:   payment_method || 'cash',
        payment_reference,
        paid_to:          paid_to || 'Local Rider',
        paid_at:          paidAt,
        description:      `Local rider payment — ${paid_to || 'Rider'} (1 delivery, order ${subOrder.main_order_id?.slice(0, 8)})`,
        metadata: {
          settlement_id: settlement.id,
          courier_id:    subOrder.courier_id,
          sub_order_id,
          paid_to:       paid_to || null,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return json(201, {
        success: true,
        message: 'Delivery paid and expense recorded',
        data:    { settlement_id: settlement.id, amount_paid: amountPaid },
      });
    }

    // ─── POST /api/settlements ────────────────────────────────────────────────
    // Create a settlement batch for a courier over a date range
    if (event.httpMethod === 'POST' && !sub) {
      const body = JSON.parse(event.body || '{}');
      const { courier_id, start_date, end_date, notes } = body;

      if (!courier_id || !start_date || !end_date) {
        return json(400, { success: false, error: 'courier_id, start_date and end_date are required' });
      }

      // Find all unsettled delivered sub_orders for this courier in the period.
      // delivered_at may be NULL on older orders — fall back to created_at for those.
      const { data: subOrders, error: soErr } = await db
        .from('sub_orders')
        .select('id, real_shipping_cost, allocated_shipping_fee, courier_charge, delivered_at, created_at, main_order_id')
        .eq('courier_id', courier_id)
        .eq('status', 'delivered')
        .not('settlement_status', 'in', '("paid","approved")')
        .or(
          `delivered_at.is.null,` +
          `and(delivered_at.gte.${start_date}T00:00:00,delivered_at.lte.${end_date}T23:59:59)`
        );

      if (soErr) throw soErr;

      if (!subOrders || subOrders.length === 0) {
        return json(400, { success: false, error: 'No unsettled deliveries found for this courier in the selected period' });
      }

      const totalDue = subOrders.reduce((sum, so) =>
        sum + Number(so.real_shipping_cost ?? so.allocated_shipping_fee ?? so.courier_charge ?? 0), 0);

      // Create the settlement record
      const { data: settlement, error: settlErr } = await db
        .from('courier_settlements')
        .insert({
          courier_id,
          settlement_period_start: start_date,
          settlement_period_end:   end_date,
          total_shipments:  subOrders.length,
          total_amount_due: totalDue,
          total_amount_paid: 0,
          status: 'pending',
          notes: notes || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (settlErr) throw settlErr;

      // Create settlement_items linking each sub_order
      const items = subOrders.map((so) => ({
        settlement_id: settlement.id,
        sub_order_id:  so.id,
        amount: Number(so.real_shipping_cost ?? so.allocated_shipping_fee ?? so.courier_charge ?? 0),
        created_at: new Date().toISOString(),
      }));

      const { error: itemsErr } = await db.from('settlement_items').insert(items);
      if (itemsErr) throw itemsErr;

      // Mark sub_orders as 'approved' (batched, awaiting payment)
      const { error: updateErr } = await db
        .from('sub_orders')
        .update({ settlement_status: 'approved', updated_at: new Date().toISOString() })
        .in('id', subOrders.map((s) => s.id));

      if (updateErr) throw updateErr;

      return json(201, { success: true, data: { settlement_id: settlement.id, total_shipments: subOrders.length, total_amount_due: totalDue } });
    }

    // ─── PUT /api/settlements/:id/mark-paid ───────────────────────────────────
    if (event.httpMethod === 'PUT' && action === 'mark-paid') {
      const settlementId = sub;
      if (!settlementId) return json(400, { success: false, error: 'Settlement ID required' });

      const body = JSON.parse(event.body || '{}');
      const { payment_reference, payment_method, payment_date, notes, actual_amount_paid } = body;

      if (!payment_reference) {
        return json(400, { success: false, error: 'payment_reference is required' });
      }

      // Fetch settlement to get amount + courier
      const { data: settlement, error: fetchErr } = await db
        .from('courier_settlements')
        .select('id, courier_id, total_amount_due, status')
        .eq('id', settlementId)
        .single();

      if (fetchErr || !settlement) return json(404, { success: false, error: 'Settlement not found' });
      if (settlement.status === 'paid') return json(400, { success: false, error: 'Settlement already paid' });

      const paidAt = payment_date
        ? new Date(payment_date).toISOString()
        : new Date().toISOString();

      // Use actual_amount_paid if provided (e.g. negotiated rate differs from billed amount),
      // otherwise fall back to the originally computed total_amount_due
      const amountPaid = actual_amount_paid != null
        ? Number(actual_amount_paid)
        : settlement.total_amount_due;

      // Mark settlement as paid
      const { error: updateErr } = await db
        .from('courier_settlements')
        .update({
          status:            'paid',
          total_amount_paid: amountPaid,
          payment_reference,
          payment_method:    payment_method || 'bank_transfer',
          payment_date:      paidAt,
          paid_at:           paidAt,
          notes:             notes || null,
          updated_at:        new Date().toISOString(),
        })
        .eq('id', settlementId);

      if (updateErr) throw updateErr;

      // Mark linked sub_orders as paid
      const { data: items } = await db
        .from('settlement_items')
        .select('sub_order_id')
        .eq('settlement_id', settlementId);

      if (items && items.length > 0) {
        await db
          .from('sub_orders')
          .update({ settlement_status: 'paid', settlement_date: paidAt, payment_reference, updated_at: new Date().toISOString() })
          .in('id', items.map((i) => i.sub_order_id));
      }

      // Fetch courier name for expense record
      const { data: courier } = await db
        .from('couriers')
        .select('name')
        .eq('id', settlement.courier_id)
        .single();

      // Record as ledger expense — use actual amount paid, not billed amount
      await db.from('ledger_expenses').insert({
        source:           'courier_settlement',
        source_reference: settlementId,
        category:         'courier',
        subcategory:      'delivery_fees',
        amount:           amountPaid,
        currency:         'NGN',
        tax_deductible:   true,
        vat_amount:       0,
        payment_method:   payment_method || 'bank_transfer',
        payment_reference,
        paid_to:          courier?.name || 'Courier',
        paid_at:          paidAt,
        description:      `Courier payment — ${courier?.name || 'Courier'} (${(items || []).length} deliveries)`,
        metadata: {
          settlement_id:    settlementId,
          courier_id:       settlement.courier_id,
          amount_due:       settlement.total_amount_due,
          amount_paid:      amountPaid,
          shipping_saving:  settlement.total_amount_due - amountPaid,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return json(200, {
        success: true,
        message: 'Settlement marked as paid and expense recorded',
        data: {
          amount_due:      settlement.total_amount_due,
          amount_paid:     amountPaid,
          shipping_saving: settlement.total_amount_due - amountPaid,
        },
      });
    }

    return json(405, { success: false, error: 'Method not allowed' });

  } catch (err) {
    console.error('Settlements error:', err);
    return json(500, { success: false, error: err.message || 'Internal server error' });
  }
}
