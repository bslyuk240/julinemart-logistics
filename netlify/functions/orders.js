// Netlify Function: /api/orders and /api/orders/:id
import { createClient } from '@supabase/supabase-js';
import { loadApprovedLocations, resolveApprovedLocation } from './services/locationResolver.js';
import { requireAdmin } from './services/global-sourcing-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

// List/create/update/delete are staff-only, matching this project's local
// dev Express server (src/api/index.ts's requireRole('admin', 'agent')) and
// the dashboard's own documented API reference (settingsDeveloperContent.ts)
// — the Netlify function running in production was the only place that
// check was never actually implemented.
const STAFF_ROLES = ['admin', 'agent'];

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
        real_shipping_cost,
        allocated_shipping_fee,
        subtotal,
        items,
        last_tracking_update,
        rider_name,
        rider_phone,
        hub_notes,
        courier_notes,
        metadata,
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
          created_at,
          metadata
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

      // Two ways in: staff (Bearer token), or the customer who placed the
      // order (proves it by passing the email on the order) -- the customer
      // PWA's order-detail page uses the latter. Anyone else gets the same
      // 404 as a nonexistent order, not a 401/403, so this can't be used to
      // probe which order ids exist.
      const url = new URL(event.rawUrl);
      const requestedEmail = (url.searchParams.get('email') || '').trim().toLowerCase();
      const orderEmail = (data?.customer_email || '').trim().toLowerCase();
      const emailMatches = Boolean(requestedEmail) && requestedEmail === orderEmail;

      if (!emailMatches) {
        const auth = await requireAdmin(event, STAFF_ROLES);
        if (auth.errorResponse) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ success: false, error: 'Order not found' })
          };
        }
      } else if (Array.isArray(data?.sub_orders)) {
        // Customer path (no staff auth) — rider-reported problems are
        // staff-only, same as track-order.js. Strip them here too since
        // this endpoint doubles as the customer PWA's order-detail fetch.
        data.sub_orders = data.sub_orders.map((s) => ({
          ...s,
          tracking_events: (s.tracking_events || []).filter((e) => e.metadata?.type !== 'problem_report'),
        }));
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, data })
      };
    }

    // =====================================================
    // GET /api/orders — list orders (staff only)
    // =====================================================
    if (event.httpMethod === 'GET') {
      const auth = await requireAdmin(event, STAFF_ROLES);
      if (auth.errorResponse) return auth.errorResponse;

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
    // POST /api/orders — create WC → JLO order (staff only)
    // =====================================================
    if (event.httpMethod === 'POST') {
      const auth = await requireAdmin(event, STAFF_ROLES);
      if (auth.errorResponse) return auth.errorResponse;

      const payload = JSON.parse(event.body || '{}');

      // Validate up front — these columns are NOT NULL with no default, so
      // an omitted field previously reached Postgres as a raw, unhandled
      // constraint violation (500, leaking internal schema details) instead
      // of a clean error. Mirrors create-order.js's validation.
      const missing = [];
      if (!String(payload.customer_name || '').trim()) missing.push('customer_name');
      if (!String(payload.customer_email || '').trim()) missing.push('customer_email');
      if (!String(payload.customer_phone || '').trim()) missing.push('customer_phone');
      if (!String(payload.delivery_address || '').trim()) missing.push('delivery_address');
      if (!String(payload.delivery_city || '').trim()) missing.push('delivery_city');
      if (!String(payload.delivery_state || '').trim()) missing.push('delivery_state');
      if (!String(payload.delivery_zone || '').trim()) missing.push('delivery_zone');
      if (!Number.isFinite(Number(payload.subtotal))) missing.push('subtotal');
      if (!Number.isFinite(Number(payload.total_amount))) missing.push('total_amount');
      if (!Number.isFinite(Number(payload.shipping_fee_paid))) missing.push('shipping_fee_paid');
      if (missing.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: `Missing required fields: ${missing.join(', ')}` })
        };
      }

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
        const hubCityMap = {};
        const vendorCityMap = {};
        const vendorLocationMap = {};

        if (hubIds.length > 0) {
          const [{ data: hubCouriers }, { data: hubRows }] = await Promise.all([
            supabase
              .from('hub_couriers')
              .select('hub_id, courier_id')
              .in('hub_id', hubIds)
              .order('is_primary', { ascending: false })
              .order('priority', { ascending: false }),
            supabase.from('hubs').select('id, city').in('id', hubIds),
          ]);

          (hubCouriers || []).forEach((row) => {
            if (row.hub_id && row.courier_id && !hubCourierMap[row.hub_id]) {
              hubCourierMap[row.hub_id] = row.courier_id;
            }
          });
          for (const h of (hubRows || [])) {
            hubCityMap[h.id] = (h.city || '').trim().toLowerCase();
          }
        }

        const vendorIds = [
          ...new Set(shippingBreakdown.map((b) => b.vendorId || b.vendor_id).filter(Boolean))
        ];
        if (vendorIds.length > 0) {
          const { data: vendorRows } = await supabase
            .from('vendors')
            .select('id, city, approved_location_id')
            .in('id', vendorIds);
          for (const v of (vendorRows || [])) {
            vendorCityMap[v.id] = (v.city || '').trim().toLowerCase();
            vendorLocationMap[v.id] = v.approved_location_id || null;
          }
        }

        const custCity = (payload.delivery_city || '').trim().toLowerCase();

        // Same structural resolution as the PWA checkout path — reconcile
        // through approved_vendor_locations rather than a raw city compare.
        const approvedLocations = await loadApprovedLocations(supabase);
        const custLocation = resolveApprovedLocation(
          approvedLocations,
          payload.delivery_city,
          payload.delivery_lga
        );
        const custHubId = custLocation?.hub_id || null;
        const custSupportsLocal = Boolean(custLocation?.supports_local_delivery);

        const subOrdersData = shippingBreakdown.map((b) => {
          const hubId = b.hubId || b.hub_id;
          const vendorId = b.vendorId || b.vendor_id;
          const courierId =
            b.courierId ||
            b.courier_id ||
            hubCourierMap[hubId] ||
            null;

          // Local rider requires vendor and customer to resolve to the same
          // town — not a JLO hub to exist there. A town with no hub_id at
          // all can still qualify once it has rider coverage
          // (approved_vendor_locations.supports_local_delivery).
          const hubMatch = custSupportsLocal && custHubId && custHubId === hubId;
          const sameLocationMatch =
            custSupportsLocal &&
            custLocation?.id &&
            vendorLocationMap[vendorId] &&
            custLocation.id === vendorLocationMap[vendorId];
          const hubCity = hubCityMap[hubId] || '';
          const vendorCity = vendorCityMap[vendorId] || '';
          const legacyMatch =
            hubCity && custCity && vendorCity && hubCity === custCity && vendorCity === custCity;
          const isLocalEligible = hubMatch || sameLocationMatch || legacyMatch;

          return {
            main_order_id: order.id,
            hub_id: hubId,
            courier_id: courierId,
            status: 'pending',
            tracking_number: null,              // FEZ will generate it later
            courier_waybill: null,
            courier_shipment_id: null,
            courier_tracking_url: null,
            last_tracking_update: null,
            items: b.items || [],
            subtotal: b.subtotal || b.subTotal || 0,
            real_shipping_cost: b.totalShippingFee || 0,
            allocated_shipping_fee: b.totalShippingFee || 0,
            metadata: {
              selected_lane: isLocalEligible ? 'local_rider' : 'fez',
              eligible_lanes: isLocalEligible ? ['local_rider', 'fez'] : ['fez'],
            },
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
            description: 'Order received from JulineMArt',
            location_name: 'JulineMart Fulfillment',
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
    // PUT /api/orders/:id/status — update status (staff only)
    // =====================================================
    if (event.httpMethod === 'PUT' && id && tail === 'status') {
      const auth = await requireAdmin(event, STAFF_ROLES);
      if (auth.errorResponse) return auth.errorResponse;

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
    // DELETE order + suborders + tracking events (staff only)
    // =====================================================
    if (event.httpMethod === 'DELETE' && id) {
      const auth = await requireAdmin(event, STAFF_ROLES);
      if (auth.errorResponse) return auth.errorResponse;

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
