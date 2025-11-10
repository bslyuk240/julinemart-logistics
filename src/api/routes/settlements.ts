import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import type { AuthRequest } from '../middleware/auth.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Get pending payments (what we owe couriers)
export async function getPendingPaymentsHandler(req: AuthRequest, res: Response) {
  try {
    // Prefer view when available
    const { data, error } = await supabase
      .from('pending_courier_payments')
      .select('*');

    if (!error) {
      return res.status(200).json({ success: true, data: data || [] });
    }

    // Fallback if view is missing: compute from base tables
    const { data: couriers } = await supabase.from('couriers').select('id, name, code');
    const { data: shipments } = await supabase
      .from('sub_orders')
      .select('id, courier_id, settlement_status, status, shipping_cost, created_at');

    const grouped: any[] = [];
    const map = new Map<string, any>();
    (shipments || [])
      .filter(s => ['pending', 'approved'].includes((s as any).settlement_status) && ['delivered', 'in_transit'].includes((s as any).status))
      .forEach(s => {
        const key = (s as any).courier_id;
        if (!key) return;
        if (!map.has(key)) {
          const c = (couriers || []).find(c => (c as any).id === key) as any;
          map.set(key, {
            courier_id: key,
            courier_name: c?.name || 'Unknown',
            courier_code: c?.code || '',
            pending_shipments: 0,
            total_amount_due: 0,
            approved_amount: 0,
            oldest_shipment: null as any,
            newest_shipment: null as any,
          });
        }
        const g = map.get(key);
        g.pending_shipments += 1;
        g.total_amount_due += Number((s as any).shipping_cost || 0);
        if ((s as any).settlement_status === 'approved') {
          g.approved_amount += Number((s as any).shipping_cost || 0);
        }
        const ts = new Date((s as any).created_at).getTime();
        g.oldest_shipment = g.oldest_shipment ? (ts < new Date(g.oldest_shipment).getTime() ? (s as any).created_at : g.oldest_shipment) : (s as any).created_at;
        g.newest_shipment = g.newest_shipment ? (ts > new Date(g.newest_shipment).getTime() ? (s as any).created_at : g.newest_shipment) : (s as any).created_at;
      });
    map.forEach(v => grouped.push(v));
    grouped.sort((a, b) => b.total_amount_due - a.total_amount_due);

    return res.status(200).json({ success: true, data: grouped });
  } catch (error) {
    console.error('Get pending payments error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch pending payments',
    });
  }
}

// Get settlement history
export async function getSettlementsHandler(req: AuthRequest, res: Response) {
  try {
    const { courier_id, status, limit = 50 } = req.query;

    let query = supabase
      .from('courier_settlement_summary')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit));

    if (courier_id) query = query.eq('courier_id', courier_id as string);
    if (status) query = query.eq('status', status as string);

    let { data, error } = await query;

    if (error) {
      // Fallback to base table if view missing
      let q2 = supabase
        .from('courier_settlements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Number(limit));
      if (courier_id) q2 = q2.eq('courier_id', courier_id as string);
      if (status) q2 = q2.eq('status', status as string);
      const alt = await q2;
      data = alt.data as any[];
      error = alt.error as any;
    }

    if (error) throw error;

    return res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Get settlements error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch settlements',
    });
  }
}

// Create settlement batch
export async function createSettlementHandler(req: AuthRequest, res: Response) {
  try {
    const { courier_id, start_date, end_date } = req.body;

    if (!courier_id || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: 'courier_id, start_date, and end_date are required',
      });
    }

    // Call the database function
    const { data, error } = await supabase.rpc('create_courier_settlement', {
      p_courier_id: courier_id,
      p_start_date: start_date,
      p_end_date: end_date,
    });

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data: { settlement_id: data },
      message: 'Settlement created successfully',
    });
  } catch (error) {
    console.error('Create settlement error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create settlement',
    });
  }
}

// Mark settlement as paid
export async function markSettlementPaidHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { payment_reference, payment_method, payment_date, notes } = req.body;

    // Update settlement
    const { data: settlement, error } = await supabase
      .from('courier_settlements')
      .update({
        status: 'paid',
        payment_reference,
        payment_method,
        payment_date: payment_date || new Date().toISOString(),
        notes,
        paid_by: req.user!.id,
        paid_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Update all sub_orders in this settlement
    const { data: items } = await supabase
      .from('settlement_items')
      .select('sub_order_id, amount')
      .eq('settlement_id', id);

    if (items && items.length > 0) {
      const subOrderIds = items.map(item => item.sub_order_id);
      
      await supabase
        .from('sub_orders')
        .update({
          settlement_status: 'paid',
          courier_paid_amount: supabase.raw('shipping_cost'),
          settlement_date: payment_date || new Date().toISOString(),
          payment_reference,
        })
        .in('id', subOrderIds);
    }

    return res.status(200).json({
      success: true,
      data: settlement,
      message: 'Settlement marked as paid',
    });
  } catch (error) {
    console.error('Mark settlement paid error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to mark settlement as paid',
    });
  }
}

// Get settlement details with items
export async function getSettlementDetailsHandler(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;

    const { data: settlement, error: settlementError } = await supabase
      .from('courier_settlements')
      .select(`
        *,
        courier:couriers(id, name, code),
        settlement_items(
          *,
          sub_order:sub_orders(
            id,
            tracking_number,
            shipping_cost,
            created_at,
            parent_order:orders(woocommerce_order_id, customer_name)
          )
        )
      `)
      .eq('id', id)
      .single();

    if (settlementError) throw settlementError;

    return res.status(200).json({
      success: true,
      data: settlement,
    });
  } catch (error) {
    console.error('Get settlement details error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch settlement details',
    });
  }
}

// Get courier payment statistics
export async function getCourierPaymentStatsHandler(req: AuthRequest, res: Response) {
  try {
    const { courier_id } = req.query;

    let query = supabase.from('sub_orders').select('*');
    
    if (courier_id) {
      query = query.eq('courier_id', courier_id);
    }

    const { data: shipments, error } = await query;

    if (error) throw error;

    const stats = {
      total_shipments: shipments?.length || 0,
      pending_payment: shipments?.filter(s => s.settlement_status === 'pending').reduce((sum, s) => sum + (s.shipping_cost || 0), 0) || 0,
      approved_payment: shipments?.filter(s => s.settlement_status === 'approved').reduce((sum, s) => sum + (s.shipping_cost || 0), 0) || 0,
      paid_amount: shipments?.filter(s => s.settlement_status === 'paid').reduce((sum, s) => sum + (s.courier_paid_amount || 0), 0) || 0,
      total_due: shipments?.reduce((sum, s) => sum + (s.shipping_cost || 0), 0) || 0,
    };

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get payment stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch payment statistics',
    });
  }
}
