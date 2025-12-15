import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  };

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ success: false, error: "GET only" }),
      { status: 405, headers }
    );
  }

  try {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase env vars missing");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const wooOrderId = url.searchParams.get("orderId");

    if (!wooOrderId) {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { headers }
      );
    }

    // 🔑 STEP 1: Resolve Woo → UUID (SAFE, no .single())
    const { data: orders, error: orderError } = await supabase
      .from("orders")
      .select("id")
      .eq("woocommerce_order_id", wooOrderId)
      .limit(1);

    if (orderError || !orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { headers }
      );
    }

    const orderUuid = orders[0].id;

    // 🔑 STEP 2: Fetch return shipments
    const { data: shipments, error } = await supabase
      .from("return_shipments")
      .select("*")
      .eq("order_id", orderUuid)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, data: shipments ?? [] }),
      { headers }
    );
  } catch (err) {
    console.error("get-order-returns error:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Internal error",
      }),
      { status: 500, headers }
    );
  }
});
