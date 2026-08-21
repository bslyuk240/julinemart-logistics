import { createClient } from '@supabase/supabase-js';
import { sendLocalRiderAssignedEmail } from '../../shared/riderAssignedEmail.js';
import {
  buildOrderDeepLink,
  extractCustomerIdFromOrder,
  extractOrderReference,
  sendPushToCustomer,
} from './services/pushNotifications.js';
import { sendRiderPush } from './services/riderNotifications.js';
import { assertStaffCanCreateShipment } from './services/shipmentAccess.js';
import { syncShipmentBestEffort } from './services/shipmentSync.js';
import { notifyRider, notifyRiderArea, notifyDispatch } from './services/riderRealtime.js';
import { lookupShippingRate, computeDispatchCostBreakdown } from './services/shippingRateLookup.js';
import { ensureTrackingAndWaybill } from './services/trackingNumbers.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method Not Allowed' }),
    };
  }

  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)
  ) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Missing Supabase configuration' }),
    };
  }

  try {
    const access = await assertStaffCanCreateShipment(event);
    if (!access.ok) {
      return { statusCode: access.statusCode, headers, body: access.body };
    }

    const { sub_order_id, rider_id, destination } = JSON.parse(event.body || '{}');

    if (!sub_order_id || !rider_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing required fields: sub_order_id, rider_id',
        }),
      };
    }

    // 'hub' = first-mile: rider collects from the vendor and drops at this
    // sub_order's already-routed hub (feeding the existing Hub Dispatch flow
    // for the next leg), not the customer. Only ever offered for orders
    // staff already routed through a hub — this never decides hub routing
    // on its own.
    const toHub = destination === 'hub';

    const { data: rider, error: riderLookupError } = await supabase
      .from('riders')
      .select('id, full_name, phone, vehicle_type, vehicle_plate, status')
      .eq('id', rider_id)
      .maybeSingle();

    if (riderLookupError || !rider) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ success: false, error: 'Rider not found' }),
      };
    }
    if (rider.status !== 'active') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'This rider is not active' }),
      };
    }

    const rider_name = rider.full_name;
    const rider_phone = rider.phone;
    const rider_vehicle = rider.vehicle_type
      ? `${rider.vehicle_type}${rider.vehicle_plate ? ` · ${rider.vehicle_plate}` : ''}`
      : null;

    const { data: localCourier, error: courierError } = await supabase
      .from('couriers')
      .select('id')
      .eq('code', 'local-rider')
      .single();

    if (courierError || !localCourier) {
      console.error('Local courier lookup failed', courierError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Local rider courier not configured in system',
        }),
      };
    }

    const { data: existingSubOrder, error: existingSubOrderError } = await supabase
      .from('sub_orders')
      .select('id, tracking_number, metadata, main_order_id, waybill_number, status, broadcast_city, broadcast_state, hub_id, vendors ( approved_vendor_locations ( zone_id, vendor_pickup_surcharge ) )')
      .eq('id', sub_order_id)
      .single();

    if (existingSubOrderError || !existingSubOrder) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Sub-order not found',
        }),
      };
    }

    if (toHub && !existingSubOrder.hub_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'This order has no hub routing set — route it through a hub first' }),
      };
    }

    // Rider payout, frozen now — before the rider has accepted — so the
    // number shown to them on accept/decline is already final. Priced by
    // the vendor's own pickup zone (a local rider collects directly from
    // the vendor), same as broadcast-rider.js. Weight defaults to 1kg —
    // sub_orders.items never stores a per-item weight (same gap
    // fez-create-shipment.js already has).
    const area = existingSubOrder.vendors?.approved_vendor_locations;
    let riderPayout = null;
    let riderPayoutBreakdown = null;
    if (area?.zone_id) {
      try {
        const riderRate = await lookupShippingRate(supabase, {
          zoneId: area.zone_id,
          courierId: localCourier.id,
        });
        if (riderRate) {
          riderPayoutBreakdown = computeDispatchCostBreakdown(riderRate, 1, area.vendor_pickup_surcharge || 0);
          riderPayout = riderPayoutBreakdown.total;
        }
      } catch (payoutErr) {
        console.error('assign-rider payout lookup failed:', payoutErr);
      }
    }

    const { trackingNumber: nextTrackingNumber, waybillNumber } = await ensureTrackingAndWaybill(supabase, {
      trackingNumber: existingSubOrder.tracking_number,
      waybillNumber: existingSubOrder.waybill_number,
    });
    const existingMetadata =
      existingSubOrder.metadata &&
      typeof existingSubOrder.metadata === 'object' &&
      !Array.isArray(existingSubOrder.metadata)
        ? existingSubOrder.metadata
        : {};

    const { data: updatedSubOrder, error } = await supabase
      .from('sub_orders')
      .update({
        courier_id: localCourier.id,
        tracking_number: nextTrackingNumber,
        delivery_person_name: rider_name,
        delivery_person_phone: rider_phone,
        delivery_person_vehicle: rider_vehicle || null,
        status: 'assigned',
        rider_name: rider_name,
        rider_phone: rider_phone,
        assigned_rider_id: rider.id,
        broadcast_city: null,
        broadcast_state: null,
        broadcast_started_at: null,
        ...(waybillNumber ? { waybill_number: waybillNumber } : {}),
        // If this sub-order was ever previously dispatched (or even just
        // attempted) via Fez before being reassigned to a local rider,
        // these three fields are Fez-specific leftovers — the customer
        // tracking page falls back to courier_tracking_url whenever the
        // courier code isn't one it recognizes (local-rider isn't), so a
        // stale Fez URL would otherwise keep showing for a shipment Fez
        // never touches again.
        courier_tracking_url: null,
        courier_waybill: null,
        courier_shipment_id: null,
        metadata: {
          ...existingMetadata,
          rider_accepted_at: null,
          // A hub leg is only the FIRST mile — the order still needs Fez (or
          // another leg) for the rest, so selected_lane must stay whatever
          // it already was (normally 'fez') rather than being claimed by
          // the local rider for the whole journey. Only a true end-to-end
          // local delivery flips this to 'local_rider'.
          ...(toHub ? {} : { selected_lane: 'local_rider' }),
          eligible_lanes:
            Array.isArray(existingMetadata.eligible_lanes) &&
            existingMetadata.eligible_lanes.length > 0
              ? existingMetadata.eligible_lanes
              : ['fez', 'local_rider'],
          rider_leg: toHub ? 'to_hub' : null,
        },
      })
      .eq('id', sub_order_id)
      .select()
      .single();

    if (error) {
      console.error('Update sub_order error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }

    await syncShipmentBestEffort(
      supabase,
      {
        subOrderId: sub_order_id,
        fields: {
          courier_id: localCourier.id,
          assigned_rider_id: rider.id,
          status: 'assigned',
          tracking_number: updatedSubOrder.tracking_number,
          waybill_number: updatedSubOrder.waybill_number,
          delivery_person_name: rider_name,
          delivery_person_phone: rider_phone,
          delivery_person_vehicle: rider_vehicle || null,
          rider_payout: riderPayout,
          rider_payout_breakdown: riderPayoutBreakdown,
          metadata: updatedSubOrder.metadata,
          courier_tracking_url: null,
          courier_waybill: null,
          courier_shipment_id: null,
        },
      },
      'assign-rider'
    );

    const riderDescription = `Assigned to local rider: ${rider_name} (${rider_phone})${
      rider_vehicle ? ` - ${rider_vehicle}` : ''
    }`;

    await supabase.from('tracking_events').insert({
      sub_order_id,
      status: 'assigned',
      description: riderDescription,
      actor_type: 'user',
      source: 'manual_assignment',
    });

    const riderPushResult = await sendRiderPush(supabase, rider.id, {
      title: 'New delivery assigned',
      message: `You've been assigned tracking #${nextTrackingNumber}. Open the app to accept.`,
      type: 'rider_job_assigned',
      data: { sub_order_id, targetPath: '/' },
    });
    if (!riderPushResult.success && !riderPushResult.skipped) {
      console.warn('Assign rider push (to rider) failed:', riderPushResult);
    }

    await notifyRider(rider.id, 'job_assigned', { sub_order_id });
    await notifyDispatch('sub_order', sub_order_id, 'updated', { status: 'assigned' });
    if (existingSubOrder.status === 'broadcasting' && existingSubOrder.broadcast_city && existingSubOrder.broadcast_state) {
      await notifyRiderArea(existingSubOrder.broadcast_city, existingSubOrder.broadcast_state, 'job_removed', { sub_order_id });
    }

    // Hub-leg jobs skip the customer "rider assigned" touch — the
    // meaningful update for them is the 'at_hub' progress email once the
    // rider actually arrives, not this intermediate first-mile step.
    if (existingSubOrder.main_order_id && !toHub) {
      const { data: orderRecord, error: orderError } = await supabase
        .from('orders')
        .select(
          'id, order_number, customer_name, customer_email, delivery_city, delivery_state, metadata',
        )
        .eq('id', existingSubOrder.main_order_id)
        .maybeSingle();

      if (orderError) {
        console.warn('Failed to load order for push notification:', orderError.message);
      } else if (orderRecord) {
        const customerId = extractCustomerIdFromOrder(orderRecord);
        const orderRef = extractOrderReference(orderRecord) || existingSubOrder.main_order_id;
        const deepLink = buildOrderDeepLink(orderRef);

        const pushResult = await sendPushToCustomer(customerId, {
          title: 'Rider assigned',
          message: `A rider has been assigned to your order ${orderRef}.`,
          type: 'order_update',
          data: {
            status: 'assigned',
            orderReference: String(orderRef),
            ...(deepLink ? { targetPath: deepLink } : {}),
          },
        });

        if (!pushResult.success && !pushResult.skipped) {
          console.warn('Assign rider push failed:', pushResult);
        }

        try {
          await sendLocalRiderAssignedEmail(supabase, {
            orderId: existingSubOrder.main_order_id,
            orderNumber: orderRecord.order_number ?? orderRef,
            customer_name: orderRecord.customer_name,
            customer_email: orderRecord.customer_email,
            tracking_number: updatedSubOrder.tracking_number || nextTrackingNumber,
            rider_name,
            rider_phone,
            rider_vehicle: rider_vehicle || undefined,
            delivery_city: orderRecord.delivery_city,
            delivery_state: orderRecord.delivery_state,
          });
        } catch (mailErr) {
          console.error('sendLocalRiderAssignedEmail:', mailErr?.message || mailErr);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: updatedSubOrder }),
    };
  } catch (error) {
    console.error('Assign rider function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Internal server error',
        message: error?.message,
      }),
    };
  }
};
