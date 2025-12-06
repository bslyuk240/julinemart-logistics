// POST /api/return-shipments/:id/tracking - Save customer tracking number (DROP-OFF VERSION)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Method not allowed - use POST" }),
    };
  }

  try {
    console.log("=== ADD RETURN TRACKING ===");
    console.log("Event path:", event.path);
    console.log("Query params:", event.queryStringParameters);

    // Extract return_shipment_id from query OR path
    let returnShipmentId = null;

    // Option 1: Query parameter
    if (event.queryStringParameters?.return_shipment_id) {
      returnShipmentId = event.queryStringParameters.return_shipment_id;
    }

    // Option 2: Path parameters
    if (!returnShipmentId && event.pathParameters?.id) {
      returnShipmentId = event.pathParameters.id;
    }

    // Option 3: Manual path parsing
    if (!returnShipmentId) {
      const cleanPath = event.path.split("?")[0];
      const parts = cleanPath.split("/").filter(Boolean);
      const idx = parts.indexOf("return-shipments");
      if (idx >= 0 && parts[idx + 1]) {
        returnShipmentId = parts[idx + 1];
      }
    }

    // Final validation
    if (!returnShipmentId || returnShipmentId === "tracking") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Return shipment ID required",
          hint: "Use: /api/add-return-tracking?return_shipment_id={id}",
        }),
      };
    }

    // Parse body
    const body = JSON.parse(event.body || "{}");
    const tracking_number = (body.tracking_number || "").trim();

    if (!tracking_number) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "tracking_number is required",
        }),
      };
    }

    console.log("Saving tracking:", tracking_number, "for shipment:", returnShipmentId);

    // 1️⃣ Update return_shipments table
    const { data: shipment, error: shipmentErr } = await supabase
      .from("return_shipments")
      .update({
        fez_tracking: tracking_number,
        status: "in_transit",                      // MOVE → in_transit
        customer_submitted_tracking: true,
        tracking_submitted_at: new Date().toISOString(),
      })
      .eq("id", returnShipmentId)
      .select()
      .maybeSingle();

    if (shipmentErr) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Failed to update shipment: " + shipmentErr.message,
        }),
      };
    }

    if (!shipment) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ success: false, error: "Return shipment not found" }),
      };
    }

    // 2️⃣ Update parent return_request
    await supabase
      .from("return_requests")
      .update({
        status: "in_transit",                      // KEEP STATUSES ALIGNED
        fez_tracking: tracking_number,
      })
      .eq("id", shipment.return_request_id);

    console.log("✅ Tracking saved successfully");

    // 3️⃣ Response to frontend
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          shipment_id: shipment.id,
          tracking_number,
          status: "in_transit",
          return_code: shipment.return_code,
        },
      }),
    };
  } catch (error) {
    console.error("Unexpected error:", error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: "Internal server error: " + error.message,
      }),
    };
  }
}
