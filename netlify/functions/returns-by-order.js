// Get returns for a specific order (by Woo order id)
import { supabase } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflightResponse();

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  try {
    // -------------------------
    // Extract order_id from path
    // -------------------------
    const parts = event.path.split("/");
    const idx = parts.findIndex((p) => p === "orders");
    const orderId = idx >= 0 ? parts[idx + 1] : null;

    if (!orderId) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: "order_id required in path",
          example: "/api/orders/1234/returns",
        }),
      };
    }

    // -------------------------
    // Query matching return requests
    // -------------------------
    const { data, error } = await supabase
      .from("return_requests")
      .select(`
        *,
        return_shipments: return_shipments!inner (
          id,
          return_code,
          status,
          fez_tracking,
          tracking_submitted_at,
          method
        )
      `)
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // -------------------------
    // Normalize API response
    // -------------------------
    const formatted = (data || []).map((req) => {
      const shipment = req.return_shipments;

      return {
        return_request_id: req.id,
        return_shipment_id: shipment?.id,
        order_id: req.order_id,
        order_number: req.order_number,
        status: req.status,
        method: "dropoff", // fixed based on new logic
        hub_id: req.hub_id,
        reason_code: req.reason_code,
        reason_note: req.reason_note,
        preferred_resolution: req.preferred_resolution,
        images: req.images || [],
        created_at: req.created_at,

        // Shipment info
        return_code: shipment?.return_code || null,
        tracking_number: shipment?.fez_tracking || null,
        tracking_submitted_at: shipment?.tracking_submitted_at || null,
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: formatted,
      }),
    };
  } catch (error) {
    console.error("returns-by-order error:", error);

    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message || "Internal server error",
      }),
    };
  }
}
