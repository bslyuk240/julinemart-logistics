// supabase/functions/track-order/index.ts

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

// ✅ SHARED CORS
import { corsHeaders } from "../_shared/cors.ts";

/**
 * ================================
 * SUPABASE CLIENT
 * ================================
 */
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env vars");
}

const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  };

  // ----------------------------
  // CORS PREFLIGHT
  // ----------------------------
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method !== "GET") {
      return new Response(
        JSON.stringify({
          success: false,
          error: `${req.method} not supported`,
        }),
        { status: 405, headers }
      );
    }

    const url = new URL(req.url);
    const orderNumber = url.searchParams.get("orderNumber");
    const email = url.searchParams.get("email");

    if (!orderNumber || !email) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing orderNumber or email",
        }),
        { status: 400, headers }
      );
    }

    // ----------------------------
    // FETCH ORDER + SUB DATA
    // ----------------------------
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id,
        woocommerce_order_id,
        customer_name,
        customer_email,
        customer_phone,
        delivery_address,
        delivery_city,
        delivery_state,
        total_amount,
        shipping_fee_paid,
        overall_status,
        created_at,
        sub_orders (
          id,
          tracking_number,
          status,
          real_shipping_cost,
          courier_tracking_url,
          created_at,
          hubs (
            name,
            city,
            state
          ),
          couriers (
            name,
            code
          ),
          tracking_events (
            status,
            location_name,
            description,
            event_time,
            created_at
          )
        )
      `)
      .eq("woocommerce_order_id", orderNumber)
      .eq("customer_email", email)
      .single();

    if (error || !data) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Order not found. Please check your order number and email.",
        }),
        { status: 404, headers }
      );
    }

    // ----------------------------
    // TRANSFORM DATA
    // ----------------------------
    const transformedData = {
      ...data,
      sub_orders: data.sub_orders?.map((subOrder: any) => ({
        ...subOrder,
        shipping_cost: subOrder.real_shipping_cost,
        estimated_delivery_date: null,
        tracking_events: (subOrder.tracking_events || [])
          .map((event: any) => ({
            status: event.status,
            location: event.location_name,
            description: event.description,
            timestamp: event.event_time || event.created_at,
            created_at: event.created_at,
          }))
          .sort(
            (a: any, b: any) =>
              new Date(b.timestamp).getTime() -
              new Date(a.timestamp).getTime()
          ),
      })),
    };

    // ----------------------------
    // RETURN SHIPMENTS (SOFT)
    // ----------------------------
    try {
      const { data: requests, error: requestError } = await supabase
        .from("return_requests")
        .select("id")
        .eq("order_id", data.id);

      if (!requestError && requests?.length) {
        const requestIds = requests.map((r: any) => r.id);

        const { data: shipments, error: shipmentError } =
          await supabase
            .from("return_shipments")
            .select(
              "id, return_code, fez_tracking, method, status, created_at"
            )
            .in("return_request_id", requestIds)
            .order("created_at", { ascending: false });

        (transformedData as any).return_shipments =
          shipmentError ? [] : shipments || [];
      } else {
        (transformedData as any).return_shipments = [];
      }
    } catch {
      (transformedData as any).return_shipments = [];
    }

    return new Response(
      JSON.stringify({ success: true, data: transformedData }),
      { headers }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers }
    );
  }
});
