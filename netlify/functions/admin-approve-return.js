// Admin: approve return request (creates Fez shipments) or reject it
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';
import { authenticateFez } from './services/fezAuth.js';
import { requireAdmin } from './services/global-sourcing-utils.js';
import { recordStaffAudit } from './services/auditLog.js';
import { RETURNS_ACTION_ROLES } from './services/staff-roles.js';
import { chooseReturnLane, isCarrierPickupEnabled } from './services/return-pickup.js';
import { bookShipbubbleReturnPickup } from './services/return-pickup-shipbubble.js';
import { createLocalRiderPickup } from './services/return-pickup-rider.js';

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

async function authenticateFezForReturn() {
  return authenticateFez(adminClient);
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
    if (isValidFezOrderNumber(orderId)) return { trackingId, orderId, raw: data };
    // Handle "already exists" message with embedded code
    const match = orderId?.match?.(/order\s+([A-Za-z0-9_-]+)/i);
    if (match && isValidFezOrderNumber(match[1])) return { trackingId, orderId: match[1], raw: data };
    const invalidErr = new Error(orderId || 'Fez returned invalid order number');
    invalidErr.raw = data;
    throw invalidErr;
  }

  const failErr = new Error(data.description || data.message || 'Failed to create Fez order');
  failErr.raw = data;
  throw failErr;
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

  // Staff only. Approving creates real courier shipments (which cost money) and
  // vendor debits; this had no login check, so anyone with a return id could
  // trigger it.
  // Named staffAuth because the Fez login further down is also called `auth`;
  // sharing the name made the reject branch read it before it was initialised.
  const staffAuth = await requireAdmin(event, RETURNS_ACTION_ROLES);
  if (staffAuth.errorResponse) return staffAuth.errorResponse;

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

      await recordStaffAudit(event, staffAuth.authUser, {
        action: 'RETURN_REJECTED',
        resource_type: 'return_requests',
        resource_id: return_request_id,
        details: { rejection_reason: rejection_reason || null },
      });

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

    // Load order items with vendor info + subtotal for debit calculation
    const { data: items } = await adminClient
      .from('order_items')
      .select('id, product_name, subtotal, vendor_id, vendors(id, store_name, email, address, city, state, phone, commission_rate)')
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

    // ── Pickup vs drop-off ────────────────────────────────────────────────────
    // A pickup return carries where to collect from (and when). Otherwise the
    // order's delivery address is used, as before. For pickups the lane is
    // chosen here: a local rider in the hub's own town, Fez everywhere else;
    // staff can override with pickup_lane.
    const isPickup = request.fez_method === 'pickup' && Boolean(request.pickup);
    const pickupFrom = isPickup
      ? {
          name: request.pickup.name,
          phone: request.pickup.phone,
          address: request.pickup.address,
          city: request.pickup.city,
          state: request.pickup.state,
        }
      : {
          name: order.customer_name,
          phone: order.customer_phone,
          address: order.delivery_address,
          city: order.delivery_city,
          state: order.delivery_state,
        };

    let lane = 'fez';
    if (isPickup) {
      const requestedLane = body.pickup_lane;
      if (requestedLane && !['fez', 'local_rider', 'shipbubble'].includes(requestedLane)) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({ success: false, error: "pickup_lane must be 'fez', 'local_rider' or 'shipbubble'" }),
        };
      }
      if (requestedLane === 'shipbubble' && !(await isCarrierPickupEnabled(adminClient))) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({
            success: false,
            error: 'Shipbubble pickups are not set up yet. Apply the carrier migration (20261003130000_return_pickup_carrier.sql) first.',
          }),
        };
      }
      lane = requestedLane || chooseReturnLane({ pickupCity: pickupFrom.city, hubCity: hub.city });
    }
    const useLocalRider = isPickup && lane === 'local_rider';
    const useShipbubble = isPickup && lane === 'shipbubble';

    const createdShipments = [];
    const shipmentErrors = [];
    let riderPickup = null;

    // Local rider: ONE pickup straight to the hub (the hub forwards to vendors),
    // so there is no per-vendor Fez booking. Done first, and before anything is
    // saved, so a failure here leaves the return still pending for a retry.
    if (useLocalRider) {
      const returnCode = generateReturnCode();
      try {
        riderPickup = await createLocalRiderPickup(adminClient, event, {
          pickupFrom,
          hub,
          returnCode,
          itemSummary: Object.values(groups).flatMap((g) => g.items).slice(0, 3).join(', '),
          staffUserId: staffAuth.authUser?.id || null,
        });
      } catch (err) {
        return {
          statusCode: 502,
          headers: corsHeaders(),
          body: JSON.stringify({ success: false, error: err.message || 'Could not arrange the rider pickup' }),
        };
      }

      const { data: riderReturnShipment, error: riderShipErr } = await adminClient
        .from('return_shipments')
        .insert({
          return_request_id,
          return_code: returnCode,
          method: 'pickup',
          status: 'awaiting_pickup',
          fez_tracking: null,
          manual_shipment_id: riderPickup.shipment.id,
          vendor_id: null,
          destination_type: 'hub',
          destination_address: {
            address: hub.address || '',
            state: hub.state || '',
            city: hub.city || '',
            name: hub.name || 'JulineMart Hub',
            phone: hub.phone || '',
          },
          customer_submitted_tracking: false,
          raw_payload: {
            lane: 'local_rider',
            manual_shipment_code: riderPickup.shipment.shipment_code,
            broadcast: riderPickup.broadcast,
          },
        })
        .select('*')
        .single();

      if (riderShipErr) {
        shipmentErrors.push(`DB insert failed for rider pickup: ${riderShipErr.message}`);
      } else {
        createdShipments.push({
          ...riderReturnShipment,
          tracking_number: riderPickup.shipment.shipment_code,
          return_code: returnCode,
          destination_type: 'hub',
        });
      }
      if (!riderPickup.broadcast.ok) {
        shipmentErrors.push(
          `Rider broadcast: ${riderPickup.broadcast.error}. Dispatch ${riderPickup.shipment.shipment_code} from Manual Shipments.`
        );
      }
    }

    // Shipbubble: book the cheapest available courier to collect from the
    // customer and deliver to the hub (the hub forwards to vendors). Like the
    // rider lane it books before anything is saved, so a failure leaves the
    // return pending and staff can choose another lane.
    let carrierPickup = null;
    if (useShipbubble) {
      const returnCode = generateReturnCode();
      try {
        carrierPickup = await bookShipbubbleReturnPickup(adminClient, {
          pickupFrom,
          hub,
          declaredValue: (items || []).reduce((sum, i) => sum + Number(i.subtotal || 0), 0),
          preferredDate: request.pickup?.preferred_date || null,
          itemSummary: Object.values(groups).flatMap((g) => g.items).slice(0, 3).join(', '),
        });
      } catch (err) {
        return {
          statusCode: 502,
          headers: corsHeaders(),
          body: JSON.stringify({ success: false, error: err.message || 'Could not book the Shipbubble pickup' }),
        };
      }

      const { data: carrierReturnShipment, error: carrierShipErr } = await adminClient
        .from('return_shipments')
        .insert({
          return_request_id,
          return_code: returnCode,
          method: 'pickup',
          status: 'awaiting_pickup',
          fez_tracking: null,
          provider: 'shipbubble',
          provider_shipment_id: carrierPickup.provider_shipment_id,
          tracking_url: carrierPickup.tracking_url,
          vendor_id: null,
          destination_type: 'hub',
          destination_address: {
            address: hub.address || '',
            state: hub.state || '',
            city: hub.city || '',
            name: hub.name || 'JulineMart Hub',
            phone: hub.phone || '',
          },
          customer_submitted_tracking: false,
          raw_payload: {
            lane: 'shipbubble',
            courier: carrierPickup.courier_name,
            service: carrierPickup.service_name,
            tracking_code: carrierPickup.tracking_code,
            waybill_url: carrierPickup.waybill_url,
            // What Shipbubble charged us, for margin. The customer's pickup fee
            // (return_requests.pickup_fee) is quoted separately from our zone rates.
            carrier_cost: carrierPickup.cost,
            environment: carrierPickup.environment,
            collection_date: carrierPickup.collection_date,
          },
        })
        .select('*')
        .single();

      if (carrierShipErr) {
        // The courier is booked but we couldn't record it: say so loudly, with
        // the id, so it can be recorded or cancelled by hand.
        shipmentErrors.push(
          `Shipbubble booking ${carrierPickup.provider_shipment_id} (${carrierPickup.tracking_code}) was made but could not be saved: ${carrierShipErr.message}`
        );
      } else {
        createdShipments.push({
          ...carrierReturnShipment,
          tracking_number: carrierPickup.tracking_code,
          carrier_tracking: carrierPickup.tracking_code,
          return_code: returnCode,
          destination_type: 'hub',
        });
      }
    }

    // Authenticate with Fez once for all shipments (not needed for a rider or Shipbubble pickup)
    const fezGroups = useLocalRider || useShipbubble ? {} : groups;
    const auth = Object.keys(fezGroups).length ? await authenticateFezForReturn() : null;

    for (const [key, group] of Object.entries(fezGroups)) {
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
        pickUpAddress: pickupFrom.address || '',
        pickUpState: pickupFrom.state || 'Lagos',
        uniqueID: generateFezUniqueId(return_request_id),
        BatchID: returnCode,
        itemDescription: `Return: ${group.items.slice(0, 3).join(', ')}`,
        valueOfItem: '1000',
        weight: 1,
        additionalDetails:
          `Return from: ${pickupFrom.name || 'Customer'}, Phone: ${pickupFrom.phone || ''}` +
          (isPickup
            ? `. PICKUP requested${request.pickup.preferred_date ? ` for ${request.pickup.preferred_date}` : ''}` +
              (request.pickup.notes ? `. Note: ${request.pickup.notes}` : '')
            : ''),
      };

      let fezTracking = null;
      let fezShipmentId = null;
      let rawPayload = null;

      try {
        const fezResult = await createFezShipmentWithRetry(auth, fezPayload);
        fezTracking = fezResult.orderId;
        fezShipmentId = fezResult.trackingId;
        rawPayload = fezResult.raw ?? null;
      } catch (err) {
        shipmentErrors.push(`${group.destinationType === 'vendor' ? group.vendor?.store_name || key : 'hub'}: ${err.message}`);
        rawPayload = err.raw ?? { error: err.message };
        // Still insert the DB row so admin can see it and retry
      }

      const destinationAddress = {
        address: recipient.address,
        state: recipient.state,
        city: group.destinationType === 'vendor' ? (group.vendor?.city || '') : (hub.city || ''),
        name: recipient.name,
        phone: recipient.phone,
      };

      // Only worth a waybill number if the shipment actually has real Fez
      // tracking — non-fatal on failure, same as order dispatch: this must
      // not block the return approval itself.
      let waybillNumber = null;
      if (fezTracking) {
        const { data: nextNumber, error: wbError } = await adminClient.rpc('next_waybill_number');
        if (wbError) {
          console.error('waybill number generation failed:', wbError);
        } else {
          waybillNumber = nextNumber;
        }
      }

      const { data: shipment, error: shipErr } = await adminClient
        .from('return_shipments')
        .insert({
          return_request_id,
          return_code: returnCode,
          method: isPickup ? 'pickup' : 'dropoff',
          status: fezTracking ? (isPickup ? 'awaiting_pickup' : 'awaiting_dropoff') : 'pending',
          fez_tracking: fezTracking,
          fez_shipment_id: fezShipmentId,
          vendor_id: group.destinationType === 'vendor' ? (group.vendor?.id || null) : null,
          destination_type: group.destinationType,
          destination_address: destinationAddress,
          customer_submitted_tracking: false,
          waybill_number: waybillNumber,
          raw_payload: rawPayload,
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

    // Create vendor_return_debit records for vendor-destination shipments.
    // This holds the vendor's net earnings against their balance so future
    // withdrawals account for the potential refund they owe back.
    for (const [key, group] of Object.entries(groups)) {
      if (group.destinationType !== 'vendor' || !group.vendor?.id) continue;

      const vendorItems = (items || []).filter(i => i.vendor_id === group.vendor.id);
      const gross = vendorItems.reduce((s, i) => s + Number(i.subtotal || 0), 0);
      const commissionRate = Number(group.vendor.commission_rate || 0);
      const netAmount = gross * (1 - commissionRate / 100);

      if (netAmount > 0) {
        await adminClient.from('vendor_return_debits').insert({
          vendor_id:         group.vendor.id,
          return_request_id,
          amount:            netAmount,
          status:            'pending',
        });
      }
    }

    // Update return_request status to approved
    await adminClient
      .from('return_requests')
      .update({ status: 'approved', ...(isPickup ? { pickup_lane: lane } : {}) })
      .eq('id', return_request_id);

    // Build tracking summary for customer email
    const trackingNumbers = createdShipments
      .filter(s => s.fez_tracking || s.carrier_tracking)
      .map(s => s.fez_tracking || s.carrier_tracking)
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

    await recordStaffAudit(event, staffAuth.authUser, {
      action: 'RETURN_APPROVED',
      resource_type: 'return_requests',
      resource_id: return_request_id,
      details: {
        shipments_created: createdShipments.length,
        shipment_errors: shipmentErrors.length,
        method: isPickup ? 'pickup' : 'dropoff',
        pickup_lane: isPickup ? lane : null,
      },
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: {
          status: 'approved',
          shipments: createdShipments,
          errors: shipmentErrors.length ? shipmentErrors : null,
          pickup: isPickup
            ? {
                lane,
                manual_shipment_code: riderPickup?.shipment?.shipment_code || null,
                riders_notified: riderPickup?.broadcast?.riders_notified ?? null,
                carrier: carrierPickup
                  ? {
                      courier: carrierPickup.courier_name,
                      tracking_code: carrierPickup.tracking_code,
                      tracking_url: carrierPickup.tracking_url,
                      cost: carrierPickup.cost,
                      environment: carrierPickup.environment,
                    }
                  : null,
              }
            : null,
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
