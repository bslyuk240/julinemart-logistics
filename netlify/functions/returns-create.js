// Create Return Request + Fez return shipment
import { supabase, fetchWooOrder, validateReturnWindow, generateReturnCode, createFezReturnPickup, uploadReturnImages } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  // 🔥 FIX: Remove all forms of auth requirement for this route
  // This endpoint must NOT require Authorization header.
  // Your PWA has no tokens. Identity is validated using WooCommerce order lookup.
  // If any Authorization header exists, ignore it; if not, continue normally.
  // (This removes the source of the "Authorization token is missing" error.)

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      order_id,
      preferred_resolution,
      reason_code,
      reason_note,
      images = [],
      method,
      hub_id,
    } = body;

    if (!order_id || !preferred_resolution || !reason_code || !method || !hub_id) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'order_id, preferred_resolution, reason_code, method, hub_id required' }) };
    }
    if (!['pickup', 'dropoff'].includes(method)) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'method must be pickup or dropoff' }) };
    }

    // Woo validation
    const order = await fetchWooOrder(order_id);
    const windowDays = Number(process.env.RETURN_WINDOW_DAYS || 14);
    if (!validateReturnWindow(order, windowDays)) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: `Return window exceeded (${windowDays} days)` }) };
    }

    const billing = order?.billing || {};
    const customerName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim() || 'Return Customer';
    const customerEmail = billing.email || '';
    const customerPhone = billing.phone || '';
    const customerAddress = [billing.address_1, billing.address_2].filter(Boolean).join(', ') || '';
    const customerCity = billing.city || '';
    const customerState = billing.state || '';

    const { data: hubRecord, error: hubError } = await supabase
      .from('hubs')
      .select('id, name, phone, address, city, state')
      .eq('id', hub_id)
      .single();
    if (hubError || !hubRecord) {
      return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Hub not found' }) };
    }

    const returnCode = generateReturnCode();
    const shipmentStatus = 'awaiting_tracking';
    const fezTracking = null;
    const fezShipmentId = null;

    // Insert return_request
    const { data: request, error: insertError } = await supabase
      .from('return_requests')
      .insert({
        order_id,
        order_number: order.number,
        wc_customer_id: order.customer_id,
        customer_email: customerEmail,
        customer_name: customerName,
        hub_id,
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

    // Upload images
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

    // Save shipment row - must succeed
    const { data: shipment, error: shipErr } = await supabase
      .from('return_shipments')
      .insert({
        return_request_id: request.id,
        return_code: returnCode,
        fez_tracking: fezTracking,
        fez_shipment_id: fezShipmentId,
        method,
        status: shipmentStatus,
        raw_payload: null,
        customer_submitted_tracking: false,
        tracking_submitted_at: null,
      })
      .select('*')
      .single();

    if (shipErr || !shipment) {
      console.error('CRITICAL: Return shipment creation failed:', shipErr);
      await supabase.from('return_requests').delete().eq('id', request.id);
      throw new Error('Failed to create return shipment: ' + (shipErr?.message || 'Unknown error'));
    }

    console.log('✅ Return shipment created:', shipment.id);

    // Update request with fez fields
    await supabase
      .from('return_requests')
      .update({
        fez_tracking: fezTracking,
        fez_method: method,
        fez_shipment_id: fezShipmentId || shipment?.id || null,
        status: shipmentStatus,
        hub_id,
      })
      .eq('id', request.id);

    return {
      statusCode: 201,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: {
          return_request: { ...request, images: finalImages, fez_tracking: fezTracking, hub_id, return_code: returnCode },
          return_shipment: shipment,
        },
      }),
    };
  } catch (error) {
    console.error('returns-create error:', error);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: error.message || 'Internal error' }) };
  }
}
