export const config = {
  verify_jwt: false,
};

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";

/* =========================
   SUPABASE CLIENT
========================= */
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/* =========================
   FEZ HELPERS
========================= */
async function authenticateFez(
  baseUrl: string,
  userId: string,
  password: string
) {
  const res = await fetch(`${baseUrl}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      password,
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (data?.status !== "Success") {
    throw new Error(data?.description || "Fez authentication failed");
  }

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails["secret-key"],
  };
}

async function fetchFezTracking(
  baseUrl: string,
  authToken: string,
  secretKey: string,
  trackingNumber: string
) {
  const res = await fetch(`${baseUrl}/order/track/${trackingNumber}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "secret-key": secretKey,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (data?.status !== "Success") {
    throw new Error(data?.description || "Failed to fetch tracking");
  }

  return data;
}

/* =========================
   HANDLER
========================= */
serve(async (req) => {
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  };

  // CORS preflight
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
    const url = new URL(req.url);
    const subOrderId = url.searchParams.get("subOrderId");

    if (!subOrderId) {
      return new Response(
        JSON.stringify({ success: false, error: "subOrderId is required" }),
        { status: 400, headers }
      );
    }

    console.log("Fetching tracking for sub-order:", subOrderId);

    // 1️⃣ Load sub-order + courier
    const { data: subOrder, error } = await supabase
      .from("sub_orders")
      .select(`
        tracking_number,
        courier_waybill,
        couriers (
          api_base_url,
          api_user_id,
          api_password
        )
      `)
      .eq("id", subOrderId)
      .single();

    if (error || !subOrder || !subOrder.couriers) {
      throw new Error("Sub-order or courier configuration missing");
    }

    const trackingNumber =
      subOrder.tracking_number || subOrder.courier_waybill;

    if (!trackingNumber) {
      throw new Error("No valid tracking number found");
    }

    const baseUrl =
      subOrder.couriers.api_base_url ??
      "https://apisandbox.fezdelivery.co/v1";

    // 2️⃣ Authenticate Fez
    const { authToken, secretKey } = await authenticateFez(
      baseUrl,
      subOrder.couriers.api_user_id,
      subOrder.couriers.api_password
    );

    // 3️⃣ Fetch tracking
    const tracking = await fetchFezTracking(
      baseUrl,
      authToken,
      secretKey,
      trackingNumber
    );

    return new Response(
      JSON.stringify({
        success: true,
        data: tracking,
      }),
      { headers }
    );
  } catch (err) {
    console.error("Fez tracking error:", err);

    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Internal error",
      }),
      { status: 500, headers }
    );
  }
});
