// supabase/functions/track-order/index.ts
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "https://jlo.julinemart.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env vars");
}
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req: Request) => {
  const headers = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method !== "GET") {
      return new Response(
        JSON.stringify({ success: false, error: `${req.method} not supported` }),
        { status: 405, headers }
      );
    }

    const url = new URL(req.url);
    const orderNumber = url.searchParams.get("orderNumber");
    const email = url.searchParams.get("email");

    if (!orderNumber || !email) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing orderNumber or email" }),
        { status: 400, headers }
      );
    }

    // Query by woocommerce_order_id - removed estimated_delivery_date
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
      console.error("Query error:", error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Order not found. Please check your order number and email."
        }),
        { status: 404, headers }
      );
    }

    // Transform tracking_events to match frontend expectations
    const transformedData = {
      ...data,
      sub_orders: data.sub_orders?.map((subOrder: any) => ({
        ...subOrder,
        shipping_cost: subOrder.real_shipping_cost,
        estimated_delivery_date: null, // Add placeholder since column doesn't exist
        tracking_events: (subOrder.tracking_events || [])
          .map((event: any) => ({
            status: event.status,
            location: event.location_name,
            description: event.description,
            timestamp: event.event_time || event.created_at,
            created_at: event.created_at,
          }))
          .sort((a: any, b: any) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          ),
      })),
    };

    // Return shipments (if any return request exists for this order)
    try {
      const { data: requests, error: requestError } = await supabase
        .from("return_requests")
        .select("id")
        .eq("order_id", data.id);

      if (requestError) {
        // Fail soft if table is missing
        if (typeof requestError?.message === "string" && requestError.message.toLowerCase().includes("return_requests")) {
          console.warn("return_requests table missing; skipping return shipments");
        } else {
          throw requestError;
        }
      } else {
        const requestIds = (requests || []).map((r: any) => r.id);
        if (requestIds.length > 0) {
          const { data: shipments, error: shipmentError } = await supabase
            .from("return_shipments")
            .select("id, return_code, fez_tracking, method, status, created_at")
            .in("return_request_id", requestIds)
            .order("created_at", { ascending: false });

          if (shipmentError) {
            if (typeof shipmentError?.message === "string" && shipmentError.message.toLowerCase().includes("return_shipments")) {
              console.warn("return_shipments table missing; skipping return shipments");
            } else {
              throw shipmentError;
            }
          } else {
            (transformedData as any).return_shipments = shipments || [];
          }
        } else {
          (transformedData as any).return_shipments = [];
        }
      }
    } catch (returnErr) {
      console.error("Return shipment fetch error:", returnErr);
      (transformedData as any).return_shipments = [];
    }

    return new Response(
      JSON.stringify({ success: true, data: transformedData }), 
      { headers }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Catch error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }), 
      { status: 500, headers }
    );
  }
});
