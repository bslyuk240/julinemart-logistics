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

// =========================================================
// HELPER – Fetch order with all nested relationships
// =========================================================
async function loadFullOrder(id) {
  return supabase
    .from('orders')
    .select(`
      *,
      sub_orders (
        id,
        main_order_id,
        hub_id,
        courier_id,
        status,
        tracking_number,
        courier_waybill,
        courier_shipment_id,
        courier_tracking_url,
        waybill_url,
        label_url,
        last_tracking_update,
        real_shipping_cost,
        allocated_shipping_fee,
        items,
        created_at,
        
        hubs (
          id,
          name,
          city,
          address,
          state
        ),
        
        couriers (
          id,
          name,
          code,
          api_enabled,
          api_base_url
        ),

        tracking_events (
          id,
          status,
          description,
          location_name,
          event_time,
          created_at
        )
      )
    `)
    .eq('id', id)
    .single();
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const parts = event.path.split('/');
  const idx = parts.findIndex((p) => p === 'orders');
  const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;
  const tail = idx >= 0 && parts.length > idx + 2 ? parts[idx + 2] : undefined;

  try {
    // =====================================================
    // GET /api/orders/:id — get one order with suborders
    // =====================================================
    if (event.httpMethod === 'GET' && id) {
      if (!SUPABASE_URL || !SERVICE_KEY) {
        console.error('ORDER FUNCTION ERROR: Missing Supabase env vars');
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ success: false, error: 'Server misconfigured' })
        };
      }

      const { data, error } = await loadFullOrder(id);

      // Supabase "row not found"
      if (error?.code === 'PGRST116') {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ success: false, error: 'Order not found' })
        };
      }

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    // =====================================================
    // GET /api/orders — list orders
    // =====================================================
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

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: orders || [],
          pagination: { total: count, limit, offset }
        })
      };
    }

    // =====================================================
    // POST /api/orders — create WC → JLO order
    // =====================================================
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

      // INSERT Order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert([orderInsert])
        .select()
        .single();
      if (orderError) throw orderError;

      // Process shipping breakdown → create sub_orders
      const shippingBreakdown = Array.isArray(payload.shipping_breakdown)
        ? payload.shipping_breakdown
        : [];

      if (shippingBreakdown.length > 0) {
        const hubIds = [
          ...new Set(shippingBreakdown.map((b) => b.hubId || b.hub_id).filter(Boolean))
        ];

        let hubCourierMap = {};

        if (hubIds.length > 0) {
          const { data: hubCouriers } = await supabase
            .from('hub_couriers')
            .select('hub_id, courier_id')
            .in('hub_id', hubIds)
            .order('is_primary', { ascending: false })
            .order('priority', { ascending: false });

          (hubCouriers || []).forEach((row) => {
            if (row.hub_id && row.courier_id && !hubCourierMap[row.hub_id]) {
              hubCourierMap[row.hub_id] = row.courier_id;
            }
          });
        }

        const subOrdersData = shippingBreakdown.map((b) => {
          const hubId = b.hubId || b.hub_id;
          const courierId =
            b.courierId ||
            b.courier_id ||
            hubCourierMap[hubId] ||
            null;

          return {
            main_order_id: order.id,
            hub_id: hubId,
            courier_id: courierId,
            status: 'pending',
            tracking_number: null,              // FEZ will generate it later
            courier_waybill: null,
            courier_shipment_id: null,
            courier_tracking_url: null,
            waybill_url: null,
            label_url: null,
            last_tracking_update: null,
            items: b.items || [],
            real_shipping_cost: b.totalShippingFee || 0,
            allocated_shipping_fee: b.totalShippingFee || 0
          };
        });

        const { data: subOrders } = await supabase
          .from('sub_orders')
          .insert(subOrdersData)
          .select();

        // Insert initial tracking events
        if (subOrders?.length > 0) {
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

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          data: order,
          message: 'Order created successfully'
        })
      };
    }

    // =====================================================
    // PUT /api/orders/:id/status — update status
    // =====================================================
    if (event.httpMethod === 'PUT' && id && tail === 'status') {
      const payload = JSON.parse(event.body || '{}');
      const updateData = {};

      if (payload.overall_status !== undefined)
        updateData.overall_status = payload.overall_status;
      if (payload.payment_status !== undefined)
        updateData.payment_status = payload.payment_status;

      if (Object.keys(updateData).length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'No fields to update' })
        };
      }

      const { data, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data, message: 'Status updated' })
      };
    }

    // =====================================================
    // DELETE order + suborders + tracking events
    // =====================================================
    if (event.httpMethod === 'DELETE' && id) {
      const { data: subOrders, error: subOrdersError } = await supabase
        .from('sub_orders')
        .select('id')
        .eq('main_order_id', id);

      if (subOrdersError) throw subOrdersError;

      const subOrderIds = subOrders?.map((s) => s.id) || [];

      if (subOrderIds.length > 0) {
        await supabase.from('tracking_events').delete().in('sub_order_id', subOrderIds);
        await supabase.from('sub_orders').delete().in('id', subOrderIds);
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
        body: JSON.stringify({
          success: true,
          data: deletedOrder,
          message: 'Order deleted'
        })
      };
    }

    // Default – method not allowed
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' })
    };

  } catch (e) {
    console.error('ORDER FUNCTION ERROR:', e);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to handle orders',
        message: e?.message || 'Unknown error',
        code: e?.code || undefined
      })
    };
  }
}
