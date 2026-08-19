// Manual Shipment - Assign Local Rider
// Near-verbatim of assign-rider.js's DB-write mechanics, retargeted at
// manual_shipments, with the order-linked side effects stripped (no
// customer account to push-notify or email here).

import { createClient } from '@supabase/supabase-js';
import { assertStaffCanCreateShipment } from './services/shipmentAccess.js';
import { notifyManualShipmentRiderAssigned } from './services/manualShipmentNotify.js';
import { insertTrackingEvent } from './services/fezTracking.js';
import { sendPushToCustomer } from './services/pushNotifications.js';
import { syncShipmentBestEffort } from './services/shipmentSync.js';
import { notifyRider, notifyRiderArea, notifyDispatch } from './services/riderRealtime.js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function generateJloTracking() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = 'JLO-';
  for (let i = 0; i < 8; i++) {
    value += chars[Math.floor(Math.random() * chars.length)];
  }
  return value;
}

function shouldGenerateLocalTracking(value) {
  if (!value || typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^(FEZ|CR)-/i.test(trimmed)) return true;
  if (/^[0-9a-f-]{36}$/i.test(trimmed)) return true;
  if (/error|cannot|failed|invalid|wrong|already exists/i.test(trimmed)) return true;
  return false;
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

    const { shipment_id, rider_id } = JSON.parse(event.body || '{}');

    if (!shipment_id || !rider_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Missing required fields: shipment_id, rider_id' }),
      };
    }

    const { data: rider, error: riderLookupError } = await supabase
      .from('riders')
      .select('id, full_name, phone, vehicle_type, vehicle_plate, status')
      .eq('id', rider_id)
      .maybeSingle();

    if (riderLookupError || !rider) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Rider not found' }) };
    }
    if (rider.status !== 'active') {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'This rider is not active' }) };
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
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Local rider courier not configured in system' }) };
    }

    const { data: existingShipment, error: existingError } = await supabase
      .from('manual_shipments')
      .select('*')
      .eq('id', shipment_id)
      .single();

    if (existingError || !existingShipment) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Manual shipment not found' }) };
    }

    const nextTrackingNumber = shouldGenerateLocalTracking(existingShipment.tracking_number)
      ? generateJloTracking()
      : existingShipment.tracking_number;
    const existingMetadata =
      existingShipment.metadata && typeof existingShipment.metadata === 'object' && !Array.isArray(existingShipment.metadata)
        ? existingShipment.metadata
        : {};

    let waybillNumber = existingShipment.waybill_number || null;
    if (!waybillNumber) {
      const { data: nextNumber, error: wbError } = await supabase.rpc('next_waybill_number');
      if (wbError) {
        console.error('waybill number generation failed:', wbError);
      } else {
        waybillNumber = nextNumber;
      }
    }

    const { data: updatedShipment, error } = await supabase
      .from('manual_shipments')
      .update({
        courier_id: localCourier.id,
        tracking_number: nextTrackingNumber,
        delivery_person_name: rider_name,
        delivery_person_phone: rider_phone,
        delivery_person_vehicle: rider_vehicle || null,
        status: 'assigned',
        assigned_rider_id: rider.id,
        broadcast_city: null,
        broadcast_state: null,
        broadcast_started_at: null,
        ...(waybillNumber ? { waybill_number: waybillNumber } : {}),
        metadata: {
          ...existingMetadata,
          selected_lane: 'local_rider',
          eligible_lanes:
            Array.isArray(existingMetadata.eligible_lanes) && existingMetadata.eligible_lanes.length > 0
              ? existingMetadata.eligible_lanes
              : ['fez', 'local_rider'],
        },
      })
      .eq('id', shipment_id)
      .select()
      .single();

    if (error) {
      console.error('Update manual_shipment error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
    }

    await syncShipmentBestEffort(
      supabase,
      {
        manualShipmentId: shipment_id,
        fields: {
          courier_id: localCourier.id,
          assigned_rider_id: rider.id,
          status: 'assigned',
          tracking_number: updatedShipment.tracking_number,
          waybill_number: updatedShipment.waybill_number,
          delivery_person_name: rider_name,
          delivery_person_phone: rider_phone,
          delivery_person_vehicle: rider_vehicle || null,
          metadata: updatedShipment.metadata,
        },
      },
      'manual-shipment-assign-rider'
    );

    const riderPushResult = await sendPushToCustomer(rider.id, {
      title: 'New delivery assigned',
      message: `You've been assigned tracking #${nextTrackingNumber}. Open the app to accept.`,
      type: 'rider_job_assigned',
      data: { manual_shipment_id: shipment_id, targetPath: '/' },
    });
    if (!riderPushResult.success && !riderPushResult.skipped) {
      console.warn('manual-shipment-assign-rider push (to rider) failed:', riderPushResult);
    }

    await notifyRider(rider.id, 'job_assigned', { manual_shipment_id: shipment_id });
    await notifyDispatch('manual_shipment', shipment_id, 'updated', { status: 'assigned' });
    if (existingShipment.status === 'broadcasting' && existingShipment.broadcast_city && existingShipment.broadcast_state) {
      await notifyRiderArea(existingShipment.broadcast_city, existingShipment.broadcast_state, 'job_removed', { manual_shipment_id: shipment_id });
    }

    try {
      await supabase.from('activity_logs').insert({
        user_id: null,
        action: 'manual_shipment_rider_assigned',
        resource_type: 'manual_shipment',
        resource_id: shipment_id,
        details: { rider_name, rider_phone, rider_vehicle: rider_vehicle || null },
      });
    } catch (logErr) {
      console.warn('Activity log failed:', logErr);
    }

    try {
      await insertTrackingEvent(supabase, {
        manual_shipment_id: shipment_id,
        status: 'assigned',
        description: `Local rider assigned — ${rider_name}`,
        event_time: new Date().toISOString(),
        source: 'manual',
        source_reference: nextTrackingNumber,
      });
    } catch (eventErr) {
      console.warn('Initial manual shipment tracking event failed:', eventErr?.message || eventErr);
    }

    try {
      await notifyManualShipmentRiderAssigned(supabase, updatedShipment, {
        rider_name,
        rider_phone,
        rider_vehicle: rider_vehicle || null,
      });
    } catch (mailErr) {
      console.error('manual shipment rider email:', mailErr?.message || mailErr);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: updatedShipment }) };
  } catch (error) {
    console.error('manual-shipment-assign-rider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', message: error?.message }),
    };
  }
};
