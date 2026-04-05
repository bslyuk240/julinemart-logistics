// refund-queue.js
// Fetches return shipments enriched with Supabase order payment data

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

const DEFAULT_STATUSES = ["approved", "refund_processing", "refund_completed"];

/**
 * Fetch Supabase order payment data by UUID or WC order ID
 */
async function fetchOrderPaymentData(supabaseOrderId, legacyWcOrderId) {
  try {
    let query = supabase
      .from("orders")
      .select("id, order_number, payment_method, payment_reference, paid_at, total_amount, customer_email, customer_name");

    if (supabaseOrderId) {
      query = query.eq("id", supabaseOrderId);
    } else if (legacyWcOrderId) {
      query = query.eq("woocommerce_order_id", String(legacyWcOrderId));
    } else {
      return null;
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (error) {
    console.error("Error fetching Supabase order:", error.message);
    return null;
  }
}

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
    const statusParams = url.searchParams.getAll("status");
    const statuses = statusParams.length ? statusParams : DEFAULT_STATUSES;

    // Fetch return shipments with return requests
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
          refund_amount,
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

    // Enrich with Supabase order payment data
    console.log(`📦 Enriching ${data.length} refund queue items with Supabase payment data...`);

    const enrichedData = await Promise.all(
      data.map(async (item) => {
        const returnRequest = item.return_request;

        // Prefer supabase_order_id, fall back to legacy WC order_id
        const supabaseOrderId = returnRequest?.supabase_order_id || null;
        const legacyOrderId = returnRequest?.order_id || null;

        if (!supabaseOrderId && !legacyOrderId) {
          console.warn(`⚠️ Return shipment ${item.id} has no order reference`);
          return { ...item, order_payment: null };
        }

        const orderData = await fetchOrderPaymentData(supabaseOrderId, legacyOrderId);

        if (!orderData) {
          console.warn(`⚠️ Could not fetch order for return shipment ${item.id}`);
          return { ...item, order_payment: null };
        }

        const isPaystackPayment =
          (orderData.payment_method || '').toLowerCase().includes('paystack') ||
          (orderData.payment_method || '').toLowerCase() === 'card' ||
          Boolean(orderData.payment_reference?.startsWith('JLO-'));

        console.log(`💳 Order #${orderData.order_number}: method=${orderData.payment_method}, ref=${orderData.payment_reference}, isPaystack=${isPaystackPayment}`);

        return {
          ...item,
          order_payment: {
            id: orderData.id,
            order_number: orderData.order_number,
            total: orderData.total_amount,
            payment_method: orderData.payment_method,
            transaction_id: orderData.payment_reference,
            is_paystack_payment: isPaystackPayment,
            paid_at: orderData.paid_at,
            customer_email: orderData.customer_email,
            customer_name: orderData.customer_name,
          },
        };
      })
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        data: enrichedData || [],
        count: enrichedData?.length || 0,
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