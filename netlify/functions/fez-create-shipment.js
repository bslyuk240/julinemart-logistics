// Fez Delivery - Create Shipment Function (WORKS WITH BOTH FEZ_PASSWORD AND FEZ_API_KEY)

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

// ------------------------------------------------------
// AUTHENTICATE FEZ
// ------------------------------------------------------
async function authenticateFez() {
  const FEZ_USER_ID = process.env.FEZ_USER_ID;
  // ✅ FIXED: Support BOTH FEZ_PASSWORD and FEZ_API_KEY
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
  console.log("FEZ AUTH RESPONSE:", data);

  if (data.status !== "Success") {
    throw new Error(data.description || "Fez authentication failed");
  }

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails["secret-key"],
    baseUrl: FEZ_API_BASE_URL
  };
}

// ------------------------------------------------------
// CREATE SHIPMENT ON FEZ (Handles false error responses)
// ------------------------------------------------------
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
  console.log("FEZ ORDER RESPONSE:", data);

  // ✅ FIXED: Return BOTH Order ID and Tracking Number
  // If FEZ says Success -> perfect
  if (data.status === "Success") {
    const orderId = Object.values(data.orderNos)[0]; // ROY625112539
    const trackingId = Object.keys(data.orderNos)[0]; // ed2f5924-... 
    return { 
      orderId,      // The one customers see on Fez
      trackingId    // The UUID for tracking
    };
  }

  // If FEZ says ERROR but orderNos contains data -> treat as success
  if (data.orderNos && Object.keys(data.orderNos).length > 0) {
    console.log("FEZ FALSE ERROR – ORDER ACTUALLY CREATED.");
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    return { orderId, trackingId };
  }

  // Real error
  throw new Error(data.description || "Error creating orders");
}

// ------------------------------------------------------
// HANDLER
// ------------------------------------------------------
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

    // ✅ FIXED: Items are stored as JSONB in sub_orders.items column
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

    console.log("SUB-ORDER FETCHED:", {
      id: subOrder.id,
      itemsRaw: subOrder.items,
      itemCount: Array.isArray(subOrder.items) ? subOrder.items.length : 0
    });

    // ----------------------------------------------
    // PREVENT DUPLICATE SHIPMENTS
    // ----------------------------------------------
    if (subOrder.tracking_number) {
      console.log("Shipment already exists:", subOrder.tracking_number);

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

    // ----------------------------------------------
    // FEZ AUTH
    // ----------------------------------------------
    const { authToken, secretKey, baseUrl } = await authenticateFez();

    // ✅ FIXED: Items are stored as JSONB in sub_orders.items
    // Handle both parsed JSON array and JSON string
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
    
    console.log("ITEMS TO SHIP:", items);

    const totalWeight = items.reduce(
      (sum, i) => sum + (Number(i.weight || 0) * Number(i.quantity || 1)),
      0
    );

    const shippingValue = Math.round(
      Number(subOrder.real_shipping_cost ?? subOrder.allocated_shipping_fee ?? subOrder.shipping_fee_paid ?? 0) + 1000
    );

    // Build shipment
    const shipmentData = {
      recipientAddress: subOrder.orders?.delivery_address || "",
      recipientState: subOrder.orders?.delivery_state || "",
      recipientName: subOrder.orders?.customer_name || "",
      recipientPhone: subOrder.orders?.customer_phone || "",
      recipientEmail: subOrder.orders?.customer_email || "",
      uniqueID: subOrder.id, // FEZ unique ID
      BatchID: subOrder.orders?.id || subOrder.id,
      itemDescription: items.map(i => `${i.quantity}x ${i.name}`).join(", "),
      valueOfItem: String(shippingValue),
      weight: Math.max(1, Math.round(totalWeight)),
      pickUpAddress: subOrder.hubs?.address || "",
      pickUpState: subOrder.hubs?.state || "",
      additionalDetails: `Hub: ${subOrder.hubs?.name}, ${subOrder.hubs?.city}`
    };

    console.log("FINAL SHIPMENT SENT TO FEZ:", shipmentData);

    // ✅ FIXED: Get both Order ID and Tracking ID
    const { orderId, trackingId } = await createFezShipment(
      authToken,
      secretKey,
      baseUrl,
      shipmentData
    );

    console.log("FEZ SHIPMENT CREATED:", { orderId, trackingId });

    // ✅ FIXED: Update suborder with BOTH IDs
    const { data: updatedRows, error: updateError } = await supabase
      .from("sub_orders")
      .update({
        tracking_number: orderId,           // ROY625112539 (customer-facing)
        courier_shipment_id: trackingId,    // ed2f5924-... (internal tracking)
        courier_waybill: orderId,
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
      console.error("Sub-order update returned empty data");
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Sub-order not found when saving tracking number"
        })
      };
    }

    // Log activity
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          tracking_number: orderId,          // Customer-facing number
          courier_shipment_id: trackingId,   // Internal tracking ID
          courier_tracking_url: `https://b2b-dev.fezdelivery.co/dashboard/print-manifest`,
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
        error: "Failed to create shipment",
        message: error.message
      })
    };
  }
};