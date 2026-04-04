// supabase/functions/shipping-estimate/index.ts

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

// VAT rate in Nigeria
const VAT_RATE = 0.075;

// Defaults
const DEFAULT_HUB_NAME = "Warri Hub";
const DEFAULT_COURIER_NAME = "Fez Delivery";

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
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          error: `${req.method} not supported`,
        }),
        { status: 405, headers }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { state, city, items } = body;

    console.log("=== SHIPPING ESTIMATE DEBUG ===");
    console.log("State:", state);
    console.log("City:", city);
    console.log("Items:", items);

    if (!state) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Delivery state is required",
        }),
        { status: 400, headers }
      );
    }

    // ----------------------------
    // ZONE LOOKUP
    // ----------------------------
    const { data: zones, error: zoneError } = await supabase
      .from("zones")
      .select("*");

    if (zoneError) throw zoneError;

    const zone = zones?.find((z: any) =>
      Array.isArray(z.states) &&
      z.states.some(
        (s: string) => s.toLowerCase() === state.toLowerCase()
      )
    );

    if (!zone) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `No shipping zone configured for ${state}. Please contact support.`,
        }),
        { status: 400, headers }
      );
    }

    console.log("Found zone:", zone.name);

    // ----------------------------
    // HUB & COURIER
    // ----------------------------
    const { data: warriHub } = await supabase
      .from("hubs")
      .select("*")
      .ilike("name", "%warri%")
      .eq("is_active", true)
      .limit(1)
      .single();

    const { data: fezCourier } = await supabase
      .from("couriers")
      .select("*")
      .or("code.ilike.%fez%,name.ilike.%fez%")
      .eq("is_active", true)
      .limit(1)
      .single();

    // ----------------------------
    // SHIPPING RATE
    // ----------------------------
    let rate: any = null;

    if (fezCourier) {
      const { data } = await supabase
        .from("shipping_rates")
        .select("*")
        .eq("zone_id", zone.id)
        .eq("courier_id", fezCourier.id)
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(1)
        .single();

      rate = data;
    }

    if (!rate && warriHub) {
      const { data } = await supabase
        .from("shipping_rates")
        .select("*")
        .eq("zone_id", zone.id)
        .eq("hub_id", warriHub.id)
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(1)
        .single();

      rate = data;
    }

    if (!rate) {
      const { data } = await supabase
        .from("shipping_rates")
        .select("*")
        .eq("zone_id", zone.id)
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(1)
        .single();

      rate = data;
    }

    // ----------------------------
    // CALCULATIONS
    // ----------------------------
    const totalWeight =
      items?.reduce((sum: number, item: any) => {
        return sum + Number(item.weight ?? 1) * Number(item.quantity ?? 1);
      }, 0) || 1;

    const totalOrderValue =
      items?.reduce((sum: number, item: any) => {
        return sum + Number(item.price ?? 0) * Number(item.quantity ?? 1);
      }, 0) || 0;

    let baseRate = 2500;
    let perKgRate = 0;
    let freeShippingThreshold = 0;
    let deliveryTimelineDays = 3;

    if (rate) {
      baseRate = Number(rate.flat_rate ?? 2500);
      perKgRate = Number(rate.per_kg_rate ?? 0);
      freeShippingThreshold = Number(rate.free_shipping_threshold ?? 0);
      deliveryTimelineDays = Number(rate.estimated_days ?? 3);

      const minWeight = Number(rate.min_weight_kg ?? 0);
      if (perKgRate > 0 && totalWeight > minWeight) {
        baseRate += perKgRate * (totalWeight - minWeight);
      }
    } else {
      baseRate += totalWeight * 500;
    }

    if (
      freeShippingThreshold > 0 &&
      totalOrderValue >= freeShippingThreshold
    ) {
      baseRate = 0;
    }

    baseRate = Math.round(baseRate);

    const vat = Math.round(baseRate * VAT_RATE);
    const totalShippingFee = baseRate + vat;

    if (fezCourier?.average_delivery_time_days) {
      deliveryTimelineDays = fezCourier.average_delivery_time_days;
    }

    // ----------------------------
    // RESPONSE
    // ----------------------------
    const response = {
      success: true,
      data: {
        zoneName: zone.name,
        zoneCode: zone.code,
        totalShippingFee,
        subOrders: [
          {
            hubId: warriHub?.id ?? null,
            hubName: warriHub?.name ?? DEFAULT_HUB_NAME,
            courierId: fezCourier?.id ?? null,
            courierName: fezCourier?.name ?? DEFAULT_COURIER_NAME,
            totalWeight,
            baseRate,
            vat,
            totalShippingFee,
            deliveryTimelineDays,
          },
        ],
      },
    };

    return new Response(JSON.stringify(response), { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Shipping estimate error:", message);

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers }
    );
  }
});
