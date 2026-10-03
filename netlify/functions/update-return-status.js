// Admin manual status update for return shipments (DROP-OFF ONLY CLEAN FLOW)
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { requireAdmin } from './services/global-sourcing-utils.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL || "", SERVICE_KEY || "");

// ------------------------------
// VALID STATUSES FOR MANUAL ADMIN UPDATES
// ------------------------------
const ALLOWED_ADMIN_STATUSES = new Set([
  "awaiting_tracking",
  "in_transit",
  "delivered_to_hub",
  "inspection_in_progress",
  "approved",
  "rejected",
  "refund_processing",
  "refund_completed",
  "completed",
]);

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflightResponse();

  if (event.httpMethod !== "PATCH") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  // Staff only. This is the "admin manual status update" but had no login:
  // anyone with a shipment id could walk a return through approved,
  // refund_completed and completed. updated_by now comes from the verified
  // login instead of the request body, which could be spoofed.
  const auth = await requireAdmin(event, ["admin", "agent"]);
  if (auth.errorResponse) {
    return { ...auth.errorResponse, headers: { ...auth.errorResponse.headers, ...corsHeaders() } };
  }

  // Extract shipment id from path
  const parts = event.path.split("/");
  const id = parts[parts.findIndex((p) => p === "return-shipments") + 1];

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const status = body.status;
    const adminUserId = auth.authUser?.id || null;

    // --------------------------
    // VALIDATE STATUS
    // --------------------------
    if (!status || !ALLOWED_ADMIN_STATUSES.has(status)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: `Invalid status '${status}'. This endpoint only accepts: ${[
            ...ALLOWED_ADMIN_STATUSES,
          ].join(", ")}`,
        }),
      };
    }

    // Fetch shipment
    const { data: shipment, error: fetchErr } = await supabase
      .from("return_shipments")
      .select("id, return_request_id, status")
      .eq("id", id)
      .single();

    if (fetchErr || !shipment) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: "Return shipment not found" }),
      };
    }

    // --------------------------
    // SAFETY: PREVENT IMPOSSIBLE STATUS JUMPS
    // --------------------------
    const previousStatus = shipment.status;

    const validTransitions = {
      awaiting_tracking: ["in_transit"],
      in_transit: ["delivered_to_hub"],
      delivered_to_hub: ["inspection_in_progress"],
      inspection_in_progress: ["approved", "rejected", "completed"],
      approved: ["refund_processing", "completed"],
      refund_processing: ["refund_completed"],
      refund_completed: ["completed"],
      rejected: ["completed"],
      completed: [], // final state
    };

    if (!validTransitions[previousStatus]?.includes(status)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: `Invalid status transition: cannot move from '${previousStatus}' to '${status}'.`,
        }),
      };
    }

    // --------------------------
    // UPDATE SHIPMENT STATUS
    // --------------------------
    const { data: updated, error: updateErr } = await supabase
      .from("return_shipments")
      .update({
        status,
        updated_by: adminUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateErr) throw updateErr;

    // --------------------------
    // UPDATE PARENT RETURN REQUEST
    // --------------------------
    if (shipment.return_request_id) {
      await supabase
        .from("return_requests")
        .update({
          status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.return_request_id);
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, data: updated }),
    };
  } catch (error) {
    console.error("update-return-status error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message || "Internal error",
      }),
    };
  }
}
