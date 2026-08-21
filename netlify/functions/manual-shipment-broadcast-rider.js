// Manual Shipment - Broadcast to Online Riders
//
// Alternative to manual-shipment-assign-rider.js: instead of the
// dispatcher hand-picking one rider, this offers the job to every
// online, active rider covering the pickup area. First rider to claim it
// (rider-jobs.js, action 'claim') wins; everyone else's app drops it.

import { createClient } from '@supabase/supabase-js';
import { assertStaffCanCreateShipment } from './services/shipmentAccess.js';
import { insertTrackingEvent } from './services/fezTracking.js';
import { sendRiderPush } from './services/riderNotifications.js';
import { sendRiderAccountEmail } from '../../shared/riderLifecycleEmail.js';
import { syncShipmentBestEffort } from './services/shipmentSync.js';
import { notifyRiderArea, notifyDispatch } from './services/riderRealtime.js';
import { lookupShippingRate, lookupHubOrZoneRate, computeDispatchCostBreakdown, getLocalRidersCourierId } from './services/shippingRateLookup.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

/** Resolve the town this manual shipment should broadcast into — the hub's
 *  serving area if a hub was picked at creation, otherwise the free-text
 *  sender address the dispatcher typed in. */
async function resolveBroadcastArea(shipment) {
  if (shipment.sender_hub_id) {
    const { data: location } = await supabase
      .from('approved_vendor_locations')
      .select('city, state')
      .eq('hub_id', shipment.sender_hub_id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (location) return { city: location.city, state: location.state };
  }
  const sender = shipment.sender || {};
  if (sender.city && sender.state) return { city: sender.city, state: sender.state };
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  }

  try {
    const access = await assertStaffCanCreateShipment(event);
    if (!access.ok) {
      return { statusCode: access.statusCode, headers, body: access.body };
    }

    const { shipment_id, cancel, destination } = JSON.parse(event.body || '{}');
    if (!shipment_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing required field: shipment_id' }) };
    }
    // See manual-shipment-assign-rider.js for what this mode means.
    const toHub = destination === 'hub';

    const { data: existingShipment, error: existingError } = await supabase
      .from('manual_shipments')
      .select('*')
      .eq('id', shipment_id)
      .single();

    if (existingError || !existingShipment) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Manual shipment not found' }) };
    }

    if (toHub && !cancel && !existingShipment.destination_hub_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'This shipment has no destination hub set — set one first' }),
      };
    }

    if (cancel) {
      if (existingShipment.status !== 'broadcasting') {
        return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'This shipment is not currently broadcasting' }) };
      }
      const { data: cancelled, error: cancelError } = await supabase
        .from('manual_shipments')
        .update({ status: 'pending', broadcast_city: null, broadcast_state: null, broadcast_started_at: null })
        .eq('id', shipment_id)
        .select()
        .single();
      if (cancelError) return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: cancelError.message }) };

      await syncShipmentBestEffort(
        supabase,
        { manualShipmentId: shipment_id, fields: { status: 'pending', broadcast_city: null, broadcast_state: null, broadcast_started_at: null, rider_payout: null, rider_payout_breakdown: null } },
        'manual-shipment-broadcast-rider cancel'
      );
      if (existingShipment.broadcast_city && existingShipment.broadcast_state) {
        await notifyRiderArea(existingShipment.broadcast_city, existingShipment.broadcast_state, 'job_removed', { manual_shipment_id: shipment_id });
      }
      await notifyDispatch('manual_shipment', shipment_id, 'updated', { status: 'pending' });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: cancelled }) };
    }

    if (existingShipment.assigned_rider_id) {
      return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'This shipment is already assigned to a rider' }) };
    }

    const area = await resolveBroadcastArea(existingShipment);
    if (!area) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Could not determine a pickup town to broadcast to — pick a sender hub or fill in the sender city/state' }),
      };
    }

    // Rider payout, frozen now — before any rider has claimed this. Reuses
    // the zone_id (and hub_id, if hub-mode) already resolved and stored on
    // this shipment at creation, just filtered to the Local Riders courier.
    let riderPayout = null;
    let riderPayoutBreakdown = null;
    if (existingShipment.zone_id) {
      try {
        const localRidersCourierId = await getLocalRidersCourierId(supabase);
        if (localRidersCourierId) {
          const riderRate = existingShipment.sender_hub_id
            ? await lookupHubOrZoneRate(supabase, {
                zoneId: existingShipment.zone_id,
                hubId: existingShipment.sender_hub_id,
                courierId: localRidersCourierId,
              })
            : await lookupShippingRate(supabase, {
                zoneId: existingShipment.zone_id,
                courierId: localRidersCourierId,
              });
          if (riderRate) {
            riderPayoutBreakdown = computeDispatchCostBreakdown(riderRate, existingShipment.item_weight || 1);
            riderPayout = riderPayoutBreakdown.total;
          }
        }
      } catch (payoutErr) {
        console.error('manual-shipment-broadcast-rider payout lookup failed:', payoutErr);
      }
    }

    const existingMetadata =
      existingShipment.metadata && typeof existingShipment.metadata === 'object' && !Array.isArray(existingShipment.metadata)
        ? existingShipment.metadata
        : {};

    const { data: updatedShipment, error } = await supabase
      .from('manual_shipments')
      .update({
        status: 'broadcasting',
        assigned_rider_id: null,
        broadcast_city: area.city,
        broadcast_state: area.state,
        broadcast_started_at: new Date().toISOString(),
        delivery_person_name: null,
        delivery_person_phone: null,
        delivery_person_vehicle: null,
        metadata: {
          ...existingMetadata,
          selected_lane: 'local_rider',
          eligible_lanes:
            Array.isArray(existingMetadata.eligible_lanes) && existingMetadata.eligible_lanes.length > 0
              ? existingMetadata.eligible_lanes
              : ['fez', 'local_rider'],
          rider_leg: toHub ? 'to_hub' : null,
        },
      })
      .eq('id', shipment_id)
      .select()
      .single();

    if (error) {
      console.error('Broadcast manual_shipment error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }

    await syncShipmentBestEffort(
      supabase,
      {
        manualShipmentId: shipment_id,
        fields: {
          status: 'broadcasting',
          assigned_rider_id: null,
          broadcast_city: area.city,
          broadcast_state: area.state,
          broadcast_started_at: updatedShipment.broadcast_started_at,
          delivery_person_name: null,
          delivery_person_phone: null,
          delivery_person_vehicle: null,
          rider_payout: riderPayout,
          rider_payout_breakdown: riderPayoutBreakdown,
          metadata: updatedShipment.metadata,
        },
      },
      'manual-shipment-broadcast-rider'
    );

    const { data: eligibleRiders } = await supabase
      .from('riders')
      .select('id, full_name, email, approved_vendor_locations!inner ( city, state )')
      .eq('status', 'active')
      .eq('is_online', true)
      .ilike('approved_vendor_locations.city', area.city)
      .ilike('approved_vendor_locations.state', area.state);

    const riders = eligibleRiders || [];
    const broadcastMessage = toHub
      ? `A hub drop-off job is available for pickup in ${area.city}. Open the app to claim it.`
      : `A delivery is available for pickup in ${area.city}. Open the app to claim it.`;
    for (const rider of riders) {
      const pushResult = await sendRiderPush(supabase, rider.id, {
        title: 'New delivery near you',
        message: broadcastMessage,
        type: 'rider_job_broadcast',
        data: { manual_shipment_id: shipment_id, targetPath: '/' },
      });
      if (!pushResult.success && !pushResult.skipped) {
        console.warn('manual-shipment-broadcast push failed:', pushResult);
      }
      if (rider.email) {
        try {
          await sendRiderAccountEmail(supabase, {
            to: rider.email,
            riderName: rider.full_name,
            subject: 'JulineMart Rider: New delivery near you',
            headline: 'New delivery near you',
            message: `${broadcastMessage} Claim it before another rider does.`,
          });
        } catch (err) {
          console.error('manual-shipment-broadcast email failed:', err?.message || err);
        }
      }
    }

    await notifyRiderArea(area.city, area.state, 'new_job', { manual_shipment_id: shipment_id });
    await notifyDispatch('manual_shipment', shipment_id, 'updated', { status: 'broadcasting' });

    try {
      await supabase.from('activity_logs').insert({
        user_id: null,
        action: 'manual_shipment_broadcast',
        resource_type: 'manual_shipment',
        resource_id: shipment_id,
        details: { city: area.city, state: area.state, riders_notified: riders.length },
      });
    } catch (logErr) {
      console.warn('Activity log failed:', logErr);
    }

    try {
      await insertTrackingEvent(supabase, {
        manual_shipment_id: shipment_id,
        status: 'broadcasting',
        description: `Broadcast to ${riders.length} online rider${riders.length === 1 ? '' : 's'} in ${area.city}, ${area.state}`,
        event_time: new Date().toISOString(),
        source: 'manual',
        source_reference: existingShipment.tracking_number,
      });
    } catch (eventErr) {
      console.warn('Broadcast manual shipment tracking event failed:', eventErr?.message || eventErr);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: updatedShipment, riders_notified: riders.length }),
    };
  } catch (error) {
    console.error('manual-shipment-broadcast-rider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', message: error?.message }),
    };
  }
};
