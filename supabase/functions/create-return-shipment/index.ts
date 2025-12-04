import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const DEFAULT_ALLOWED_HEADERS = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
];

const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const fezApiBaseUrl = (Deno.env.get("FEZ_API_BASE_URL") || Deno.env.get("FEZ_API_URL") || "").replace(/\/$/, "");
const fezApiKey = Deno.env.get("FEZ_API_KEY") || Deno.env.get("FEZ_PASSWORD") || "";
const fezUserId = Deno.env.get("FEZ_USER_ID") || "";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase configuration");
}

const supabase = createClient(supabaseUrl, supabaseKey);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const requestHeaders = req.headers.get("access-control-request-headers");
  const requestedMethod = req.headers.get("access-control-request-method");

  const allowedHeaders = new Set(DEFAULT_ALLOWED_HEADERS);
  if (requestHeaders) {
    requestHeaders.split(",").forEach((header) => {
      const sanitized = header.trim().toLowerCase();
      if (sanitized) allowedHeaders.add(sanitized);
    });
  }

  const allowedMethods = new Set(DEFAULT_ALLOWED_METHODS);
  if (requestedMethod) {
    allowedMethods.add(requestedMethod.toUpperCase());
  }

  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : "https://jlo.julinemart.com",
    "Access-Control-Allow-Headers": Array.from(allowedHeaders).join(", "),
    "Access-Control-Allow-Methods": Array.from(allowedMethods).join(", "),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function generateReturnCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let code = "RTN-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function createFezPickup(
  returnRequestId: string,
  returnCode: string,
  customer: Record<string, unknown>,
  hub: Record<string, unknown>,
) {
  if (!fezApiBaseUrl || !fezApiKey) {
    throw new Error("Fez API not configured");
  }

  const payload = {
    user_id: fezUserId || undefined,
    reference: returnRequestId,
    sender: {
      name: (hub as any)?.name,
      phone: (hub as any)?.phone,
      address: (hub as any)?.address,
      city: (hub as any)?.city,
      state: (hub as any)?.state,
    },
    receiver: {
      name: (customer as any)?.name,
      phone: (customer as any)?.phone,
      address: (customer as any)?.address,
      city: (customer as any)?.city,
      state: (customer as any)?.state,
    },
    package: {
      items: [],
      total_weight: 1,
      declared_value: 0,
      description: `Return package ${returnCode}`,
    },
    shipping: {
      service_type: "standard",
      amount: 0,
    },
  };

  const response = await fetch(`${fezApiBaseUrl}/shipment/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${fezApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      (data as any)?.message ||
      (data as any)?.error ||
      (data as any)?.description ||
      "Failed to create Fez return shipment";
    throw new Error(message as string);
  }

  const tracking =
    (data as any)?.tracking_number ||
    (data as any)?.trackingNumber ||
    (data as any)?.waybill ||
    (data as any)?.orderNo ||
    (data as any)?.order_no ||
    (data as any)?.orderNumber ||
    (data as any)?.data?.tracking_number ||
    null;

  return tracking as string | null;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders,
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: `${req.method} not supported` }),
      { status: 405, headers },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { return_request_id, method, customer, hub } = body ?? {};

    if (!return_request_id || !method) {
      return new Response(
        JSON.stringify({ success: false, error: "return_request_id and method are required" }),
        { status: 400, headers },
      );
    }

    if (!["pickup", "dropoff"].includes(method)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid method. Use 'pickup' or 'dropoff'" }),
        { status: 400, headers },
      );
    }

    const returnCode = generateReturnCode();
    let fezTracking: string | null = null;

    if (method === "pickup") {
      try {
        fezTracking = await createFezPickup(return_request_id, returnCode, customer, hub);
      } catch (fezError) {
        console.error("Fez return shipment error:", fezError);
        return new Response(
          JSON.stringify({
            success: false,
            error: (fezError as Error)?.message || "Failed to create Fez return shipment",
          }),
          { status: 502, headers },
        );
      }
    }

    const { error: insertError, data: record } = await supabase
      .from("return_shipments")
      .insert({
        return_request_id,
        return_code: returnCode,
        method,
        status: "pending",
        fez_tracking: fezTracking,
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("Insert return_shipment error:", insertError);
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        return_code: returnCode,
        fez_tracking: fezTracking,
        method,
        data: record,
      }),
      { status: 200, headers },
    );
  } catch (error) {
    console.error("create-return-shipment error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error)?.message || "Failed to create return shipment",
      }),
      { status: 500, headers },
    );
  }
});
