import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(req) });
  }

  try {
    const url = new URL(req.url);
    const raw =
      url.searchParams.get("order_id")?.trim() ||
      url.searchParams.get("orderId")?.trim();

    if (!raw) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "order_id (Supabase UUID) or orderId (WooCommerce id) is required",
        }),
        { status: 400, headers: corsHeaders(req) },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    /* -------------------------------------------
       STEP 1: Resolve → internal orders.id (uuid)
       - order_id=<uuid>  — direct (dashboard / JLO)
       - orderId=<wc>     — legacy WooCommerce order id
    -------------------------------------------- */
    let orderInternalId: string;

    if (UUID_RE.test(raw)) {
      const { data: row, error: idErr } = await supabase
        .from("orders")
        .select("id")
        .eq("id", raw)
        .maybeSingle();

      if (idErr) {
        console.error("[get-order-returns] id lookup:", idErr);
      }
      if (!row?.id) {
        return new Response(
          JSON.stringify({ success: true, data: [] }),
          { status: 200, headers: corsHeaders(req) },
        );
      }
      orderInternalId = row.id;
    } else {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id")
        .eq("woocommerce_order_id", raw)
        .maybeSingle();

      if (orderError || !order?.id) {
        return new Response(
          JSON.stringify({ success: true, data: [] }),
          { status: 200, headers: corsHeaders(req) },
        );
      }
      orderInternalId = order.id;
    }

    /* -------------------------------------------
       STEP 2: Get return requests for this order
    -------------------------------------------- */
    const { data: requests, error: requestError } = await supabase
      .from("return_requests")
      .select("id")
      .eq("order_id", orderInternalId);

    if (requestError || !requests?.length) {
      return new Response(
        JSON.stringify({ success: true, data: [] }),
        { status: 200, headers: corsHeaders(req) },
      );
    }

    const requestIds = requests.map((r) => r.id);

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
      { status: 200, headers: corsHeaders(req) },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
      }),
      { status: 500, headers: corsHeaders(req) },
    );
  }
});
