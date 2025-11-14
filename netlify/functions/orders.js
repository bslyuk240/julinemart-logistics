// Netlify Function: /api/orders and /api/orders/:id
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'orders');
  const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;
  const tail = idx >= 0 && parts.length > idx + 2 ? parts[idx + 2] : undefined; // e.g., 'status'

  try {
    if (event.httpMethod === 'GET' && id) {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          sub_orders(
            *,
            hubs(id, name, city),
            couriers(id, name, code),
            tracking_events(*)
          )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    if (event.httpMethod === 'GET') {
      const url = new URL(event.rawUrl);
      const limit = Number(url.searchParams.get('limit') || 50);
      const offset = Number(url.searchParams.get('offset') || 0);

      const { data: orders, error, count } = await supabase
        .from('orders')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      const body = JSON.stringify({ success: true, data: orders || [], pagination: { total: count, limit, offset } });
      return { statusCode: 200, headers, body };
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      const orderInsert = {
        woocommerce_order_id: payload.woocommerce_order_id,
        customer_name: payload.customer_name,
        customer_email: payload.customer_email,
        customer_phone: payload.customer_phone,
        delivery_address: payload.delivery_address,
        delivery_city: payload.delivery_city,
        delivery_state: payload.delivery_state,
        delivery_zone: payload.delivery_zone,
        subtotal: payload.subtotal,
        total_amount: payload.total_amount,
        shipping_fee_paid: payload.shipping_fee_paid,
        payment_status: payload.payment_status || 'pending',
        overall_status: payload.overall_status || 'pending'
      };

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert([orderInsert])
        .select()
        .single();
      if (orderError) throw orderError;

      if (payload.shipping_breakdown && Array.isArray(payload.shipping_breakdown)) {
        const subOrdersData = payload.shipping_breakdown.map((b) => ({
          main_order_id: order.id,
          hub_id: b.hubId,
          courier_id: b.courierId,
          status: 'pending',
          tracking_number: `${(b.courierName || 'CR').substring(0, 3).toUpperCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
          items: b.items || [],
          subtotal: 0,
          real_shipping_cost: b.totalShippingFee || 0,
          allocated_shipping_fee: b.totalShippingFee || 0
        }));

        const { data: subOrders } = await supabase
          .from('sub_orders')
          .insert(subOrdersData)
          .select();

        if (subOrders && subOrders.length > 0) {
          const trackingEvents = subOrders.map((s) => ({
            sub_order_id: s.id,
            status: 'pending',
            description: 'Order received and awaiting processing',
            location_name: 'Processing Center',
            event_time: new Date().toISOString()
          }));
          await supabase.from('tracking_events').insert(trackingEvents);
        }
      }

      return { statusCode: 201, headers, body: JSON.stringify({ success: true, data: order, message: 'Order created successfully' }) };
    }

    // Update order status: /api/orders/:id/status
    if (event.httpMethod === 'PUT' && id && tail === 'status') {
      const payload = JSON.parse(event.body || '{}');
      const updateData = {};
      if (payload.overall_status !== undefined) updateData.overall_status = payload.overall_status;
      if (payload.payment_status !== undefined) updateData.payment_status = payload.payment_status;
      if (Object.keys(updateData).length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'No fields to update' }) };
      }
      const { data, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data, message: 'Status updated' }) };
    }

    if (event.httpMethod === 'DELETE' && id) {
      const { data: subOrders, error: subOrdersError } = await supabase
        .from('sub_orders')
        .select('id')
        .eq('main_order_id', id);

      if (subOrdersError) throw subOrdersError;

      const subOrderIds = subOrders?.map((sub) => sub.id) || [];

      if (subOrderIds.length > 0) {
        const { error: trackingError } = await supabase
          .from('tracking_events')
          .delete()
          .in('sub_order_id', subOrderIds);

        if (trackingError) throw trackingError;

        const { error: subsDeleteError } = await supabase
          .from('sub_orders')
          .delete()
          .in('id', subOrderIds);

        if (subsDeleteError) throw subsDeleteError;
      }

      const { data: deletedOrder, error } = await supabase
        .from('orders')
        .delete()
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data: deletedOrder, message: 'Order deleted' })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Failed to handle orders' })
    };
  }
}
