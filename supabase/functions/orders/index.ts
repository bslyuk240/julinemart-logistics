import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

// バ. IMPORT SHARED CORS
import { corsHeaders } from "../_shared/cors.ts";

const STATUS_PRIORITY: Record<string, number> = {
  pending: 1,
  processing: 2,
  assigned: 3,
  picked_up: 4,
  in_transit: 5,
  out_for_delivery: 6,
  delivered: 7,
  returned: 8,
  failed: 9,
  cancelled: 10,
};

const ORDER_LIST_SELECT = `
  *,
  sub_orders (
    status
  )
`;

const ORDER_DETAIL_SELECT = `
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
      created_at
    )
  )
`;

const getOrderIdFromPath = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  const ordersIndex = segments.lastIndexOf("orders");
  if (ordersIndex === -1) return undefined;
  return segments.length > ordersIndex + 1 ? segments[ordersIndex + 1] : undefined;
};

const getEventTimestamp = (event: any) => {
  const timestamp = event?.event_time ?? event?.created_at;
  return timestamp ? new Date(timestamp).getTime() : 0;
};

const getStatusPriority = (status?: string) => {
  if (!status) return 0;
  return STATUS_PRIORITY[status] ?? 0;
};

const deriveOverallStatus = (order: any) => {
  const fallback = order?.overall_status || "pending";
  let bestStatus = fallback;
  const statuses = Array.isArray(order?.sub_orders)
    ? order.sub_orders.map((so: any) => so?.status).filter(Boolean)
    : [];

  statuses.forEach((status) => {
    if (getStatusPriority(status) > getStatusPriority(bestStatus)) {
      bestStatus = status;
    }
  });

  return bestStatus;
};

serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  };

  // バ. ALWAYS handle OPTIONS first
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url = new URL(req.url);
    const orderId = getOrderIdFromPath(url.pathname);

    if (req.method === "GET") {
      if (orderId) {
        const { data, error } = await supabase
          .from("orders")
          .select(ORDER_DETAIL_SELECT)
          .eq("id", orderId)
          .single();

        if (error) {
          if (error.code === "PGRST116") {
            return new Response(
              JSON.stringify({ success: false, error: "Order not found" }),
              { status: 404, headers }
            );
          }
          throw error;
        }

        const transformed = {
          ...data,
          sub_orders: (data?.sub_orders || []).map((subOrder: any) => {
            const events = subOrder?.tracking_events ?? [];
            const sortedEvents = [...events].sort(
              (a: any, b: any) => getEventTimestamp(b) - getEventTimestamp(a)
            );

            return {
              ...subOrder,
              tracking_events: sortedEvents,
            };
          }),
        };

        return new Response(
          JSON.stringify({ success: true, data: transformed }),
          { headers }
        );
      }

      const { data, error } = await supabase
        .from("orders")
        .select(ORDER_LIST_SELECT)
        .order("created_at", { ascending: false });

      if (error) throw error;
      const enrichedData = (data || []).map((order: any) => {
        const derivedStatus = deriveOverallStatus(order);
        const { sub_orders, ...orderWithoutSubOrders } = order;
        return {
          ...orderWithoutSubOrders,
          overall_status: derivedStatus,
        };
      });

      return new Response(
        JSON.stringify({ success: true, data: enrichedData }),
        { headers }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers }
    );
  }
});
