// Fez Delivery - Create Shipment Function

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

async function authenticateFez() {
  const FEZ_USER_ID = process.env.FEZ_USER_ID;
  const FEZ_API_KEY = process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;
  const FEZ_API_BASE_URL = process.env.FEZ_API_BASE_URL;

  if (!FEZ_USER_ID || !FEZ_API_KEY || !FEZ_API_BASE_URL) {
    throw new Error("Missing Fez API environment variables");
  }

  const res = await fetch(`${FEZ_API_BASE_URL}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: FEZ_USER_ID,
      password: FEZ_API_KEY
    })
  });

  const data = await res.json();
  console.log("FEZ AUTH RESPONSE:", JSON.stringify(data, null, 2));

  if (data.status !== "Success") {
    throw new Error(data.description || "Fez authentication failed");
  }

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails["secret-key"],
    baseUrl: FEZ_API_BASE_URL
  };
}

/**
 * Helper to check if a string looks like a valid Fez order number
 * Fez order numbers typically look like: FEZ-1764222679269-0ORIZK or JHAZ27012319
 */
function isValidFezOrderNumber(value) {
  if (!value || typeof value !== 'string') return false;
  
  // Check if it contains error indicators
  const errorIndicators = [
    'error',
    'cannot',
    'failed',
    'invalid',
    'wrong',
    'something went wrong',
    'already exists'
  ];
  
  const lowerValue = value.toLowerCase();
  for (const indicator of errorIndicators) {
    if (lowerValue.includes(indicator)) {
      return false;
    }
  }
  
  // Valid Fez order numbers are typically alphanumeric with dashes
  // They should be reasonably short (not an error message)
  return value.length < 50 && /^[A-Za-z0-9_-]+$/.test(value.trim());
}

/**
 * Extract order code from "already exists" messages
 * e.g., "Error - This order already exists. Order FEZ-123456" -> "FEZ-123456"
 */
function extractOrderCodeFromMessage(value) {
  if (!value || typeof value !== 'string') return null;
  
  // Try to extract order code from "already exists" message
  const match = value.match(/order\s+([A-Za-z0-9_-]+)/i);
  if (match && isValidFezOrderNumber(match[1])) {
    return match[1];
  }
  
  return null;
}

// Create shipment on FEZ with improved error handling
async function createFezShipment(authToken, secretKey, baseUrl, shipmentData) {
  const res = await fetch(`${baseUrl}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
      "secret-key": secretKey
    },
    body: JSON.stringify([shipmentData])
  });

  const data = await res.json();
  console.log("FEZ ORDER RESPONSE:", JSON.stringify(data, null, 2));

  // Case 1: Clean success response
  if (data.status === "Success" && data.orderNos) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    
    // Verify orderId is a valid tracking number, not an error
    if (isValidFezOrderNumber(orderId)) {
      console.log("✅ FEZ SUCCESS - Valid order created:", { orderId, trackingId });
      return { orderId, trackingId, success: true };
    }
    
    // orderId might be an error message even with "Success" status
    const extractedCode = extractOrderCodeFromMessage(orderId);
    if (extractedCode) {
      console.log("✅ FEZ SUCCESS - Extracted existing order:", { orderId: extractedCode, trackingId });
      return { orderId: extractedCode, trackingId, success: true };
    }
    
    // orderId is an error message - treat as failure
    console.error("❌ FEZ returned Success but orderId is invalid:", orderId);
    throw new Error(orderId || "Fez returned invalid order number");
  }

  // Case 2: Error response but with orderNos (might contain existing order info)
  if (data.orderNos && Object.keys(data.orderNos).length > 0) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    
    // Check if orderId is a valid order number
    if (isValidFezOrderNumber(orderId)) {
      console.log("⚠️ FEZ ERROR but order exists:", { orderId, trackingId });
      return { orderId, trackingId, success: true };
    }
    
    // Try to extract order code from "already exists" message
    const extractedCode = extractOrderCodeFromMessage(orderId);
    if (extractedCode) {
      console.log("⚠️ FEZ DUPLICATE - Extracted existing order:", { orderId: extractedCode, trackingId });
      return { orderId: extractedCode, trackingId, success: true };
    }
    
    // orderId is purely an error message
    console.error("❌ FEZ ERROR - Order creation failed:", orderId);
    throw new Error(orderId || data.description || "Failed to create order on Fez");
  }

  // Case 3: Pure error - no orderNos at all
  console.error("❌ FEZ ERROR - No order created:", data);
  throw new Error(data.description || data.message || "Error creating order on Fez Delivery");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: "Method not allowed" })
    };
  }

  try {
    const { subOrderId } = JSON.parse(event.body || "{}");

    if (!subOrderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: "subOrderId is required" })
      };
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: "Server missing Supabase configuration" })
      };
    }

    const { data: subOrder, error } = await supabase
      .from("sub_orders")
      .select(`
        *,
        orders (
          id,
          customer_name,
          customer_email,
          customer_phone,
          delivery_address,
          delivery_city,
          delivery_state
        ),
        hubs (
          name,
          address,
          city,
          state
        )
      `)
      .eq("id", subOrderId)
      .single();

    if (error || !subOrder) {
      console.error("Sub-order fetch error:", error);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: "Sub-order not found" })
      };
    }

    // Check if already has a VALID shipment (not an error message)
    if (subOrder.courier_shipment_id && isValidFezOrderNumber(subOrder.tracking_number)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            tracking_number: subOrder.tracking_number,
            courier_shipment_id: subOrder.courier_shipment_id,
            courier_tracking_url: subOrder.courier_tracking_url,
            message: "Shipment already exists. Returning saved tracking number."
          }
        })
      };
    }

    // Parse items (JSONB or string)
    let items = [];
    if (Array.isArray(subOrder.items)) {
      items = subOrder.items;
    } else if (typeof subOrder.items === 'string') {
      try {
        items = JSON.parse(subOrder.items);
      } catch (e) {
        console.error("Failed to parse items JSON:", e);
        items = [];
      }
    }

    const totalWeight = items.reduce(
      (sum, i) => sum + (Number(i.weight || 0) * Number(i.quantity || 1)),
      0
    );

    const itemsValue = items.reduce(
      (sum, i) => sum + (Number(i.price || 0) * Number(i.quantity || 1)),
      0
    );

    const shippingValue = Math.round(
      (itemsValue || Number(subOrder.real_shipping_cost ?? subOrder.allocated_shipping_fee ?? subOrder.shipping_fee_paid ?? 0)) + 1000
    );

    const { authToken, secretKey, baseUrl } = await authenticateFez();

    const shipmentData = {
      recipientAddress: subOrder.orders?.delivery_address || "",
      recipientState: subOrder.orders?.delivery_state || "",
      recipientName: subOrder.orders?.customer_name || "",
      recipientPhone: subOrder.orders?.customer_phone || "",
      recipientEmail: subOrder.orders?.customer_email || "",
      uniqueID: subOrder.id,
      BatchID: subOrder.orders?.id || subOrder.id,
      itemDescription: items.map(i => `${i.quantity}x ${i.name}`).join(", "),
      valueOfItem: String(shippingValue),
      weight: Math.max(1, Math.round(totalWeight)),
      pickUpAddress: subOrder.hubs?.address || "",
      pickUpState: subOrder.hubs?.state || "",
      additionalDetails: `Hub: ${subOrder.hubs?.name}, ${subOrder.hubs?.city}`
    };

    console.log("FINAL SHIPMENT SENT TO FEZ:", JSON.stringify(shipmentData, null, 2));

    // This will throw if Fez returns an error
    const { orderId, trackingId } = await createFezShipment(
      authToken,
      secretKey,
      baseUrl,
      shipmentData
    );

    // Double-check we have valid values before saving
    if (!isValidFezOrderNumber(orderId)) {
      console.error("Invalid orderId received:", orderId);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Fez returned invalid order number",
          details: orderId
        })
      };
    }

    // Build tracking URL
    const trackingUrl = `${baseUrl}/order/track/${orderId}`;

    // Update suborder with returned IDs
    const { data: updatedRows, error: updateError } = await supabase
      .from("sub_orders")
      .update({
        tracking_number: orderId,
        courier_shipment_id: trackingId,
        courier_waybill: orderId,
        courier_tracking_url: trackingUrl,
        status: "assigned"
      })
      .eq("id", subOrderId)
      .select("id")
      .single();

    if (updateError) {
      console.error("Sub-order update error:", updateError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Failed to save tracking number",
          details: updateError?.message,
          code: updateError?.code
        })
      };
    }

    if (!updatedRows?.id) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Sub-order not found when saving tracking number"
        })
      };
    }

    await supabase.from("activity_logs").insert({
      user_id: null,
      action: "courier_shipment_created",
      resource_type: "sub_order",
      resource_id: subOrderId,
      details: { 
        courier: "fez", 
        order_id: orderId,
        tracking_id: trackingId 
      }
    });

    console.log("✅ SHIPMENT CREATED SUCCESSFULLY:", { orderId, trackingId, trackingUrl });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          tracking_number: orderId,
          courier_shipment_id: trackingId,
          courier_tracking_url: trackingUrl,
          message: "Shipment created successfully on Fez Delivery"
        }
      })
    };

  } catch (error) {
    console.error("FEZ ERROR:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || "Failed to create shipment",
        message: error.message
      })
    };
  }
};