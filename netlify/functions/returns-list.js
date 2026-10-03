// List the signed-in customer's returns.
// Requires the customer's login. The email comes from the verified login: this
// used to trust ?customer_email= / ?wc_customer_id=, so anyone could list any
// customer's returns (reasons, evidence photos, return codes, tracking).
import { supabase } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateCustomer } from './services/customerAuth.js';
import { returnSelect, formatReturnForCustomer } from './services/return-format.js';

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
    const url = new URL(event.rawUrl);
    const requestedEmail = (url.searchParams.get("customer_email") || "").trim().toLowerCase();

    // A caller may only ask for their own returns. wc_customer_id is ignored:
    // it can't be tied to the login, so it can't be trusted.
    if (requestedEmail && requestedEmail !== email) {
      return {
        statusCode: 403,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: "You can only view your own returns" }),
      };
    }

    // -------------------------------
    // Query return requests + shipment
    // -------------------------------
    // Left join: a request still pending review has no shipment yet (it's
    // created on approval) but the customer should still see it.
    let query = supabase
      .from("return_requests")
      .select(await returnSelect(supabase))
      .order("created_at", { ascending: false });

    query = query.eq("customer_email", email);

    // Optional: Filter out test rows with no order_id
    // query = query.not("order_id", "is", null);

    const { data, error } = await query;

    if (error) throw error;

    // -------------------------------
    // Normalize output for PWA
    // -------------------------------
    const formatted = (data || []).map(formatReturnForCustomer);

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
