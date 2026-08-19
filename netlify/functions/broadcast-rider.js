// Sub-order - Broadcast to Online Riders
//
// Alternative to assign-rider.js: instead of the dispatcher hand-picking
// one rider, this offers the delivery to every online, active rider
// covering the vendor's pickup town. First rider to claim it
// (rider-jobs.js, action 'claim') wins; everyone else's app drops it.

import { createClient } from '@supabase/supabase-js';
import { assertStaffCanCreateShipment } from './services/shipmentAccess.js';
import { syncShipmentBestEffort } from './services/shipmentSync.js';
import { sendPushToCustomer } from './services/pushNotifications.js';
import { notifyRiderArea, notifyDispatch } from './services/riderRealtime.js';

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
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method Not Allowed' }) };
  }

  try {
    const access = await assertStaffCanCreateShipment(event);
    if (!access.ok) {
      return { statusCode: access.statusCode, headers, body: access.body };
    }

    const { sub_order_id, cancel } = JSON.parse(event.body || '{}');
    if (!sub_order_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing required field: sub_order_id' }) };
    }

    const { data: existingSubOrder, error: existingSubOrderError } = await supabase
      .from('sub_orders')
      .select('id, tracking_number, metadata, assigned_rider_id, status, broadcast_city, broadcast_state, vendors ( approved_vendor_locations ( city, state ) )')
      .eq('id', sub_order_id)
      .single();

    if (existingSubOrderError || !existingSubOrder) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Sub-order not found' }) };
    }

    if (cancel) {
      if (existingSubOrder.status !== 'broadcasting') {
        return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'This delivery is not currently broadcasting' }) };
      }
      const { data: cancelled, error: cancelError } = await supabase
        .from('sub_orders')
        .update({ status: 'pending', broadcast_city: null, broadcast_state: null, broadcast_started_at: null })
        .eq('id', sub_order_id)
        .select()
        .single();
      if (cancelError) return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: cancelError.message }) };

      await syncShipmentBestEffort(
        supabase,
        { subOrderId: sub_order_id, fields: { status: 'pending', broadcast_city: null, broadcast_state: null, broadcast_started_at: null } },
        'broadcast-rider cancel'
      );
      if (existingSubOrder.broadcast_city && existingSubOrder.broadcast_state) {
        await notifyRiderArea(existingSubOrder.broadcast_city, existingSubOrder.broadcast_state, 'job_removed', { sub_order_id });
      }
      await notifyDispatch('sub_order', sub_order_id, 'updated', { status: 'pending' });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: cancelled }) };
    }

    if (existingSubOrder.assigned_rider_id) {
      return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'This delivery is already assigned to a rider' }) };
    }

    const area = existingSubOrder.vendors?.approved_vendor_locations;
    if (!area?.city || !area?.state) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: "This vendor has no approved pickup town on file — can't determine who to broadcast to" }),
      };
    }

    const existingMetadata =
      existingSubOrder.metadata && typeof existingSubOrder.metadata === 'object' && !Array.isArray(existingSubOrder.metadata)
        ? existingSubOrder.metadata
        : {};

    const { data: updatedSubOrder, error } = await supabase
      .from('sub_orders')
      .update({
        status: 'broadcasting',
        assigned_rider_id: null,
        broadcast_city: area.city,
        broadcast_state: area.state,
        broadcast_started_at: new Date().toISOString(),
        rider_name: null,
        rider_phone: null,
        delivery_person_name: null,
        delivery_person_phone: null,
        delivery_person_vehicle: null,
        metadata: {
          ...existingMetadata,
          rider_accepted_at: null,
          selected_lane: 'local_rider',
          eligible_lanes:
            Array.isArray(existingMetadata.eligible_lanes) && existingMetadata.eligible_lanes.length > 0
              ? existingMetadata.eligible_lanes
              : ['fez', 'local_rider'],
        },
      })
      .eq('id', sub_order_id)
      .select()
      .single();

    if (error) {
      console.error('Broadcast sub_order error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }

    await syncShipmentBestEffort(
      supabase,
      {
        subOrderId: sub_order_id,
        fields: {
          status: 'broadcasting',
          assigned_rider_id: null,
          broadcast_city: area.city,
          broadcast_state: area.state,
          broadcast_started_at: updatedSubOrder.broadcast_started_at,
          delivery_person_name: null,
          delivery_person_phone: null,
          delivery_person_vehicle: null,
          metadata: updatedSubOrder.metadata,
        },
      },
      'broadcast-rider'
    );

    const { data: eligibleRiders } = await supabase
      .from('riders')
      .select('id, approved_vendor_locations!inner ( city, state )')
      .eq('status', 'active')
      .eq('is_online', true)
      .ilike('approved_vendor_locations.city', area.city)
      .ilike('approved_vendor_locations.state', area.state);

    const riders = eligibleRiders || [];
    for (const rider of riders) {
      const pushResult = await sendPushToCustomer(rider.id, {
        title: 'New delivery near you',
        message: `A delivery is available for pickup in ${area.city}. Open the app to claim it.`,
        type: 'rider_job_broadcast',
        data: { sub_order_id, targetPath: '/' },
      });
      if (!pushResult.success && !pushResult.skipped) {
        console.warn('broadcast-rider push failed:', pushResult);
      }
    }

    await notifyRiderArea(area.city, area.state, 'new_job', { sub_order_id });
    await notifyDispatch('sub_order', sub_order_id, 'updated', { status: 'broadcasting' });

    await supabase.from('tracking_events').insert({
      sub_order_id,
      status: 'broadcasting',
      description: `Broadcast to ${riders.length} online rider${riders.length === 1 ? '' : 's'} in ${area.city}, ${area.state}`,
      actor_type: 'user',
      source: 'manual_assignment',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: updatedSubOrder, riders_notified: riders.length }),
    };
  } catch (error) {
    console.error('broadcast-rider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', message: error?.message }),
    };
  }
};
