// supabase/functions/shipping-estimate/index.ts
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

// VAT rate in Nigeria
const VAT_RATE = 0.075; // 7.5%

// Default configuration - Only use Warri Hub and Fez Delivery
const DEFAULT_HUB_NAME = "Warri Hub";
const DEFAULT_COURIER_NAME = "Fez Delivery";

serve(async (req: Request) => {
  const headers = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ success: false, error: `${req.method} not supported` }),
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
        JSON.stringify({ success: false, error: "Delivery state is required" }),
        { status: 400, headers }
      );
    }

    // Find the zone for this state
    const { data: zones, error: zoneError } = await supabase
      .from("zones")
      .select("*");

    if (zoneError) {
      console.error("Zone query error:", zoneError);
      throw zoneError;
    }

    // Find zone that contains this state
    const zone = zones?.find((z: any) => 
      z.states && Array.isArray(z.states) && 
      z.states.some((s: string) => s.toLowerCase() === state.toLowerCase())
    );

    if (!zone) {
      console.log("No zone found for state:", state);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `No shipping zone configured for ${state}. Please contact support.` 
        }),
        { status: 400, headers }
      );
    }

    console.log("Found zone:", zone.name, zone.id);

    // Get Warri Hub specifically
    const { data: warriHub } = await supabase
      .from("hubs")
      .select("*")
      .ilike("name", "%warri%")
      .eq("is_active", true)
      .limit(1)
      .single();

    console.log("Warri Hub:", warriHub?.name || "Not found - using default");

    // Get Fez Delivery courier specifically
    const { data: fezCourier } = await supabase
      .from("couriers")
      .select("*")
      .or("code.ilike.%fez%,name.ilike.%fez%")
      .eq("is_active", true)
      .limit(1)
      .single();

    console.log("Fez Courier:", fezCourier?.name || "Not found - using default");

    // Get shipping rate for this zone with Fez courier (if exists)
    let rate = null;
    
    if (fezCourier) {
      const { data: fezRate } = await supabase
        .from("shipping_rates")
        .select("*")
        .eq("zone_id", zone.id)
        .eq("courier_id", fezCourier.id)
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(1)
        .single();
      
      rate = fezRate;
      console.log("Found Fez rate for zone:", rate?.id || "None");
    }

    // If no Fez-specific rate, try to get rate with Warri hub
    if (!rate && warriHub) {
      const { data: warriRate } = await supabase
        .from("shipping_rates")
        .select("*")
        .eq("zone_id", zone.id)
        .eq("hub_id", warriHub.id)
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(1)
        .single();
      
      rate = warriRate;
      console.log("Found Warri Hub rate for zone:", rate?.id || "None");
    }

    // If still no rate, get any rate for this zone
    if (!rate) {
      const { data: anyRate } = await supabase
        .from("shipping_rates")
        .select("*")
        .eq("zone_id", zone.id)
        .eq("is_active", true)
        .order("priority", { ascending: false })
        .limit(1)
        .single();
      
      rate = anyRate;
      console.log("Using fallback rate:", rate?.id || "None - will use defaults");
    }

    // Calculate total weight from items
    const totalWeight = items?.reduce((sum: number, item: any) => {
      const weight = Number(item.weight ?? 1);
      const quantity = Number(item.quantity ?? 1);
      return sum + (weight * quantity);
    }, 0) || 1;

    const totalOrderValue = items?.reduce((sum: number, item: any) => {
      const price = Number(item.price ?? 0);
      const quantity = Number(item.quantity ?? 1);
      return sum + (price * quantity);
    }, 0) || 0;

    console.log("Total weight:", totalWeight, "kg");
    console.log("Total order value:", totalOrderValue);

    // Calculate shipping cost
    let baseRate: number;
    let perKgRate = 0;
    let freeShippingThreshold = 0;
    let deliveryTimelineDays = 3;

    if (rate) {
      baseRate = Number(rate.flat_rate ?? 2500);
      perKgRate = Number(rate.per_kg_rate ?? 0);
      freeShippingThreshold = Number(rate.free_shipping_threshold ?? 0);
      deliveryTimelineDays = Number(rate.estimated_days ?? 3);
      
      // Add per-kg charge if applicable
      const minWeight = Number(rate.min_weight_kg ?? 0);
      if (perKgRate > 0 && totalWeight > minWeight) {
        baseRate += perKgRate * (totalWeight - minWeight);
      }
    } else {
      // Default rate if none found in database
      baseRate = 2500 + (totalWeight * 500);
    }

    // Check for free shipping
    if (freeShippingThreshold > 0 && totalOrderValue >= freeShippingThreshold) {
      baseRate = 0;
    }

    // Round base rate
    baseRate = Math.round(baseRate);

    // Calculate VAT
    const vat = Math.round(baseRate * VAT_RATE);
    const totalShippingFee = baseRate + vat;

    // Use Fez delivery time if available
    if (fezCourier?.average_delivery_time_days) {
      deliveryTimelineDays = fezCourier.average_delivery_time_days;
    }

    // ALWAYS return Warri Hub and Fez Delivery in response
    const response = {
      success: true,
      data: {
        zoneName: zone.name,
        zoneCode: zone.code,
        totalShippingFee,
        subOrders: [{
          hubId: warriHub?.id ?? null,
          hubName: warriHub?.name ?? DEFAULT_HUB_NAME,
          courierId: fezCourier?.id ?? null,
          courierName: fezCourier?.name ?? DEFAULT_COURIER_NAME,
          totalWeight,
          baseRate,
          vat,
          totalShippingFee,
          deliveryTimelineDays,
        }],
        breakdown: {
          flatRate: rate?.flat_rate ?? 2500,
          perKgRate: perKgRate,
          weightCharge: perKgRate > 0 ? Math.round(perKgRate * totalWeight) : 0,
          subtotal: baseRate,
          vatRate: "7.5%",
          vatAmount: vat,
          total: totalShippingFee,
          freeShippingThreshold: freeShippingThreshold > 0 ? freeShippingThreshold : null,
          qualifiesForFreeShipping: freeShippingThreshold > 0 && totalOrderValue >= freeShippingThreshold,
        },
      },
    };

    console.log("Final Response - Hub:", response.data.subOrders[0].hubName, "Courier:", response.data.subOrders[0].courierName);

    return new Response(JSON.stringify(response), { headers });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Shipping estimate error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers }
    );
  }
});