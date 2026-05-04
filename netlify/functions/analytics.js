/**
 * GET /api/analytics
 * Real business analytics for JulineMart admin dashboard.
 */
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 503, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Database not configured' }) };
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const [
      ordersRes,
      subOrdersRes,
      itemsRes,
      vendorsRes,
      hubsRes,
      couriersRes,
      zonesRes,
      settlementRes,
      monthlyRes,
    ] = await Promise.all([

      // All orders summary
      db.from('orders').select('id, total_amount, subtotal, shipping_fee_paid, payment_status, overall_status, delivery_zone, delivery_state, created_at'),

      // Sub-orders for delivery stats + avg delivery time
      db.from('sub_orders').select('id, status, delivered_at, created_at, real_shipping_cost, courier_id'),

      // Order items for vendor revenue (paid orders only)
      db.from('order_items')
        .select('vendor_id, subtotal, orders(payment_status)')
        .eq('orders.payment_status', 'paid'),

      // Vendors
      db.from('vendors').select('id, store_name, commission_rate, is_active'),

      // Active hubs
      db.from('hubs').select('id, is_active').eq('is_active', true),

      // Active couriers
      db.from('couriers').select('id, is_active').eq('is_active', true),

      // Zones
      db.from('zones').select('id, name'),

      // Pending settlement amount
      db.from('sub_orders')
        .select('real_shipping_cost, allocated_shipping_fee, courier_charge')
        .eq('status', 'delivered')
        .not('settlement_status', 'in', '("approved","paid")'),

      // Monthly P&L from view
      db.from('monthly_pnl_view').select('period, revenue, gross_sales, expenses, gross_profit, order_count').order('period', { ascending: false }).limit(6),
    ]);

    const orders    = ordersRes.data    || [];
    const subOrders = subOrdersRes.data || [];
    const items     = (itemsRes.data    || []).filter(i => i.orders?.payment_status === 'paid');
    const vendors   = vendorsRes.data   || [];
    const zones     = zonesRes.data     || [];

    // ── Overview ──────────────────────────────────────────────────────────────
    const totalOrders   = orders.length;
    const paidOrders    = orders.filter(o => o.payment_status === 'paid').length;
    const grossSales    = orders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + Number(o.subtotal || 0), 0);
    const shippingTotal = orders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + Number(o.shipping_fee_paid || 0), 0);

    // JulineMart revenue = vendor commissions + own-product margin + shipping
    const commissionRevenue = items.reduce((s, i) => {
      const vendor = vendors.find(v => v.id === i.vendor_id);
      const rate   = vendor ? Number(vendor.commission_rate || 0) : 0;
      return s + Number(i.subtotal) * rate / 100;
    }, 0);
    const ownProductRevenue = items.filter(i => !i.vendor_id).reduce((s, i) => s + Number(i.subtotal), 0);
    const julinemartRevenue = commissionRevenue + ownProductRevenue + shippingTotal;

    // ── Delivery stats ────────────────────────────────────────────────────────
    const delivered  = subOrders.filter(s => s.status === 'delivered').length;
    const failed     = subOrders.filter(s => s.status === 'failed').length;
    const inProgress = subOrders.filter(s => ['pending','assigned','picked_up','in_transit','out_for_delivery'].includes(s.status)).length;
    const totalSubs  = subOrders.length;
    const successPct = totalSubs > 0 ? Math.round((delivered / totalSubs) * 100) : 0;
    const failedPct  = totalSubs > 0 ? Math.round((failed  / totalSubs) * 100) : 0;

    // Avg delivery time (days) for completed deliveries
    const deliveryTimes = subOrders
      .filter(s => s.status === 'delivered' && s.delivered_at && s.created_at)
      .map(s => (new Date(s.delivered_at) - new Date(s.created_at)) / (1000 * 60 * 60 * 24));
    const avgDeliveryDays = deliveryTimes.length > 0
      ? Math.round((deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length) * 10) / 10
      : 0;

    // ── Orders by zone ────────────────────────────────────────────────────────
    const zoneMap = {};
    orders.forEach(o => {
      const key = o.delivery_zone || 'Unknown';
      if (!zoneMap[key]) zoneMap[key] = { zone: key, orders: 0, revenue: 0 };
      zoneMap[key].orders  += 1;
      zoneMap[key].revenue += Number(o.total_amount || 0);
    });
    const ordersByZone = Object.values(zoneMap).sort((a, b) => b.orders - a.orders).slice(0, 8);

    // ── Top vendors ───────────────────────────────────────────────────────────
    const vendorMap = {};
    items.forEach(i => {
      if (!i.vendor_id) return;
      const v = vendors.find(v => v.id === i.vendor_id);
      if (!vendorMap[i.vendor_id]) {
        vendorMap[i.vendor_id] = {
          vendor_id:  i.vendor_id,
          store_name: v?.store_name || 'Unknown',
          orders:     0,
          gross_sales: 0,
          commission:  0,
        };
      }
      vendorMap[i.vendor_id].gross_sales += Number(i.subtotal);
      vendorMap[i.vendor_id].commission  += Number(i.subtotal) * Number(v?.commission_rate || 0) / 100;
    });
    // Count distinct orders per vendor
    const orderItemsFull = itemsRes.data || [];
    orderItemsFull.filter(i => i.orders?.payment_status === 'paid' && i.vendor_id).forEach(i => {
      if (vendorMap[i.vendor_id]) vendorMap[i.vendor_id].orders += 1;
    });
    const topVendors = Object.values(vendorMap)
      .sort((a, b) => b.gross_sales - a.gross_sales)
      .slice(0, 5);

    // ── Pending settlement ────────────────────────────────────────────────────
    const pendingSettlement = (settlementRes.data || []).reduce((s, so) =>
      s + Number(so.real_shipping_cost ?? so.allocated_shipping_fee ?? so.courier_charge ?? 0), 0);

    // ── Order status breakdown ────────────────────────────────────────────────
    const statusCounts = {};
    orders.forEach(o => {
      statusCounts[o.overall_status] = (statusCounts[o.overall_status] || 0) + 1;
    });

    return {
      statusCode: 200,
      headers: corsHeaders(origin),
      body: JSON.stringify({
        success: true,
        data: {
          overview: {
            total_orders:        totalOrders,
            paid_orders:         paidOrders,
            julinemart_revenue:  julinemartRevenue,
            gross_sales:         grossSales,
            commission_revenue:  commissionRevenue,
            shipping_revenue:    shippingTotal,
            active_vendors:      vendors.filter(v => v.is_active).length,
          },
          delivery: {
            total:       totalSubs,
            delivered,
            failed,
            in_progress: inProgress,
            success_pct: successPct,
            failed_pct:  failedPct,
            avg_delivery_days: avgDeliveryDays,
          },
          operations: {
            zones:              zones.length,
            active_hubs:        (hubsRes.data || []).length,
            courier_partners:   (couriersRes.data || []).length,
            pending_settlement: pendingSettlement,
          },
          orders_by_zone: ordersByZone,
          top_vendors:    topVendors,
          order_statuses: statusCounts,
          monthly_trend:  (monthlyRes.data || []).reverse(), // oldest → newest
        },
      }),
    };
  } catch (err) {
    console.error('Analytics error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: err.message || 'Internal server error' }),
    };
  }
}
