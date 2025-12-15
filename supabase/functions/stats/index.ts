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
        JSON.stringify({ error: `${req.method} not supported` }),
        { status: 405, headers }
      );
    }

    // ----------------------------
    // COUNTS
    // ----------------------------
    const { count: totalOrdersCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true });

    const { count: pendingCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("overall_status", "processing");

    const { count: shippedCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("overall_status", "delivered");

    const { data: zones } = await supabase
      .from("zones")
      .select("id, name, shipping_rates(flat_rate)");

    const { count: hubsCount } = await supabase
      .from("hubs")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    const { count: couriersCount } = await supabase
      .from("couriers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true);

    // ----------------------------
    // AVERAGE DELIVERY TIME
    // ----------------------------
    let avgDeliveryTime = 0;

    if (shippedCount && shippedCount > 0) {
      const { data: deliveredOrders } = await supabase
        .from("orders")
        .select("created_at, updated_at")
        .eq("overall_status", "delivered")
        .limit(100);

      if (deliveredOrders?.length) {
        const totalDays = deliveredOrders.reduce((sum, order) => {
          const created = new Date(order.created_at);
          const delivered = new Date(order.updated_at);
          return (
            sum +
            (delivered.getTime() - created.getTime()) /
              (1000 * 60 * 60 * 24)
          );
        }, 0);

        avgDeliveryTime = Math.round(
          totalDays / deliveredOrders.length
        );
      }
    }

    // ----------------------------
    // RESPONSE
    // ----------------------------
    const payload = {
      success: true,
      data: {
        totalOrders: totalOrdersCount ?? 0,
        shippedToday: shippedCount ?? 0,
        pending: pendingCount ?? 0,
        activeZones: zones?.length ?? 0,
        activeHubs: hubsCount ?? 0,
        activeCouriers: couriersCount ?? 0,
        avgDeliveryTime,
      },
    };

    return new Response(JSON.stringify(payload), { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers }
    );
  }
});
