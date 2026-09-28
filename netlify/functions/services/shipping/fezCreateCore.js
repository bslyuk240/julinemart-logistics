import { sendApiCourierStatusCustomerEmail } from '../../../../shared/riderAssignedEmail.js';
import { sendVendorShipmentReadyEmail } from '../../../../shared/vendorFulfillment.js';
import { sendTransactionalEmail } from '../emailNotifications.js';
import { resolveSender } from '../resolveSender.js';
import { authenticateFez } from '../fezAuth.js';
import { sendWebhookEvent } from '../webhookDelivery.js';

export function generateShortUniqueId(subOrderId) {
  const shortId = String(subOrderId).slice(-8);
  const timestamp = Date.now().toString(36);
  return `JLO-${shortId}-${timestamp}`.toUpperCase();
}

export function isValidFezOrderNumber(value) {
  if (!value || typeof value !== 'string') return false;

  const errorIndicators = [
    'error',
    'cannot',
    'failed',
    'invalid',
    'wrong',
    'something went wrong',
    'already exists',
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
  if (match && isValidFezOrderNumber(match[1])) return match[1];
  return null;
}

export async function createFezOrder(authToken, secretKey, baseUrl, shipmentData) {
  const res = await fetch(`${baseUrl}/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
      'secret-key': secretKey,
    },
    body: JSON.stringify([shipmentData]),
  });

  const data = await res.json();
  console.log('FEZ ORDER RESPONSE:', JSON.stringify(data, null, 2));

  if (data.status === 'Success' && data.orderNos) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    if (isValidFezOrderNumber(orderId)) return { orderId, trackingId, success: true };
    const extractedCode = extractOrderCodeFromMessage(orderId);
    if (extractedCode) return { orderId: extractedCode, trackingId, success: true };
    throw new Error(orderId || 'Fez returned invalid order number');
  }

  if (data.orderNos && Object.keys(data.orderNos).length > 0) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    if (isValidFezOrderNumber(orderId)) return { orderId, trackingId, success: true };
    const extractedCode = extractOrderCodeFromMessage(orderId);
    if (extractedCode) return { orderId: extractedCode, trackingId, success: true };
    throw new Error(orderId || data.description || 'Failed to create order on Fez');
  }

  throw new Error(data.description || data.message || 'Error creating order on Fez Delivery');
}

export const FEZ_SUB_ORDER_SELECT = `
  *,
  orders (
    id,
    overall_status,
    order_number,
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
    state,
    is_sub_hub,
    parent_hub_id,
    parent_hub:hubs!parent_hub_id (
      name,
      address,
      city,
      state
    )
  ),
  vendors (
    id,
    email,
    phone,
    store_name,
    hub_id,
    fez_collection_method,
    address,
    city,
    state,
    approved_location_id,
    approved_vendor_locations (
      fez_hub_name,
      fez_hub_address,
      courier_hubs ( name, address, city, state, phone ),
      hubs ( name, address, city )
    )
  )
`;

export async function executeFezCreateShipment(supabase, { subOrderId, force = false }) {
  const { data: subOrder, error } = await supabase
    .from('sub_orders')
    .select(FEZ_SUB_ORDER_SELECT)
    .eq('id', subOrderId)
    .single();

  if (error || !subOrder) {
    return { ok: false, statusCode: 404, error: 'Sub-order not found' };
  }

  const lane = subOrder?.metadata?.selected_lane || 'fez';
  if (lane !== 'fez') {
    return { ok: false, statusCode: 400, error: 'Shipment lane is not FEZ. Switch lane to FEZ to dispatch.' };
  }

  if (!force && subOrder.courier_shipment_id && isValidFezOrderNumber(subOrder.tracking_number)) {
    return {
      ok: true,
      statusCode: 200,
      alreadyExists: true,
      data: {
        tracking_number: subOrder.tracking_number,
        courier_shipment_id: subOrder.courier_shipment_id,
        courier_tracking_url: subOrder.courier_tracking_url,
        message: 'Shipment already exists. Returning saved tracking number.',
      },
    };
  }

  let items = [];
  if (Array.isArray(subOrder.items)) {
    items = subOrder.items;
  } else if (typeof subOrder.items === 'string') {
    try {
      items = JSON.parse(subOrder.items);
    } catch {
      items = [];
    }
  }

  const totalWeight = items.reduce(
    (sum, i) => sum + (Number(i.weight || 0) * Number(i.quantity || 1)),
    0,
  );
  const itemsValue = items.reduce(
    (sum, i) => sum + (Number(i.price || 0) * Number(i.quantity || 1)),
    0,
  );
  const shippingValue = Math.round(
    (itemsValue || Number(subOrder.real_shipping_cost ?? subOrder.allocated_shipping_fee ?? subOrder.shipping_fee_paid ?? 0)) + 1000,
  );

  const uniqueId = generateShortUniqueId(subOrderId);
  const sender = resolveSender(subOrder);
  const shipmentData = {
    recipientAddress: subOrder.orders?.delivery_address || '',
    recipientState: subOrder.orders?.delivery_state || '',
    recipientName: subOrder.orders?.customer_name || '',
    recipientPhone: subOrder.orders?.customer_phone || '',
    recipientEmail: subOrder.orders?.customer_email || '',
    uniqueID: uniqueId,
    BatchID: String(subOrder.orders?.order_number || subOrder.orders?.id || subOrderId),
    itemDescription: items.map((i) => `${i.quantity}x ${i.name}`).join(', ') || 'Package',
    valueOfItem: String(shippingValue),
    weight: Math.max(1, Math.round(totalWeight)) || 1,
    pickUpAddress: sender.address,
    pickUpState: sender.state,
    additionalDetails: sender.kind === 'vendor_pickup'
      ? `Vendor pickup: ${sender.city} — ${sender.address}, Phone: ${sender.phone || 'N/A'}`
      : `Hub: ${sender.name}, ${sender.city}${sender.phone ? `, Phone: ${sender.phone}` : ''}`,
  };

  let lastError = null;
  let result = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { authToken, secretKey, baseUrl } = await authenticateFez(supabase);
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 1000));
      result = await createFezOrder(authToken, secretKey, baseUrl, shipmentData);
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!result) {
    return { ok: false, statusCode: 500, error: lastError?.message || 'Failed to create shipment after 2 attempts' };
  }

  const { orderId, trackingId } = result;
  if (!isValidFezOrderNumber(orderId)) {
    return { ok: false, statusCode: 500, error: 'Fez returned invalid order number', details: orderId };
  }

  const trackingUrl = `https://web.fezdelivery.co/track-delivery?tracking=${orderId}`;
  let waybillNumber = subOrder.waybill_number || null;
  if (!waybillNumber) {
    const { data: nextNumber, error: wbError } = await supabase.rpc('next_waybill_number');
    if (!wbError) waybillNumber = nextNumber;
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from('sub_orders')
    .update({
      tracking_number: orderId,
      courier_shipment_id: trackingId,
      courier_waybill: orderId,
      courier_tracking_url: trackingUrl,
      status: 'assigned',
      ...(waybillNumber ? { waybill_number: waybillNumber } : {}),
    })
    .eq('id', subOrderId)
    .select('id')
    .single();

  if (updateError) {
    return { ok: false, statusCode: 500, error: 'Failed to save tracking number', details: updateError.message };
  }
  if (!updatedRows?.id) {
    return { ok: false, statusCode: 404, error: 'Sub-order not found when saving tracking number' };
  }

  if (subOrder.orders?.id && subOrder.orders?.overall_status === 'pending') {
    try {
      await supabase.from('orders').update({ overall_status: 'processing' }).eq('id', subOrder.orders.id);
      sendWebhookEvent('order.updated', {
        order_id: subOrder.orders.id,
        order_number: subOrder.orders.order_number,
        previous_status: 'pending',
        status: 'processing',
      }).catch((e) => console.warn('[fez-create-shipment] webhook dispatch failed:', e.message));
    } catch (orderUpdateError) {
      console.warn('Failed to promote overall order status', orderUpdateError);
    }
  }

  await supabase.from('activity_logs').insert({
    user_id: null,
    action: 'courier_shipment_created',
    resource_type: 'sub_order',
    resource_id: subOrderId,
    details: {
      courier: 'fez',
      order_id: orderId,
      tracking_id: trackingId,
      unique_id: uniqueId,
      forced_resend: Boolean(force),
      previous_tracking: force ? subOrder.tracking_number : null,
    },
  });

  if (subOrder.orders?.customer_email) {
    try {
      await sendApiCourierStatusCustomerEmail(supabase, {
        jloStatus: 'assigned',
        orderId: subOrder.orders.id,
        orderNumber: subOrder.orders.order_number ?? subOrder.orders.id,
        customer_name: subOrder.orders.customer_name,
        customer_email: subOrder.orders.customer_email,
        tracking_number: orderId,
        courier_tracking_url: trackingUrl,
        courier_display_name: 'Fez Delivery',
        delivery_city: subOrder.orders.delivery_city,
        delivery_state: subOrder.orders.delivery_state,
        raw_status_hint: 'Shipment created on Fez',
      });
    } catch (mailErr) {
      console.error('sendApiCourierStatusCustomerEmail (fez-create-shipment):', mailErr?.message || mailErr);
    }
  }

  if (subOrder.vendors) {
    await sendVendorShipmentReadyEmail(supabase, sendTransactionalEmail, {
      vendor: subOrder.vendors,
      orderId: subOrder.orders?.id,
      orderNumber: subOrder.orders?.order_number ?? subOrder.orders?.id,
      subOrderId,
      trackingNumber: orderId,
      trackingUrl,
    });
  }

  return {
    ok: true,
    statusCode: 200,
    data: {
      tracking_number: orderId,
      courier_shipment_id: trackingId,
      courier_tracking_url: trackingUrl,
      courier_name: 'FEZ Standard',
      message: 'Shipment created successfully on Fez Delivery',
    },
  };
}
