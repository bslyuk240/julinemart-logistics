/**
 * GET /.netlify/functions/track-manual-shipment?trackingNumber=IK0Y...&phone=08064205290
 *
 * Public endpoint — verify recipient phone, return manual shipment + tracking events.
 * trackingNumber matches waybill_number, tracking_number, courier_waybill, or shipment_code (MSH-...).
 */

import { adminClient } from './services/global-sourcing-utils.js';
import { findManualShipmentByScan, normalizeScanCode } from './services/scanLookup.js';
import { checkRateLimit } from './services/rate-limit.js';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function phonesMatch(stored, provided) {
  const a = normalizePhone(stored);
  const b = normalizePhone(provided);
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

async function findManualShipment(trackingNumber) {
  if (!adminClient) return null;
  return findManualShipmentByScan(adminClient, trackingNumber);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  const { trackingNumber, phone } = event.queryStringParameters || {};
  const normalizedTracking = normalizeScanCode(trackingNumber || '');

  if (!adminClient) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ success: false, error: 'Database not configured' }) };
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'track-manual-shipment',
    max: 15,
    window: '5 m',
    retryAfterSeconds: 300,
  });
  if (limited) return response;

  if (!normalizedTracking || !phone) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ success: false, error: 'trackingNumber and phone are required' }),
    };
  }

  const shipment = await findManualShipment(normalizedTracking);
  if (!shipment) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Shipment not found. Check your tracking number and recipient phone.',
      }),
    };
  }

  const recipientPhone = shipment.recipient?.phone;
  if (!phonesMatch(recipientPhone, phone)) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Shipment not found. Check your tracking number and recipient phone.',
      }),
    };
  }

  const { data: events } = await adminClient
    .from('tracking_events')
    .select('status, description, location_name, event_time, created_at, metadata')
    .eq('manual_shipment_id', shipment.id)
    .order('event_time', { ascending: true, nullsFirst: false });

  // Rider-reported problems (report_problem in rider-jobs.js) are staff-only
  // — they can carry things like "customer refused delivery" or a rider's
  // private note, which must never reach the customer's own tracking page.
  const tracking_events = (events || [])
    .filter((e) => e.metadata?.type !== 'problem_report')
    .map((e) => ({
    status: e.status,
    description: e.description,
    location: e.location_name || null,
    timestamp: e.event_time || e.created_at,
  }));

  let courier = null;
  if (shipment.courier_id) {
    const { data: cRow } = await adminClient
      .from('couriers')
      .select('name, code')
      .eq('id', shipment.courier_id)
      .maybeSingle();
    courier = cRow;
  }

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      success: true,
      data: {
        id: shipment.id,
        shipment_code: shipment.shipment_code,
        status: shipment.status,
        tracking_number: shipment.tracking_number,
        courier_tracking_url: shipment.courier_tracking_url,
        waybill_number: shipment.waybill_number,
        sender: shipment.sender,
        recipient: shipment.recipient,
        item_description: shipment.item_description,
        item_weight: shipment.item_weight,
        item_value: shipment.item_value,
        delivery_person_name: shipment.delivery_person_name,
        delivery_person_phone: shipment.delivery_person_phone,
        last_tracking_update: shipment.last_tracking_update,
        created_at: shipment.created_at,
        couriers: courier,
        tracking_events,
      },
    }),
  };
}
