// Get the signed-in customer's returns for one order.
// GET /api/orders/:orderId/returns  (or /returns-by-order/:orderId, or ?order_id=)
//
// Requires the customer's login and that the order belongs to them. This used
// to return any order's returns to anyone, by order id alone.
import { supabase, fetchSupabaseOrder } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateCustomer } from './services/customerAuth.js';

function orderIdFromEvent(event) {
  const parts = String(event.path || "").split("/").filter(Boolean);
  for (const marker of ["orders", "returns-by-order"]) {
    const idx = parts.indexOf(marker);
    if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
  }
  return event.queryStringParameters?.order_id || null;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflightResponse();

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  const { email, error: authError } = await authenticateCustomer(event);
  if (authError) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Sign in required" }),
    };
  }

  try {
    const orderId = orderIdFromEvent(event);
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

    // Resolve the order (Supabase UUID or legacy order number) and check it is
    // the caller's. Not found and not yours get the same empty answer, so order
    // ids can't be probed.
    let order = null;
    try {
      order = await fetchSupabaseOrder(orderId);
    } catch {
      order = null;
    }
    const owned = order && String(order.customer_email || "").trim().toLowerCase() === email;
    if (!owned) {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ success: true, data: [] }),
      };
    }

    // supabase_order_id is the order's UUID, which is what return requests
    // are created with (returns-create).
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
      .eq("supabase_order_id", order.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

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
