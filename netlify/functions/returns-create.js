// Create Return Request + Fez return shipment
import { supabase, fetchWooOrder, validateReturnWindow, generateReturnCode, createFezReturnPickup, uploadReturnImages } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      order_id,
      wc_customer_id,
      customer_email,
      customer_name,
      preferred_resolution,
      reason_code,
      reason_note,
      images = [],
      method,
      customer,
      hub,
    } = body;

    if (!order_id || !preferred_resolution || !reason_code || !method) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'order_id, preferred_resolution, reason_code, method required' }) };
    }
    if (!['pickup', 'dropoff'].includes(method)) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'method must be pickup or dropoff' }) };
    }

    // Woo validation
    const order = await fetchWooOrder(order_id);
    if (wc_customer_id && Number(order.customer_id) !== Number(wc_customer_id)) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Order does not belong to customer' }) };
    }
    if (customer_email && order.billing?.email && order.billing.email.toLowerCase() !== customer_email.toLowerCase()) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Order email mismatch' }) };
    }
    const windowDays = Number(process.env.RETURN_WINDOW_DAYS || 14);
    if (!validateReturnWindow(order, windowDays)) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: `Return window exceeded (${windowDays} days)` }) };
    }

    const returnCode = generateReturnCode();
    let fezTracking = null;
    let shipmentStatus = method === 'pickup' ? 'pickup_scheduled' : 'awaiting_dropoff';

    // Create Fez shipment for pickup
    if (method === 'pickup') {
      if (!customer?.address || !customer?.state || !hub?.address || !hub?.state) {
        return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'customer.address/state and hub.address/state required for pickup' }) };
      }
    }

    // Insert return_request first (images will be uploaded after to ensure we have request.id)
    const { data: request, error: insertError } = await supabase
      .from('return_requests')
      .insert({
        order_id,
        order_number: order.number,
        wc_customer_id: wc_customer_id || order.customer_id,
        customer_email: customer_email || order.billing?.email,
        customer_name: customer_name || `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim(),
        preferred_resolution,
        reason_code,
        reason_note,
        images: [],
        status: 'requested',
        fez_method: method,
      })
      .select('*')
      .single();

    if (insertError || !request) {
      throw insertError || new Error('Failed to create return request');
    }

    let finalImages = [];
    try {
      finalImages = await uploadReturnImages(images || [], request.id);
      if (finalImages.length) {
        await supabase.from('return_requests').update({ images: finalImages }).eq('id', request.id);
      }
    } catch (err) {
      console.error('Return images upload failed:', err);
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Failed to upload images' }) };
    }

    if (method === 'pickup') {
      try {
        const result = await createFezReturnPickup({ returnCode, returnRequestId: request.id, customer, hub });
        fezTracking = result.tracking;
        shipmentStatus = 'pickup_scheduled';
      } catch (err) {
        console.error('Fez return creation failed:', err);
        return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ success: false, error: err.message || 'Fez return creation failed' }) };
      }
    }

    // Save shipment row
    const { data: shipment, error: shipErr } = await supabase
      .from('return_shipments')
      .insert({
        return_request_id: request.id,
        return_code: returnCode,
        fez_tracking: fezTracking,
        method,
        status: shipmentStatus,
        raw_payload: { customer, hub },
      })
      .select('*')
      .single();

    if (shipErr) {
      console.error('Return shipment insert error:', shipErr);
    }

    // Update request with fez fields
    await supabase
      .from('return_requests')
      .update({
        fez_tracking: fezTracking,
        fez_method: method,
        fez_shipment_id: shipment?.id || null,
        status: method === 'pickup' ? 'pickup_scheduled' : 'requested',
      })
      .eq('id', request.id);

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: { return_request: { ...request, images: finalImages }, shipment },
      }),
    };
  } catch (error) {
    console.error('returns-create error:', error);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
