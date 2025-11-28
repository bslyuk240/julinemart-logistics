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
      // Use default zone or return error
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

    // Get shipping rates for this zone
    const { data: rates, error: ratesError } = await supabase
      .from("shipping_rates")
      .select(`
        *,
        hubs (id, name, city, state),
        couriers (id, name, code, average_delivery_time_days)
      `)
      .eq("zone_id", zone.id)
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (ratesError) {
      console.error("Rates query error:", ratesError);
      throw ratesError;
    }

    console.log("Found rates:", rates?.length);

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

    console.log("Total weight:", totalWeight);
    console.log("Total order value:", totalOrderValue);

    // If no rates found, use a default calculation
    if (!rates || rates.length === 0) {
      // Default flat rate calculation
      const defaultBaseRate = 2500;
      const defaultPerKgRate = 500;
      const baseRate = defaultBaseRate + (totalWeight * defaultPerKgRate);
      const vat = Math.round(baseRate * VAT_RATE);
      const totalShippingFee = baseRate + vat;

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            zoneName: zone.name,
            zoneCode: zone.code,
            totalShippingFee,
            subOrders: [{
              hubName: "Default Hub",
              courierName: "Standard Delivery",
              totalWeight,
              baseRate,
              vat,
              totalShippingFee,
              deliveryTimelineDays: 5,
            }],
          },
        }),
        { headers }
      );
    }

    // Use the best rate (highest priority)
    const bestRate = rates[0];
    
    // Calculate shipping cost
    let baseRate = Number(bestRate.flat_rate ?? 0);
    
    // Add per-kg rate if weight exceeds minimum
    const perKgRate = Number(bestRate.per_kg_rate ?? 0);
    const minWeight = Number(bestRate.min_weight_kg ?? 0);
    
    if (perKgRate > 0 && totalWeight > minWeight) {
      baseRate += perKgRate * (totalWeight - minWeight);
    }

    // Check for free shipping threshold
    const freeShippingThreshold = Number(bestRate.free_shipping_threshold ?? 0);
    if (freeShippingThreshold > 0 && totalOrderValue >= freeShippingThreshold) {
      baseRate = 0;
    }

    // Calculate VAT
    const vat = Math.round(baseRate * VAT_RATE);
    const totalShippingFee = baseRate + vat;

    // Get delivery time
    const deliveryTimelineDays = bestRate.couriers?.average_delivery_time_days ?? 
                                  bestRate.estimated_days ?? 5;

    const response = {
      success: true,
      data: {
        zoneName: zone.name,
        zoneCode: zone.code,
        totalShippingFee,
        subOrders: [{
          hubId: bestRate.hubs?.id ?? null,
          hubName: bestRate.hubs?.name ?? "Fulfillment Center",
          courierId: bestRate.couriers?.id ?? null,
          courierName: bestRate.couriers?.name ?? "Standard Delivery",
          totalWeight,
          baseRate: Math.round(baseRate),
          vat,
          totalShippingFee,
          deliveryTimelineDays,
        }],
        // Additional info for transparency
        breakdown: {
          flatRate: Number(bestRate.flat_rate ?? 0),
          perKgRate: perKgRate,
          weightCharge: perKgRate > 0 ? Math.round(perKgRate * Math.max(0, totalWeight - minWeight)) : 0,
          subtotal: Math.round(baseRate),
          vatRate: "7.5%",
          vatAmount: vat,
          total: totalShippingFee,
          freeShippingThreshold: freeShippingThreshold > 0 ? freeShippingThreshold : null,
          qualifiesForFreeShipping: freeShippingThreshold > 0 && totalOrderValue >= freeShippingThreshold,
        },
      },
    };

    console.log("Response:", JSON.stringify(response, null, 2));

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