// GET /api/returns/:id/tracking  (DROP-OFF ONLY FLOW)
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
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

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  try {
    console.log("=== GET RETURN TRACKING ===");

    // ---------------------------
    // Extract return_request_id
    // ---------------------------
    let returnRequestId = null;

    // Query parameter
    if (event.queryStringParameters?.return_request_id) {
      returnRequestId = event.queryStringParameters.return_request_id;
    }

    // Netlify path parameters
    if (!returnRequestId && event.pathParameters?.id) {
      returnRequestId = event.pathParameters.id;
    }

    // Manual path parsing
    if (!returnRequestId) {
      const cleanPath = event.path.split("?")[0];
      const parts = cleanPath.split("/").filter(Boolean);
      const idx = parts.indexOf("returns");
      if (idx !== -1 && parts[idx + 1]) {
        returnRequestId = parts[idx + 1];
      }
    }

    if (!returnRequestId || returnRequestId === "tracking") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Return request ID required",
          hint: "Use: /api/returns/{return_request_id}/tracking"
        }),
      };
    }

    console.log("Looking up shipment for return_request_id:", returnRequestId);

    // ---------------------------
    // Fetch associated shipment
    // ---------------------------
    const { data: shipment, error: shipError } = await supabase
      .from("return_shipments")
      .select("*")
      .eq("return_request_id", returnRequestId)
      .maybeSingle();

    if (shipError) {
      console.error("Database error:", shipError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Failed to fetch tracking",
          details: { message: shipError.message }
        }),
      };
    }

    if (!shipment) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Return shipment not found",
          details: { return_request_id: returnRequestId }
        }),
      };
    }

    // ---------------------------
    // CASE 1: Awaiting customer tracking submission
    // ---------------------------
    if (!shipment.fez_tracking) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          data: {
            return_code: shipment.return_code,
            return_request_id: shipment.return_request_id,
            return_shipment_id: shipment.id,
            shipment_id: shipment.id,
            tracking_number: null,
            status: shipment.status || "awaiting_tracking",
            submitted_at: null,
            events: [],
            message: "Awaiting customer tracking number"
          }
        }),
      };
    }

    // ---------------------------
    // CASE 2: Customer submitted tracking (Drop-off only)
    // ---------------------------
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: {
          return_code: shipment.return_code,
          return_request_id: shipment.return_request_id,
          return_shipment_id: shipment.id,
          shipment_id: shipment.id,
          tracking_number: shipment.fez_tracking,
          status: shipment.status,
          submitted_at: shipment.tracking_submitted_at,
          events: [
            {
              status: "Tracking number submitted",
              date: shipment.tracking_submitted_at,
              location: "Customer Drop-off"
            }
          ]
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
        error: "Internal server error",
        details: { message: error.message }
      }),
    };
  }
}
