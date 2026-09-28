import { createClient } from '@supabase/supabase-js';
import { assertStaffCanCreateShipment } from './services/shipmentAccess.js';
import { executeFezCreateShipment } from './services/shipping/fezCreateCore.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

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
    const { subOrderId, force } = JSON.parse(event.body || "{}");

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

    const access = await assertStaffCanCreateShipment(event);
    if (!access.ok) {
      return { statusCode: access.statusCode, headers, body: access.body };
    }

    const result = await executeFezCreateShipment(supabase, { subOrderId, force });
    return {
      statusCode: result.statusCode,
      headers,
      body: JSON.stringify(
        result.ok
          ? { success: true, data: result.data }
          : { success: false, error: result.error, details: result.details }
      ),
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
