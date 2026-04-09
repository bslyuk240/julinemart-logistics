/**
 * GET /api/vendor-stats
 * Dashboard summary stats for the authenticated vendor.
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const { vendor, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  const [earningsRes, withdrawalsRes, pendingOrdersRes, recentOrdersRes, productsRes] = await Promise.all([
    // Earnings summary
    adminClient.from('vendor_earnings_summary').select('*').eq('vendor_id', vendor.id).single(),

    // Pending withdrawal requests
    adminClient.from('vendor_withdrawals')
      .select('id, amount, status, created_at')
      .eq('vendor_id', vendor.id)
      .in('status', ['pending', 'approved'])
      .order('created_at', { ascending: false }),

    // Pending sub_orders (awaiting fulfillment)
    adminClient.from('sub_orders')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_id', vendor.id)
      .in('status', ['pending', 'assigned']),

    // Recent orders (last 5) — join through order_items
    adminClient.from('order_items')
      .select('order_id, subtotal, orders(id, order_number, overall_status, created_at, customer_name)')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false })
      .limit(5),

    // Product count
    adminClient.from('products')
      .select('id', { count: 'exact', head: true })
      .eq('vendor_id', vendor.id)
      .eq('status', 'publish'),
  ]);

  const earnings = earningsRes.data || {};
  const pendingWithdrawals = (withdrawalsRes.data || []).reduce((s, w) => s + Number(w.amount), 0);

  // Monthly earnings for last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const { data: monthlyData } = await adminClient
    .from('vendor_monthly_earnings')
    .select('month, orders, gross_sales, net_earnings')
    .eq('vendor_id', vendor.id)
    .gte('month', sixMonthsAgo.toISOString())
    .order('month', { ascending: true });

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({
      success: true,
      data: {
        earnings: {
          gross_sales:        Number(earnings.gross_sales || 0),
          platform_commission: Number(earnings.platform_commission || 0),
          net_earnings:       Number(earnings.net_earnings || 0),
          total_withdrawn:    Number(earnings.total_withdrawn || 0),
          available_balance:  Number(earnings.available_balance || 0),
          commission_rate:    Number(vendor.commission_rate || 0),
        },
        pending_withdrawal_amount: pendingWithdrawals,
        pending_orders:   pendingOrdersRes.count || 0,
        total_products:   productsRes.count || 0,
        total_orders:     Number(earnings.total_orders || 0),
        recent_orders:    (recentOrdersRes.data || []).map(oi => ({
          order_id:     oi.order_id,
          order_number: oi.orders?.order_number,
          status:       oi.orders?.overall_status,
          amount:       Number(oi.subtotal),
          customer:     oi.orders?.customer_name,
          created_at:   oi.orders?.created_at,
        })),
        monthly_chart: (monthlyData || []).map(m => ({
          month:       m.month,
          orders:      Number(m.orders),
          gross_sales: Number(m.gross_sales),
          net_earnings: Number(m.net_earnings),
        })),
      },
    }),
  };
}
