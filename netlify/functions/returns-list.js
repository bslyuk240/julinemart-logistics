// List returns for a customer (wc_customer_id or customer_email)
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
    const url = new URL(event.rawUrl);
    const wcCustomerId = url.searchParams.get("wc_customer_id");
    const email = url.searchParams.get("customer_email");

    if (!wcCustomerId && !email) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: "wc_customer_id or customer_email required",
        }),
      };
    }

    // -------------------------------
    // Query return requests + shipment
    // -------------------------------
    let query = supabase
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
      .order("created_at", { ascending: false });

    if (wcCustomerId) query = query.eq("wc_customer_id", wcCustomerId);
    if (email) query = query.eq("customer_email", email);

    // Optional: Filter out test rows with no order_id
    // query = query.not("order_id", "is", null);

    const { data, error } = await query;

    if (error) throw error;

    // -------------------------------
    // Normalize output for PWA
    // -------------------------------
    const formatted = (data || []).map((req) => {
      const shipment = req.return_shipments;

      return {
        return_request_id: req.id,
        return_shipment_id: shipment?.id,
        order_id: req.order_id,
        order_number: req.order_number,
        status: req.status,
        method: "dropoff",  // hardcoded based on new flow
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
      body: JSON.stringify({ success: true, data: formatted }),
    };
  } catch (error) {
    console.error("returns-list error:", error);
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
