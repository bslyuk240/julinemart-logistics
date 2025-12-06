// Create Return Request (DROP-OFF ONLY)
import { 
  supabase, 
  fetchWooOrder, 
  validateReturnWindow, 
  generateReturnCode, 
  uploadReturnImages 
} from './services/returns-utils.js';

import { corsHeaders, preflightResponse } from './services/cors.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const {
      order_id,
      preferred_resolution,
      reason_code,
      reason_note,
      images = [],
      hub_id,
      method // client MUST send "dropoff", others blocked
    } = body;

    // 🛑 Hard enforce DROP-OFF only
    if (!method || method !== "dropoff") {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: "Only 'dropoff' return method is supported at this time."
        })
      };
    }

    if (!order_id || !preferred_resolution || !reason_code || !hub_id) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: 'order_id, preferred_resolution, reason_code, hub_id are required'
        })
      };
    }

    // 🟦 WooCommerce validation
    const order = await fetchWooOrder(order_id);
    const windowDays = Number(process.env.RETURN_WINDOW_DAYS || 14);

    if (!validateReturnWindow(order, windowDays)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: `Return window exceeded (${windowDays} days)`
        })
      };
    }

    const billing = order?.billing || {};
    const customerName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || 'Return Customer';

    const { data: hubRecord, error: hubErr } = await supabase
      .from("hubs")
      .select("id, name, phone, address, city, state")
      .eq("id", hub_id)
      .single();

    if (hubErr || !hubRecord) {
      return {
        statusCode: 404,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: "Hub not found" })
      };
    }

    // 🚀 Drop-off: always start in awaiting_tracking
    const initialStatus = "awaiting_tracking";
    const fezTracking = null;
    const fezShipmentId = null;

    const returnCode = generateReturnCode();

    // Insert into return_requests
    const { data: request, error: reqErr } = await supabase
      .from("return_requests")
      .insert({
        order_id,
        order_number: order.number,
        wc_customer_id: order.customer_id,
        customer_email: billing.email,
        customer_name: customerName,
        hub_id,
        preferred_resolution,
        reason_code,
        reason_note,
        images: [],
        status: initialStatus,
        fez_method: "dropoff", // force-dropoff
        fez_tracking: fezTracking,
        fez_shipment_id: fezShipmentId
      })
      .select("*")
      .single();

    if (reqErr) throw reqErr;

    // Upload images
    let finalImages = [];
    try {
      finalImages = await uploadReturnImages(images || [], request.id);
      if (finalImages.length) {
        await supabase
          .from("return_requests")
          .update({ images: finalImages })
          .eq("id", request.id);
      }
    } catch (err) {
      console.error("Image upload failed:", err);
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: "Failed to upload images"
        })
      };
    }

    // Insert return_shipment (drop-off only)
    const { data: shipment, error: shipErr } = await supabase
      .from("return_shipments")
      .insert({
        return_request_id: request.id,
        return_code: returnCode,
        method: "dropoff",
        status: initialStatus,
        fez_tracking: fezTracking,
        fez_shipment_id: fezShipmentId,
        raw_payload: null,
        customer_submitted_tracking: false,
        tracking_submitted_at: null
      })
      .select("*")
      .single();

    if (shipErr) {
      // rollback request
      await supabase.from("return_requests").delete().eq("id", request.id);
      throw new Error("Failed to create return shipment");
    }

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: {
          return_request: {
            ...request,
            images: finalImages,
            return_code: returnCode,
            fez_tracking: fezTracking,
            hub_id
          },
          return_shipment: shipment
        }
      })
    };

  } catch (error) {
    console.error("returns-create error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
}
