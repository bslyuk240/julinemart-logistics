/**
 * GET /api/vendor-earnings
 * Detailed earnings breakdown for the authenticated vendor.
 * Supports ?period=this_month|last_month|last_3_months|last_6_months|all_time
 *
 * KEY BUSINESS RULES preserved:
 *  - Vendor payout = subtotal × (1 - commission_rate/100)
 *  - Voucher discounts are absorbed by JulineMart — vendor still gets full payout
 *  - Influencer commissions paid by JulineMart — not deducted from vendor
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor } from './services/vendorAuth.js';

function periodToDate(period) {
  const now = new Date();
  switch (period) {
    case 'this_month':    return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'last_month':    { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d; }
    case 'last_3_months': { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d; }
    case 'last_6_months': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d; }
    default:              return null; // all_time
  }
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const { vendor, adminClient, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  const qs     = event.queryStringParameters || {};
  const period = qs.period || 'all_time';
  const since  = periodToDate(period);

  // Order items for this vendor (paid orders only)
  let itemsQuery = adminClient
    .from('order_items')
    .select('id, subtotal, quantity, cost_price, product_name, product_sku, order_id, created_at, orders(overall_status, payment_status, created_at, order_number)')
    .eq('vendor_id', vendor.id)
    .eq('orders.payment_status', 'paid');

  if (since) itemsQuery = itemsQuery.gte('created_at', since.toISOString());
  const { data: items } = await itemsQuery;

  const commissionRate = Number(vendor.commission_rate || 0);
  const paid = (items || []).filter(i => i.orders?.payment_status === 'paid');

  const grossSales         = paid.reduce((s, i) => s + Number(i.subtotal), 0);
  const platformCommission = grossSales * commissionRate / 100;
  const netEarnings        = grossSales * (1 - commissionRate / 100);
  // COGS: only included for items where cost_price was set
  const totalCogs          = paid.reduce((s, i) => {
    if (i.cost_price == null) return s;
    return s + Number(i.cost_price) * Number(i.quantity || 1);
  }, 0);
  const cogsTracked        = paid.some(i => i.cost_price != null);
  const grossProfit        = cogsTracked ? netEarnings - totalCogs : null;

  // Withdrawals in same period
  let wdQuery = adminClient
    .from('vendor_withdrawals')
    .select('id, amount, status, created_at, payment_date')
    .eq('vendor_id', vendor.id);
  if (since) wdQuery = wdQuery.gte('created_at', since.toISOString());
  const { data: withdrawals } = await wdQuery;

  const totalWithdrawn = (withdrawals || [])
    .filter(w => w.status === 'paid')
    .reduce((s, w) => s + Number(w.amount), 0);

  // Available balance = all-time net - all-time withdrawn (period filter only for display)
  const { data: fullEarnings } = await adminClient
    .from('vendor_earnings_summary')
    .select('available_balance, total_withdrawn, net_earnings')
    .eq('vendor_id', vendor.id)
    .single();

  // Monthly breakdown for chart (last 12 months)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const { data: monthlyData } = await adminClient
    .from('vendor_monthly_earnings')
    .select('month, orders, gross_sales, net_earnings, platform_commission')
    .eq('vendor_id', vendor.id)
    .gte('month', twelveMonthsAgo.toISOString())
    .order('month', { ascending: true });

  // Top products by revenue
  const productMap = {};
  for (const item of paid) {
    const key = item.product_sku || item.product_name;
    if (!productMap[key]) productMap[key] = { name: item.product_name, sku: item.product_sku, gross: 0, qty: 0, cogs: 0, cogs_tracked: false };
    productMap[key].gross += Number(item.subtotal);
    productMap[key].qty   += Number(item.quantity);
    if (item.cost_price != null) {
      productMap[key].cogs         += Number(item.cost_price) * Number(item.quantity || 1);
      productMap[key].cogs_tracked  = true;
    }
  }
  const topProducts = Object.values(productMap)
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 10)
    .map(p => ({
      name: p.name,
      sku: p.sku,
      gross: p.gross,
      qty: p.qty,
      net: p.gross * (1 - commissionRate / 100),
      cogs: p.cogs_tracked ? p.cogs : null,
      profit: p.cogs_tracked ? p.gross * (1 - commissionRate / 100) - p.cogs : null,
    }));

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({
      success: true,
      data: {
        period,
        commission_rate: commissionRate,
        period_summary: {
          gross_sales:          grossSales,
          platform_commission:  platformCommission,
          net_earnings:         netEarnings,
          total_orders:         new Set(paid.map(i => i.order_id)).size,
          withdrawn_in_period:  totalWithdrawn,
          total_cogs:           cogsTracked ? totalCogs : null,
          gross_profit:         grossProfit,
          cogs_tracked:         cogsTracked,
        },
        all_time: {
          available_balance: Number(fullEarnings?.available_balance || 0),
          total_withdrawn:   Number(fullEarnings?.total_withdrawn || 0),
          total_net_earnings: Number(fullEarnings?.net_earnings || 0),
        },
        monthly_chart: (monthlyData || []).map(m => ({
          month:       m.month,
          orders:      Number(m.orders),
          gross_sales: Number(m.gross_sales),
          net_earnings: Number(m.net_earnings),
          commission:  Number(m.platform_commission),
        })),
        top_products: topProducts,
        recent_withdrawals: (withdrawals || []).slice(0, 10),
      },
    }),
  };
}
