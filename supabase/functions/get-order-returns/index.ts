import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(req) });
  }

  try {
    const url = new URL(req.url);
    const orderNumber = url.searchParams.get("orderId");

    if (!orderNumber) {
      return new Response(
        JSON.stringify({ success: false, error: "orderId is required" }),
        { status: 400, headers: corsHeaders(req) }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    /* -------------------------------------------
       STEP 1: Resolve Woo order → internal UUID
    -------------------------------------------- */
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("woocommerce_order_id", orderNumber)
      .maybeSingle();

    if (!order || orderError) {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: corsHeaders(req) }
      );
    }

    /* -------------------------------------------
       STEP 2: Get return requests for this order
    -------------------------------------------- */
    const { data: requests, error: requestError } = await supabase
      .from("return_requests")
      .select("id")
      .eq("order_id", order.id);

    if (requestError || !requests?.length) {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: corsHeaders(req) }
      );
    }

    const requestIds = requests.map(r => r.id);

    /* -------------------------------------------
       STEP 3: Fetch return shipments
    -------------------------------------------- */
    const { data: shipments, error } = await supabase
      .from("return_shipments")
      .select(`
        *,
        return_request:return_requests (
          id,
          order_number,
          customer_name,
          customer_email,
          status,
          reason_code,
          reason_note,
          created_at
        )
      `)
      .in("return_request_id", requestIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, data: shipments || [] }),
      { status: 200, headers: corsHeaders(req) }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message
      }),
      { status: 500, headers: corsHeaders(req) }
    );
  }
});
