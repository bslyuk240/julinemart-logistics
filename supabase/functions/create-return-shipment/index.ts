import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

// ✅ SHARED CORS
import { corsHeaders } from "../_shared/cors.ts";

/**
 * ================================
 * ENV & CLIENTS
 * ================================
 */
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const fezApiBaseUrl = (Deno.env.get("FEZ_API_BASE_URL") || "").replace(/\/+$/, "");
const fezApiKey =
  Deno.env.get("FEZ_PASSWORD") || Deno.env.get("FEZ_API_KEY") || "";
const fezUserId = Deno.env.get("FEZ_USER_ID") || "";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase configuration");
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * ================================
 * HELPERS
 * ================================
 */
function generateReturnCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let code = "RTN-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function generateShortUniqueId(source: string) {
  const shortId = source.replace(/-/g, "").slice(-8);
  const timestamp = Date.now().toString(36);
  return `JLO-${shortId}-${timestamp}`.toUpperCase();
}

async function authenticateFez() {
  if (!fezApiBaseUrl || !fezApiKey || !fezUserId) {
    throw new Error("Fez API not configured");
  }

  const response = await fetch(`${fezApiBaseUrl}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: fezUserId, password: fezApiKey }),
  });

  const data = await response.json().catch(() => ({}));
  if (data?.status !== "Success") {
    throw new Error(data?.description || "Fez auth failed");
  }

  return {
    authToken: data.authDetails?.authToken,
    secretKey: data.orgDetails?.["secret-key"],
  };
}

function extractExistingOrderNumber(message: string): string | null {
  const match = message.match(/order\s+([A-Z0-9]+)/i);
  return match ? match[1] : null;
}

function isValidFezOrderNumber(value: unknown): boolean {
  if (!value || typeof value !== "string") return false;
  const lower = value.toLowerCase();
  if (lower.includes("already exists")) return false;
  const errorIndicators = ["error", "cannot", "failed", "invalid", "wrong"];
  return (
    !errorIndicators.some((i) => lower.includes(i)) &&
    value.length < 50 &&
    /^[A-Za-z0-9_-]+$/.test(value.trim())
  );
}

async function createFezPickup(
  returnCode: string,
  customer: Record<string, unknown>,
  hub: Record<string, unknown>,
): Promise<string> {
  const auth = await authenticateFez();
  if (!auth.authToken || !auth.secretKey) {
    throw new Error("Fez auth missing token/secret");
  }

  const uniqueId = generateShortUniqueId(returnCode);
  const sanitizedId = uniqueId.replace(/-/g, "");
  const batchId = returnCode.replace(/-/g, "");

  const shipmentData = {
    recipientAddress: (hub as any)?.address || "",
    recipientState: (hub as any)?.state || "Lagos",
    recipientName: (hub as any)?.name || "JulineMart Hub",
    recipientPhone: (hub as any)?.phone || "+2340000000000",
    recipientEmail: "returns@julinemart.com",
    uniqueID: sanitizedId,
    BatchID: batchId,
    itemDescription: `Return package ${returnCode}`,
    valueOfItem: "6000",
    weight: 1,
    pickUpAddress: (customer as any)?.address || "",
    pickUpState: (customer as any)?.state || "Lagos",
    additionalDetails: `Return from: ${(customer as any)?.name || ""}, Phone: ${(customer as any)?.phone || ""}`,
  };

  const response = await fetch(`${fezApiBaseUrl}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.authToken}`,
      "secret-key": auth.secretKey,
    },
    body: JSON.stringify([shipmentData]),
  });

  const text = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {}

  if (data?.status === "Success" && data?.orderNos) {
    const values = Object.values(data.orderNos);
    if (values.length > 0) {
      const orderId = values[0] as string;

      if (isValidFezOrderNumber(orderId)) return orderId;

      if (orderId.toLowerCase().includes("already exists")) {
        const existing = extractExistingOrderNumber(orderId);
        if (existing) return existing;
      }

      throw new Error(orderId);
    }
  }

  throw new Error(data?.description || "Fez order creation failed");
}

/**
 * ================================
 * HANDLER
 * ================================
 */
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

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "POST only" }),
      { status: 405, headers }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { return_request_id, method, customer, hub } = body ?? {};

    if (!return_request_id || !method) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "return_request_id and method required",
        }),
        { status: 400, headers }
      );
    }

    if (!["pickup", "dropoff"].includes(method)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid method" }),
        { status: 400, headers }
      );
    }

    const returnCode = generateReturnCode();
    let fezTracking: string | null = null;

    if (method === "pickup") {
      if (!customer || !hub) {
        return new Response(
          JSON.stringify({ success: false, error: "customer and hub required" }),
          { status: 400, headers }
        );
      }

      fezTracking = await createFezPickup(returnCode, customer, hub);
    }

    const { data: shipment, error } = await supabase
      .from("return_shipments")
      .insert({
        return_request_id,
        return_code: returnCode,
        method,
        fez_tracking: fezTracking,
        status:
          method === "pickup" ? "pickup_scheduled" : "awaiting_dropoff",
      })
      .select()
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({
        success: true,
        return_code: returnCode,
        fez_tracking: fezTracking,
        method,
        shipment_id: shipment?.id,
      }),
      { headers }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal error",
      }),
      { status: 500, headers }
    );
  }
});
