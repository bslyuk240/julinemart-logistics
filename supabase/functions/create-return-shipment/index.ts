import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const ALLOWED_ORIGINS = [
  "https://jlo.julinemart.com",
  "https://www.jlo.julinemart.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const DEFAULT_ALLOWED_HEADERS = ["authorization", "x-client-info", "apikey", "content-type"];
const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const fezApiBaseUrl = (Deno.env.get("FEZ_API_BASE_URL") || "").replace(/\/+$/, "");
const fezApiKey = Deno.env.get("FEZ_PASSWORD") || Deno.env.get("FEZ_API_KEY") || "";
const fezUserId = Deno.env.get("FEZ_USER_ID") || "";

if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase configuration");

const supabase = createClient(supabaseUrl, supabaseKey);

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "https://jlo.julinemart.com",
    "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS.join(", "),
    "Access-Control-Allow-Methods": DEFAULT_ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function generateReturnCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let code = "RTN-";
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Generate short unique ID (similar to Netlify Fez flow)
function generateShortUniqueId(source: string) {
  const shortId = source.replace(/-/g, "").slice(-8);
  const timestamp = Date.now().toString(36);
  return `JLO-${shortId}-${timestamp}`.toUpperCase();
}

async function authenticateFez() {
  if (!fezApiBaseUrl || !fezApiKey || !fezUserId) throw new Error("Fez API not configured");

  const response = await fetch(`${fezApiBaseUrl}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: fezUserId, password: fezApiKey }),
  });

  const data = await response.json().catch(() => ({}));
  if (data?.status !== "Success") throw new Error(data?.description || "Fez auth failed");

  return {
    authToken: data.authDetails?.authToken,
    secretKey: data.orgDetails?.["secret-key"],
  };
}

// Extract order number from "already exists" error message
function extractExistingOrderNumber(message: string): string | null {
  // Pattern: "already exists for your order XXXX"
  const match = message.match(/order\s+([A-Z0-9]+)/i);
  return match ? match[1] : null;
}

function isValidFezOrderNumber(value: unknown): boolean {
  if (!value || typeof value !== "string") return false;
  const errorIndicators = ["error", "cannot", "failed", "invalid", "wrong", "something went wrong"];
  const lowerValue = value.toLowerCase();
  // "already exists" is a special case - it contains the valid order number
  if (lowerValue.includes("already exists")) return false;
  for (const indicator of errorIndicators) {
    if (lowerValue.includes(indicator)) return false;
  }
  return value.length < 50 && /^[A-Za-z0-9_-]+$/.test(value.trim());
}

async function createFezPickup(
  returnCode: string,
  customer: Record<string, unknown>,
  hub: Record<string, unknown>,
): Promise<string> {
  const auth = await authenticateFez();
  if (!auth.authToken || !auth.secretKey) throw new Error("Fez auth missing token/secret");

  // Use short unique IDs (no hyphens) consistent with working Fez flow
  const uniqueId = generateShortUniqueId(returnCode);
  const sanitizedId = uniqueId.replace(/-/g, "");
  const batchId = returnCode.replace(/-/g, "");

  // Return flow: pick up from customer, deliver to hub
  const shipmentData = {
    // Delivery destination (hub)
    recipientAddress: (hub as any)?.address || "",
    recipientState: (hub as any)?.state || "Lagos",
    recipientName: (hub as any)?.name || "JulineMart Hub",
    recipientPhone: (hub as any)?.phone || "+2340000000000",
    recipientEmail: "returns@julinemart.com",
    // Unique refs
    uniqueID: sanitizedId,
    BatchID: batchId,
    // Package details
    itemDescription: `Return package ${returnCode}`,
    valueOfItem: "6000",
    weight: 1,
    // Pickup origin (customer)
    pickUpAddress: (customer as any)?.address || "",
    pickUpState: (customer as any)?.state || "Lagos",
    additionalDetails: `Return from: ${(customer as any)?.name || ""}, Phone: ${(customer as any)?.phone || ""}`,
  };

  console.log("Fez uniqueID:", uniqueId);
  console.log("Fez payload:", JSON.stringify(shipmentData));

  const response = await fetch(`${fezApiBaseUrl}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${auth.authToken}`,
      "secret-key": auth.secretKey,
    },
    body: JSON.stringify([shipmentData]),
  });

  const text = await response.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  console.log("Fez status:", response.status, "body:", text);

  if (data?.status === "Success" && data?.orderNos) {
    const values = Object.values(data.orderNos);
    if (values.length > 0) {
      const orderId = values[0] as string;
      
      // Check if it's a valid order number
      if (isValidFezOrderNumber(orderId)) {
        console.log("✅ Fez order created:", orderId);
        return orderId;
      }
      
      // Check if it's an "already exists" message - extract the existing order number
      if (typeof orderId === "string" && orderId.toLowerCase().includes("already exists")) {
        const existingOrder = extractExistingOrderNumber(orderId);
        if (existingOrder) {
          console.log("✅ Using existing Fez order:", existingOrder);
          return existingOrder;
        }
      }
      
      // It's an error message
      throw new Error(orderId || "Fez returned an error for this order");
    }
  }

  const fezMessage = data?.description || data?.message || text || "Fez order creation failed";
  throw new Error(`Fez error (${response.status}): ${fezMessage}`);
}

serve(async (req) => {
  const headers = { "Content-Type": "application/json", ...getCorsHeaders(req) };

  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, error: "POST only" }), { status: 405, headers });

  try {
    const body = await req.json().catch(() => ({}));
    const { return_request_id, method, customer, hub } = body ?? {};

    console.log("Request:", { return_request_id, method });

    if (!return_request_id || !method) {
      return new Response(JSON.stringify({ success: false, error: "return_request_id and method required" }), { status: 400, headers });
    }

    if (!["pickup", "dropoff"].includes(method)) {
      return new Response(JSON.stringify({ success: false, error: "Invalid method" }), { status: 400, headers });
    }

    const returnCode = generateReturnCode();
    let fezTracking: string | null = null;

    if (method === "pickup") {
      if (!customer || !hub) {
        return new Response(JSON.stringify({ success: false, error: "customer and hub required" }), { status: 400, headers });
      }
      if (!(customer as any).address || !(customer as any).state) {
        return new Response(JSON.stringify({ success: false, error: "customer address and state required" }), { status: 400, headers });
      }

      try {
        fezTracking = await createFezPickup(returnCode, customer, hub);
      } catch (err) {
        console.error("Fez error:", err);
        return new Response(JSON.stringify({ 
          success: false, 
          error: `Fez pickup creation failed: ${err instanceof Error ? err.message : String(err)}` 
        }), { status: 400, headers });
      }
    }

    // Save to database
    const { data: shipment, error: dbError } = await supabase
      .from("return_shipments")
      .insert({
        return_request_id,
        return_code: returnCode,
        method,
        fez_tracking: fezTracking,
        status: method === "pickup" ? "pickup_scheduled" : "awaiting_dropoff",
      })
      .select()
      .single();

    if (dbError) {
      console.error("DB error:", dbError);
      return new Response(JSON.stringify({ success: false, error: "DB save failed: " + dbError.message }), { status: 500, headers });
    }

    console.log("✅ Return shipment saved:", shipment?.id);

    return new Response(JSON.stringify({
      success: true,
      return_code: returnCode,
      fez_tracking: fezTracking,
      method,
      shipment_id: shipment?.id,
    }), { status: 200, headers });

  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : "Internal error" 
    }), { status: 500, headers });
  }
});
