// Admin: approve return request (creates Fez shipments) or reject it
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

// ─── Fez helpers (same pattern as fez-create-shipment.js) ────────────────────

function generateReturnCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let code = 'RTN-';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function generateFezUniqueId(base) {
  return `JLO-RTN-${(base || 'X').slice(-6).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
}

function isValidFezOrderNumber(value) {
  if (!value || typeof value !== 'string') return false;
  const bad = ['error', 'cannot', 'failed', 'invalid', 'wrong', 'something went wrong', 'already exists'];
  const low = value.toLowerCase();
  if (bad.some(b => low.includes(b))) return false;
  return value.length < 50 && /^[A-Za-z0-9_-]+$/.test(value.trim());
}

async function authenticateFez() {
  // Try DB-configured credentials first
  const { data: courier } = await adminClient
    .from('couriers')
    .select('api_user_id, api_password, api_base_url, environment')
    .eq('code', 'fez')
    .eq('api_enabled', true)
    .maybeSingle();

  const baseUrl = courier?.api_base_url || process.env.FEZ_API_BASE_URL;
  const userId = courier?.api_user_id || process.env.FEZ_USER_ID;
  const password = courier?.api_password || process.env.FEZ_PASSWORD || process.env.FEZ_API_KEY;

  if (!baseUrl || !userId || !password) throw new Error('Fez API credentials not configured');

  const res = await fetch(`${baseUrl}/user/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, password }),
  });
  const data = await res.json();
  if (data.status !== 'Success') throw new Error(data.description || 'Fez authentication failed');

  return {
    authToken: data.authDetails.authToken,
    secretKey: data.orgDetails['secret-key'],
    baseUrl,
  };
}

async function createFezShipment(auth, payload) {
  const res = await fetch(`${auth.baseUrl}/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.authToken}`,
      'secret-key': auth.secretKey,
    },
    body: JSON.stringify([payload]),
  });
  const data = await res.json();

  if (data.status === 'Success' && data.orderNos) {
    const trackingId = Object.keys(data.orderNos)[0];
    const orderId = Object.values(data.orderNos)[0];
    if (isValidFezOrderNumber(orderId)) return { trackingId, orderId };
    // Handle "already exists" message with embedded code
    const match = orderId?.match?.(/order\s+([A-Za-z0-9_-]+)/i);
    if (match && isValidFezOrderNumber(match[1])) return { trackingId, orderId: match[1] };
    throw new Error(orderId || 'Fez returned invalid order number');
  }

  throw new Error(data.description || data.message || 'Failed to create Fez order');
}

async function createFezShipmentWithRetry(auth, payload) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, 1000));
      return await createFezShipment(auth, payload);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { return_request_id, action, rejection_reason } = body;

    if (!return_request_id || !['approve', 'reject'].includes(action)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: 'return_request_id and action (approve|reject) are required' }),
      };
    }

    // Load return request
    const { data: request, error: reqErr } = await adminClient
      .from('return_requests')
      .select('*')
      .eq('id', return_request_id)
      .single();

    if (reqErr || !request) throw reqErr || new Error('Return request not found');

    if (request.status !== 'pending_review') {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: `Request is already ${request.status} — can only approve/reject pending_review requests` }),
      };
    }

    // ── REJECT ────────────────────────────────────────────────────────────────
    if (action === 'reject') {
      await adminClient
        .from('return_requests')
        .update({ status: 'rejected', rejection_reason: rejection_reason || null })
        .eq('id', return_request_id);

      if (request.customer_email) {
        sendTransactionalEmail({
          templateName: 'Return Rejected',
          to: request.customer_email,
          orderId: request.supabase_order_id || null,
          data: {
            customerName: request.customer_name || 'Customer',
            orderNumber: request.order_number || return_request_id,
            rejectionReason: rejection_reason || '',
          },
        });
      }

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ success: true, data: { status: 'rejected' } }),
      };
    }

    // ── APPROVE ───────────────────────────────────────────────────────────────

    // Load the Supabase order for customer address
    const orderId = request.supabase_order_id;
    const { data: order, error: orderErr } = await adminClient
      .from('orders')
      .select('id, order_number, delivery_address, delivery_state, delivery_city, customer_name, customer_phone, customer_email')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) throw orderErr || new Error('Order not found');

    // Load hub info
    const { data: hub } = await adminClient
      .from('hubs')
      .select('id, name, address, city, state, phone')
      .eq('id', request.hub_id)
      .single();

    if (!hub) throw new Error('Hub not found for this return request');

    // Load order items with vendor info
    const { data: items } = await adminClient
      .from('order_items')
      .select('id, product_name, vendor_id, vendors(id, store_name, email, address, city, state, phone)')
      .eq('order_id', orderId);

    // Group items by destination: null vendor_id → hub, else → vendor
    // Key: 'hub' or vendor UUID
    const groups = {};
    for (const item of (items || [])) {
      const key = item.vendor_id || 'hub';
      if (!groups[key]) {
        groups[key] = {
          destinationType: item.vendor_id ? 'vendor' : 'hub',
          vendor: item.vendor_id ? item.vendors : null,
          items: [],
        };
      }
      groups[key].items.push(item.product_name);
    }

    // If no items found at all, still create one hub shipment
    if (Object.keys(groups).length === 0) {
      groups['hub'] = { destinationType: 'hub', vendor: null, items: ['Return items'] };
    }

    // Authenticate with Fez once for all shipments
    const auth = await authenticateFez();

    const createdShipments = [];
    const shipmentErrors = [];

    for (const [key, group] of Object.entries(groups)) {
      const returnCode = generateReturnCode();
      const recipient = group.destinationType === 'vendor' && group.vendor
        ? {
            address: group.vendor.address || '',
            state: group.vendor.state || 'Lagos',
            name: group.vendor.store_name || 'Vendor',
            phone: group.vendor.phone || '',
          }
        : {
            address: hub.address || '',
            state: hub.state || 'Lagos',
            name: hub.name || 'JulineMart Hub',
            phone: hub.phone || '',
          };

      const fezPayload = {
        recipientAddress: recipient.address,
        recipientState: recipient.state,
        recipientName: recipient.name,
        recipientPhone: recipient.phone,
        recipientEmail: '',
        pickUpAddress: order.delivery_address || '',
        pickUpState: order.delivery_state || 'Lagos',
        uniqueID: generateFezUniqueId(return_request_id),
        BatchID: returnCode,
        itemDescription: `Return: ${group.items.slice(0, 3).join(', ')}`,
        valueOfItem: '1000',
        weight: 1,
        additionalDetails: `Return from: ${order.customer_name || 'Customer'}, Phone: ${order.customer_phone || ''}`,
      };

      let fezTracking = null;
      let fezShipmentId = null;

      try {
        const fezResult = await createFezShipmentWithRetry(auth, fezPayload);
        fezTracking = fezResult.orderId;
        fezShipmentId = fezResult.trackingId;
      } catch (err) {
        shipmentErrors.push(`${group.destinationType === 'vendor' ? group.vendor?.store_name || key : 'hub'}: ${err.message}`);
        // Still insert the DB row so admin can see it and retry
      }

      const destinationAddress = {
        address: recipient.address,
        state: recipient.state,
        city: group.destinationType === 'vendor' ? (group.vendor?.city || '') : (hub.city || ''),
        name: recipient.name,
        phone: recipient.phone,
      };

      const { data: shipment, error: shipErr } = await adminClient
        .from('return_shipments')
        .insert({
          return_request_id,
          return_code: returnCode,
          method: 'dropoff',
          status: fezTracking ? 'awaiting_dropoff' : 'pending',
          fez_tracking: fezTracking,
          fez_shipment_id: fezShipmentId,
          vendor_id: group.destinationType === 'vendor' ? (group.vendor?.id || null) : null,
          destination_type: group.destinationType,
          destination_address: destinationAddress,
          customer_submitted_tracking: false,
        })
        .select('*')
        .single();

      if (shipErr) {
        shipmentErrors.push(`DB insert failed for ${key}: ${shipErr.message}`);
        continue;
      }

      createdShipments.push({
        ...shipment,
        tracking_number: fezTracking,
        return_code: returnCode,
        destination_type: group.destinationType,
      });
    }

    // Update return_request status to approved
    await adminClient
      .from('return_requests')
      .update({ status: 'approved' })
      .eq('id', return_request_id);

    // Build tracking summary for customer email
    const trackingNumbers = createdShipments
      .filter(s => s.fez_tracking)
      .map(s => s.fez_tracking)
      .join(', ') || 'Pending';

    const firstReturnCode = createdShipments[0]?.return_code || '';

    // Email customer: approved with tracking
    if (request.customer_email) {
      sendTransactionalEmail({
        templateName: 'Return Approved',
        to: request.customer_email,
        orderId: request.supabase_order_id || null,
        data: {
          customerName: request.customer_name || 'Customer',
          orderNumber: request.order_number || return_request_id,
          trackingNumbers,
          returnCode: firstReturnCode,
        },
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: {
          status: 'approved',
          shipments: createdShipments,
          errors: shipmentErrors.length ? shipmentErrors : null,
        },
      }),
    };

  } catch (error) {
    console.error('admin-approve-return error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: error.message || 'Internal error' }),
    };
  }
}
