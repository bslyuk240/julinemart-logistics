// Fez Delivery - Create Shipment Function (Netlify ENV Version)

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

// ---------------- AUTHENTICATE WITH FEZ ----------------
async function authenticateFez() {
  const apiUser = process.env.FEZ_USER_ID;
  const apiPassword = process.env.FEZ_PASSWORD;
  const baseUrl = process.env.FEZ_API_BASE_URL;

  if (!apiUser || !apiPassword || !baseUrl) {
    throw new Error("Missing Fez API environment variables");
  }

  const response = await fetch(`${baseUrl}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: apiUser,
      password: apiPassword
    })
  });

  const data = await response.json();

  console.log("FEZ AUTH RESPONSE:", data);

  if (data.status !== "Success") {
    throw new Error(data.description || "Fez authentication failed");
  }

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails["secret-key"],
    baseUrl
  };
}

// ---------------- CREATE SHIPMENT ON FEZ ----------------
async function createFezShipment(authToken, secretKey, baseUrl, shipmentData) {
  const response = await fetch(`${baseUrl}/order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
      "secret-key": secretKey
    },
    body: JSON.stringify([shipmentData])
  });

  const data = await response.json();

  console.log("FEZ ORDER RESPONSE:", data); // 🔥 FULL DEBUG LOG

  if (data.status !== "Success") {
    throw new Error(data.description || "Error creating orders");
  }

  const trackingNumber = Object.values(data.orderNos)[0];

  return {
    trackingNumber,
    orderNos: data.orderNos
  };
}

// ---------------- MAIN HANDLER ----------------
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

    // ---------------- FETCH SUB ORDER ----------------
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
          delivery_state,
          total_amount
        ),
        hubs (
          name,
          address,
          city,
          state,
          phone
        )
      `)
      .eq("id", subOrderId)
      .single();

    if (error || !subOrder) throw new Error("Sub-order not found");

    // ---------------- AUTH WITH FEZ ----------------
    const { authToken, secretKey, baseUrl } = await authenticateFez();

    // ---------------- BUILD SHIPMENT DATA ----------------
    const items = Array.isArray(subOrder.items) ? subOrder.items : [];

    const totalWeight = items.reduce(
      (sum, i) => sum + (Number(i.weight || 0) * Number(i.quantity || 1)),
      0
    );

    const shipmentData = {
      recipientAddress: subOrder.orders?.delivery_address || "",
      recipientState: subOrder.orders?.delivery_state || "",
      recipientName: subOrder.orders?.customer_name || "",
      recipientPhone: subOrder.orders?.customer_phone || "",
      recipientEmail: subOrder.orders?.customer_email || "",
      uniqueID: subOrder.id,
      BatchID: subOrder.orders?.id || subOrder.id, // ✔ FEZ requires
      itemDescription: items.map(i => `${i.quantity}x ${i.name}`).join(", "),
      valueOfItem: String(Math.round((subOrder.shipping_cost || 0) + 1000)),
      weight: Math.max(1, Math.round(totalWeight)),
      pickUpAddress: subOrder.hubs?.address || "",
      pickUpState: subOrder.hubs?.state || "",
      additionalDetails: `Hub: ${subOrder.hubs?.name || ""}, ${subOrder.hubs?.city || ""}`
    };

    console.log("FINAL SHIPMENT SENT TO FEZ:", shipmentData);

    // ---------------- CREATE ON FEZ ----------------
    const result = await createFezShipment(authToken, secretKey, baseUrl, shipmentData);

    // ---------------- UPDATE SUB ORDER ----------------
    await supabase.from("sub_orders").update({
      tracking_number: result.trackingNumber,
      courier_shipment_id: result.trackingNumber,
      courier_tracking_url: `${baseUrl}/order/track/${result.trackingNumber}`,
      status: "pending_pickup",
      last_tracking_update: new Date().toISOString()
    }).eq("id", subOrderId);

    // ---------------- LOG ACTIVITY ----------------
    await supabase.from("activity_logs").insert({
      user_id: null,
      action: "courier_shipment_created",
      resource_type: "sub_order",
      resource_id: subOrderId,
      details: { courier: "fez", tracking: result.trackingNumber }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          tracking_number: result.trackingNumber,
          courier_tracking_url: `${baseUrl}/order/track/${result.trackingNumber}`,
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
