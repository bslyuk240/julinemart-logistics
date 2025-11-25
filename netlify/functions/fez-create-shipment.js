// Fez Delivery - Create Shipment Function (Final Stable Version)

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
  const FEZ_PASSWORD = process.env.FEZ_PASSWORD;
  const FEZ_API_BASE_URL = process.env.FEZ_API_BASE_URL;

  if (!FEZ_USER_ID || !FEZ_PASSWORD || !FEZ_API_BASE_URL) {
    throw new Error("Missing Fez API environment variables");
  }

  const res = await fetch(`${FEZ_API_BASE_URL}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: FEZ_USER_ID,
      password: FEZ_PASSWORD
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

  // If FEZ says Success -> perfect
  if (data.status === "Success") {
    const trackingNumber = Object.values(data.orderNos)[0];
    return { trackingNumber };
  }

  // If FEZ says ERROR but orderNos contains data -> treat as success
  if (data.orderNos && Object.keys(data.orderNos).length > 0) {
    console.log("FEZ FALSE ERROR – ORDER ACTUALLY CREATED.");
    const trackingNumber = Object.keys(data.orderNos)[0];
    return { trackingNumber };
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

    // Fetch suborder
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

    if (error || !subOrder) throw new Error("Sub-order not found");

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

    // Items
    const items = Array.isArray(subOrder.items) ? subOrder.items : [];
    const totalWeight = items.reduce(
      (sum, i) => sum + (Number(i.weight || 0) * Number(i.quantity || 1)),
      0
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
      valueOfItem: String(Math.round((subOrder.shipping_cost || 0) + 1000)),
      weight: Math.max(1, Math.round(totalWeight)),
      pickUpAddress: subOrder.hubs?.address || "",
      pickUpState: subOrder.hubs?.state || "",
      additionalDetails: `Hub: ${subOrder.hubs?.name}, ${subOrder.hubs?.city}`
    };

    console.log("FINAL SHIPMENT SENT TO FEZ:", shipmentData);

    // Create shipment
    const { trackingNumber } = await createFezShipment(
      authToken,
      secretKey,
      baseUrl,
      shipmentData
    );

    // Update suborder
    const { error: updateError } = await supabase
      .from("sub_orders")
      .update({
        tracking_number: trackingNumber,
        courier_waybill: trackingNumber,
        status: "pending_pickup"
      })
      .eq("id", subOrderId);

    if (updateError) {
      throw updateError;
    }

    // Log activity
    await supabase.from("activity_logs").insert({
      user_id: null,
      action: "courier_shipment_created",
      resource_type: "sub_order",
      resource_id: subOrderId,
      details: { courier: "fez", tracking: trackingNumber }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          tracking_number: trackingNumber,
          courier_tracking_url: `${baseUrl}/order/track/${trackingNumber}`,
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
