// Fez Delivery - Create Return Shipment Function
// Uses same logic as fez-create-shipment.js but REVERSED (customer -> hub)
// This replaces the Supabase Edge Function proxy

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};

// Generate a shorter unique ID for Fez
function generateShortUniqueId(baseId) {
  const shortId = (baseId || 'RTN').slice(-8);
  const timestamp = Date.now().toString(36);
  return `JLO-${shortId}-${timestamp}`.toUpperCase();
}

// Generate return code
function generateReturnCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let code = "RTN-";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function authenticateFez() {
  const FEZ_USER_ID = process.env.FEZ_USER_ID;
  const FEZ_API_KEY = process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;
  const FEZ_API_BASE_URL = process.env.FEZ_API_BASE_URL;

  if (!FEZ_USER_ID || !FEZ_API_KEY || !FEZ_API_BASE_URL) {
    throw new Error("Missing Fez API environment variables");
  }

  console.log("Authenticating with Fez...");
  
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

function isValidFezOrderNumber(value) {
  if (!value || typeof value !== 'string') return false;
  
  const errorIndicators = [
    'error', 'cannot', 'failed', 'invalid', 'wrong', 
    'something went wrong', 'already exists'
  ];
  
  const lowerValue = value.toLowerCase();
  for (const indicator of errorIndicators) {
    if (lowerValue.includes(indicator)) return false;
  }
  
  return value.length < 50 && /^[A-Za-z0-9_-]+$/.test(value.trim());
}

function extractOrderCodeFromMessage(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/order\s+([A-Za-z0-9_-]+)/i);
  if (match && isValidFezOrderNumber(match[1])) {
    return match[1];
  }
  return null;
}

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

  if (data.status === "Success" && data.orderNos) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    
    if (isValidFezOrderNumber(orderId)) {
      console.log("✅ FEZ SUCCESS - Order created:", { orderId, trackingId });
      return { orderId, trackingId, success: true };
    }
    
    const extractedCode = extractOrderCodeFromMessage(orderId);
    if (extractedCode) {
      console.log("✅ FEZ SUCCESS - Extracted existing order:", { orderId: extractedCode, trackingId });
      return { orderId: extractedCode, trackingId, success: true };
    }
    
    console.error("❌ FEZ returned Success but orderId is invalid:", orderId);
    throw new Error(orderId || "Fez returned invalid order number");
  }

  if (data.orderNos && Object.keys(data.orderNos).length > 0) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    
    if (isValidFezOrderNumber(orderId)) {
      return { orderId, trackingId, success: true };
    }
    
    const extractedCode = extractOrderCodeFromMessage(orderId);
    if (extractedCode) {
      return { orderId: extractedCode, trackingId, success: true };
    }
    
    throw new Error(orderId || data.description || "Failed to create order on Fez");
  }

  throw new Error(data.description || data.message || "Error creating order on Fez Delivery");
}

export async function handler(event) {
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
    const body = JSON.parse(event.body || "{}");
    const { return_request_id, method, customer, hub } = body;

    // Validate required fields
    if (!return_request_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: "return_request_id is required" })
      };
    }

    if (!method || !['pickup', 'dropoff'].includes(method)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: "method must be 'pickup' or 'dropoff'" })
      };
    }

    const returnCode = generateReturnCode();
    let fezTracking = null;
    let status = "awaiting_dropoff";

    // For PICKUP method, create Fez shipment
    if (method === "pickup") {
      if (!customer || !customer.address || !customer.state) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: "customer with address and state is required for pickup" })
        };
      }

      if (!hub || !hub.address || !hub.state) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: "hub with address and state is required for pickup" })
        };
      }

      const uniqueId = generateShortUniqueId(return_request_id);

      // REVERSED from forwarding:
      // Forward: Hub (pickup) -> Customer (recipient)
      // Return:  Customer (pickup) -> Hub (recipient)
      const shipmentData = {
        // Recipient = HUB (where package goes TO)
        recipientAddress: hub.address || "",
        recipientState: hub.state || "Lagos",
        recipientName: hub.name || "JulineMart Hub",
        recipientPhone: hub.phone || "+2347075825761",
        recipientEmail: "",
        
        // Identifiers
        uniqueID: uniqueId,
        BatchID: returnCode,
        
        // Package info
        itemDescription: `Return package ${returnCode}`,
        valueOfItem: "1000",
        weight: 1,
        
        // Pickup = CUSTOMER (where Fez picks up FROM)
        pickUpAddress: customer.address || "",
        pickUpState: customer.state || "Lagos",
        
        // Additional details
        additionalDetails: `Return pickup from: ${customer.name || 'Customer'}, Phone: ${customer.phone || 'N/A'}`
      };

      console.log("RETURN SHIPMENT DATA:", JSON.stringify(shipmentData, null, 2));

      // Try up to 2 times (same as forwarding)
      let lastError = null;
      let result = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`\n=== FEZ RETURN API ATTEMPT ${attempt} ===`);
          
          const { authToken, secretKey, baseUrl } = await authenticateFez();
          
          if (attempt > 1) {
            console.log("Waiting 1 second before retry...");
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          result = await createFezShipment(authToken, secretKey, baseUrl, shipmentData);
          console.log(`✅ Attempt ${attempt} succeeded!`);
          break;
          
        } catch (err) {
          lastError = err;
          console.error(`❌ Attempt ${attempt} failed:`, err.message);
          
          if (attempt < 2) {
            console.log("Will retry...");
          }
        }
      }

      if (!result) {
        throw lastError || new Error("Failed to create return shipment after 2 attempts");
      }

      fezTracking = result.orderId;
      status = "pickup_scheduled";

      if (!isValidFezOrderNumber(fezTracking)) {
        console.error("Invalid fezTracking received:", fezTracking);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: "Fez returned invalid order number",
            details: fezTracking
          })
        };
      }
    }

    // Save to return_shipments table
    const { data: shipment, error: insertError } = await supabase
      .from("return_shipments")
      .insert({
        return_request_id,
        return_code: returnCode,
        method,
        fez_tracking: fezTracking,
        status
      })
      .select()
      .single();

    if (insertError) {
      console.error("DB insert error:", insertError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Failed to save return shipment",
          details: insertError.message
        })
      };
    }

    // Build tracking URL if we have a tracking number
    const trackingUrl = fezTracking 
      ? `https://web.fezdelivery.co/track-delivery?tracking=${fezTracking}`
      : null;

    // Log activity (ignore errors)
    try {
      await supabase.from("activity_logs").insert({
        user_id: null,
        action: "return_shipment_created",
        resource_type: "return_shipment",
        resource_id: shipment.id,
        details: { 
          courier: "fez", 
          return_code: returnCode,
          fez_tracking: fezTracking,
          method
        }
      });
    } catch (logErr) {
      console.warn("Activity log failed:", logErr);
    }

    console.log("✅ RETURN SHIPMENT CREATED:", { 
      return_code: returnCode, 
      fez_tracking: fezTracking, 
      method,
      shipment_id: shipment.id
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        data: {
          return_code: returnCode,
          fez_tracking: fezTracking,
          tracking_url: trackingUrl,
          method,
          status,
          shipment_id: shipment.id,
          message: method === "pickup" 
            ? "Return pickup scheduled successfully" 
            : "Return dropoff request created"
        }
      })
    };

  } catch (error) {
    console.error("RETURN SHIPMENT ERROR:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message || "Failed to create return shipment"
      })
    };
  }
}