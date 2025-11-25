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

// Create shipment on FEZ, handling the "order already exists" false errors
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

  // Normal success
  if (data.status === "Success") {
    const orderId = Object.values(data.orderNos || {})[0];
    const trackingId = Object.keys(data.orderNos || {})[0];
    return { orderId, trackingId };
  }

  // False errors with orderNos populated (duplicates etc.)
  if (data.orderNos && Object.keys(data.orderNos || {}).length > 0) {
    const trackingId = Object.keys(data.orderNos || {})[0];
    let orderId = Object.values(data.orderNos || {})[0];

    if (typeof orderId === "string" && orderId.toLowerCase().includes("already exists")) {
      const match = orderId.match(/order\s+([A-Za-z0-9_-]+)/i);
      if (match) orderId = match[1];
    }

    if (typeof orderId === "string" && orderId.toLowerCase().includes("error") && !String(orderId).match(/order\s+[A-Za-z0-9_-]+/i)) {
      throw new Error(orderId);
    }

    console.log("FEZ FALSE ERROR - ORDER ACTUALLY CREATED.");
    return { orderId, trackingId };
  }

  // Real error
  throw new Error(data.description || "Error creating orders");
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

    // Already has a shipment
    if (subOrder.courier_shipment_id) {
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

    console.log("FINAL SHIPMENT SENT TO FEZ:", shipmentData);

    const { orderId, trackingId } = await createFezShipment(
      authToken,
      secretKey,
      baseUrl,
      shipmentData
    );

    // Update suborder with returned IDs
    const { data: updatedRows, error: updateError } = await supabase
      .from("sub_orders")
      .update({
        tracking_number: orderId,
        courier_shipment_id: trackingId,
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          tracking_number: orderId,
          courier_shipment_id: trackingId,
          courier_tracking_url: `${baseUrl}/order/track/${trackingId || orderId}`,
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
