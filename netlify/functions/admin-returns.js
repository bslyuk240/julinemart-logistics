// Admin/Ops returns listing with optional filters (DROP-OFF NORMALIZED VERSION)
import { supabase } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';

function ensureAdmin(event) {
  // Simple header-based role guard
  const role = event.headers?.["x-user-role"] || event.headers?.["X-User-Role"];
  if (role && ["admin", "agent"].includes(role)) return true;
  return true; // Allow as fallback until full auth is hooked
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflightResponse();

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Method not allowed" })
    };
  }

  if (!ensureAdmin(event)) {
    return {
      statusCode: 401,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Unauthorized" })
    };
  }

  try {
    const url = new URL(event.rawUrl);
    const status = url.searchParams.get("status");
    const hubId = url.searchParams.get("hub_id");
    const method = url.searchParams.get("method"); // optional filter
    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);

    // ---------------------------
    // Query DB
    // ---------------------------
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
      `, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (hubId) query = query.eq("hub_id", hubId);
    if (method) query = query.eq("fez_method", method); // still works for dropoff

    const { data, error, count } = await query;
    if (error) throw error;

    // ---------------------------
    // Normalize for Admin Dashboard
    // ---------------------------
    const formatted = (data || []).map(req => {
      const s = req.return_shipments;

      return {
        // REQUEST INFO
        return_request_id: req.id,
        order_id: req.order_id,
        order_number: req.order_number,
        status: req.status,
        hub_id: req.hub_id,
        customer_name: req.customer_name,
        customer_email: req.customer_email,
        reason_code: req.reason_code,
        reason_note: req.reason_note,
        preferred_resolution: req.preferred_resolution,
        images: req.images || [],
        created_at: req.created_at,

        // SHIPMENT INFO
        return_shipment_id: s?.id,
        return_code: s?.return_code,
        tracking_number: s?.fez_tracking || null,
        tracking_submitted_at: s?.tracking_submitted_at || null,
        shipment_status: s?.status,
        method: "dropoff", // forced for consistency
      };
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: formatted,
        pagination: { total: count || 0, limit, offset }
      })
    };

  } catch (error) {
    console.error("admin-returns error:", error);

    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message || "Internal error"
      })
    };
  }
}
