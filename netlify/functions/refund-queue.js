// GET /api/refund-queue
// Returns return shipments whose parent return_request prefers refund
// and are in statuses that need refund handling.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const DEFAULT_STATUSES = ["approved", "refund_processing"];

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: "Method not allowed - use GET" }),
    };
  }

  try {
    const url = new URL(event.rawUrl);
    const statusParams = url.searchParams.getAll("status"); // allow ?status=approved&status=refund_processing
    const statuses = statusParams.length ? statusParams : DEFAULT_STATUSES;

    const { data, error } = await supabase
      .from("return_shipments")
      .select(
        `
        *,
        return_request:return_requests!inner(
          id,
          order_id,
          order_number,
          customer_name,
          customer_email,
          preferred_resolution,
          reason_code,
          reason_note,
          images,
          status,
          hub_id,
          created_at,
          updated_at
        )
      `
      )
      .eq("return_request.preferred_resolution", "refund")
      .in("status", statuses)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Refund queue query error:", error);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Failed to fetch refund queue: " + error.message,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: data || [],
        count: data?.length || 0,
        statuses,
      }),
    };
  } catch (err) {
    console.error("Refund queue unexpected error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: "Internal server error: " + err.message,
      }),
    };
  }
}
