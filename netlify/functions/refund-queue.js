// ENHANCED refund-queue.js
// Fetches return shipments AND enriches with WooCommerce order payment data
// Location: netlify/functions/refund-queue.js

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// WooCommerce credentials
const WC_BASE_URL = process.env.NEXT_PUBLIC_WP_URL || process.env.WP_URL;
const WC_KEY = process.env.WC_KEY;
const WC_SECRET = process.env.WC_SECRET;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const DEFAULT_STATUSES = ["approved", "refund_processing", "refund_completed"];

/**
 * Fetch WooCommerce order to get payment details
 */
async function fetchWooOrder(orderId) {
  try {
    const auth = Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');
    const url = `${WC_BASE_URL}/wp-json/wc/v3/orders/${orderId}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch WooCommerce order ${orderId}:`, response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching WooCommerce order ${orderId}:`, error.message);
    return null;
  }
}

/**
 * Get Paystack transaction reference from order
 */
function getPaystackReference(order) {
  // First check meta_data for _paystack_reference
  const paystackMeta = order.meta_data?.find(m => m.key === '_paystack_reference');
  if (paystackMeta?.value) {
    return paystackMeta.value;
  }

  // Fall back to transaction_id
  if (order.transaction_id) {
    return order.transaction_id;
  }

  return null;
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

    // Enrich with WooCommerce payment data
    console.log(`📦 Enriching ${data.length} refund queue items with WooCommerce data...`);
    
    const enrichedData = await Promise.all(
      data.map(async (item) => {
        const returnRequest = item.return_request;
        const orderId = returnRequest?.order_id;

        if (!orderId) {
          console.warn(`⚠️ Return shipment ${item.id} has no order_id`);
          return { ...item, woo_order: null };
        }

        // Fetch WooCommerce order
        const wooOrder = await fetchWooOrder(orderId);

        if (!wooOrder) {
          console.warn(`⚠️ Could not fetch WooCommerce order ${orderId}`);
          return { ...item, woo_order: null };
        }

        // Extract payment information
        const paymentMethod = wooOrder.payment_method || '';
        const paymentMethodTitle = wooOrder.payment_method_title || '';
        const transactionId = getPaystackReference(wooOrder);

        // Check if this is a Paystack payment
        const isPaystackPayment = 
          paymentMethod === 'paystack' || 
          paymentMethod === 'card' ||
          paymentMethodTitle.toLowerCase().includes('paystack') ||
          paymentMethodTitle.toLowerCase().includes('card');

        console.log(`💳 Order #${orderId}: payment=${paymentMethod}, transaction=${transactionId}, isPaystack=${isPaystackPayment}`);

        return {
          ...item,
          woo_order: {
            id: wooOrder.id,
            number: wooOrder.number,
            status: wooOrder.status,
            total: wooOrder.total,
            payment_method: paymentMethod,
            payment_method_title: paymentMethodTitle,
            transaction_id: transactionId,
            is_paystack_payment: isPaystackPayment,
            billing: wooOrder.billing,
            date_created: wooOrder.date_created,
            date_paid: wooOrder.date_paid,
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