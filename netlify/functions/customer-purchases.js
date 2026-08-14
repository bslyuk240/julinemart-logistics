/**
 * GET /api/customer-purchases?email=...
 * Flat purchase archive for delivered orders — receipt, warranty, seller contact.
 */
import { createClient } from '@supabase/supabase-js';
import { authenticateCustomer } from './services/customerAuth.js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function addMonths(isoDate, months) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime()) || !months) return null;
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function latestDeliveredAt(subOrders) {
  const dates = (subOrders || [])
    .map((s) => s.delivered_at)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
  if (!dates.length) return null;
  return new Date(Math.max(...dates)).toISOString();
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  try {
    const { email, error: authError } = await authenticateCustomer(event);
    if (authError) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: authError }),
      };
    }

    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, order_number, created_at, paid_at, overall_status, total_amount,
        payment_reference,
        sub_orders ( id, status, delivered_at ),
        order_items (
          id, product_id, product_name, product_sku, quantity, unit_price, subtotal,
          warranty_type, warranty_months,
          vendors ( id, store_name, phone, email, woocommerce_vendor_id )
        )
      `)
      .eq('customer_email', email)
      .in('overall_status', ['delivered', 'completed'])
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) {
      console.error('[customer-purchases]', error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: 'Failed to fetch purchases' }),
      };
    }

    const purchases = [];
    for (const order of orders || []) {
      const deliveredAt = latestDeliveredAt(order.sub_orders);
      const warrantyStart = deliveredAt || order.paid_at || order.created_at;

      for (const item of order.order_items || []) {
        const vendor = item.vendors || null;
        const warrantyType = item.warranty_type && item.warranty_type !== 'none' ? item.warranty_type : null;
        const warrantyMonths = item.warranty_months ? Number(item.warranty_months) : null;
        const warrantyExpiresAt =
          warrantyType && warrantyMonths ? addMonths(warrantyStart, warrantyMonths) : null;

        purchases.push({
          id: item.id,
          order_id: order.id,
          order_number: order.order_number,
          product_id: item.product_id,
          product_name: item.product_name,
          product_sku: item.product_sku,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
          purchased_at: order.created_at,
          delivered_at: deliveredAt,
          payment_reference: order.payment_reference,
          order_total: order.total_amount,
          warranty_type: warrantyType,
          warranty_months: warrantyMonths,
          warranty_expires_at: warrantyExpiresAt,
          vendor: vendor
            ? {
                id: vendor.id,
                store_name: vendor.store_name,
                phone: vendor.phone,
                email: vendor.email,
                storefront_id: vendor.woocommerce_vendor_id,
              }
            : null,
        });
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: purchases }),
    };
  } catch (err) {
    console.error('[customer-purchases]', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'Internal server error' }),
    };
  }
}
