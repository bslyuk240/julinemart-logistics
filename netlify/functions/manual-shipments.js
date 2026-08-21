// Manual Shipments — ad-hoc waybills not tied to any customer order or
// return request. List / detail / create only; dispatch is a separate
// action (manual-shipment-fez-dispatch.js / manual-shipment-assign-rider.js),
// same as orders (create first, dispatch second).

import { createClient } from '@supabase/supabase-js';
import { assertStaffCanCreateShipment, assertStaffCanReadShipments } from './services/shipmentAccess.js';
import { resolveZoneForState, lookupHubOrZoneRate, lookupShippingRate, computeDispatchCost } from './services/shippingRateLookup.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL || '', SERVICE_KEY || '');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const LIST_FIELDS = 'id, shipment_code, recipient, status, tracking_number, waybill_number, created_at';

function generateShipmentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let code = 'MSH-';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function normalizeOptionalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Supabase not configured on server' }) };
  }

  try {
    const parts = event.path.split('/');
    const idx = parts.findIndex((p) => p === 'manual-shipments');
    const id = idx >= 0 && parts.length > idx + 1 ? parts[idx + 1] : undefined;

    if (event.httpMethod === 'GET') {
      const readAccess = await assertStaffCanReadShipments(event);
      if (!readAccess.ok) {
        return { statusCode: readAccess.statusCode, headers, body: readAccess.body };
      }

      if (id) {
        const { data, error } = await supabase
          .from('manual_shipments')
          .select('*')
          .eq('id', id)
          .single();
        if (error || !data) {
          return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Manual shipment not found' }) };
        }

        const { data: events } = await supabase
          .from('tracking_events')
          .select('id, status, description, location_name, event_time, created_at, source')
          .eq('manual_shipment_id', id)
          .order('event_time', { ascending: true, nullsFirst: false });

        // delivery_proof_url/signature_url aren't manual_shipments columns —
        // they only exist on the unified shipments table for this source
        // type (see shipmentSync.js), same as picked_up_at/delivered_at/etc.
        const { data: shipmentRow } = await supabase
          .from('shipments')
          .select('delivery_proof_url, signature_url')
          .eq('manual_shipment_id', id)
          .maybeSingle();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            data: {
              ...data,
              delivery_proof_url: shipmentRow?.delivery_proof_url || null,
              signature_url: shipmentRow?.signature_url || null,
              tracking_events: (events || []).map((e) => ({
                status: e.status,
                description: e.description,
                location: e.location_name || null,
                timestamp: e.event_time || e.created_at,
                source: e.source,
              })),
            },
          }),
        };
      }

      const params = new URLSearchParams(event.queryStringParameters || {});
      const status = params.get('status');
      let query = supabase.from('manual_shipments').select(LIST_FIELDS).order('created_at', { ascending: false });
      if (status && status !== 'all') query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: data || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const access = await assertStaffCanCreateShipment(event);
      if (!access.ok) {
        return { statusCode: access.statusCode, headers, body: access.body };
      }

      const body = JSON.parse(event.body || '{}');
      const recipient = body.recipient || {};
      const missing = ['name', 'phone', 'address', 'state'].filter((k) => !recipient[k]);
      if (missing.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: `Missing required recipient field(s): ${missing.join(', ')}` }),
        };
      }
      if (!body.item_description) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'item_description is required' }) };
      }

      const recipientEmail = normalizeOptionalEmail(recipient.email);
      if (recipient.email && !recipientEmail) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'recipient.email is invalid' }),
        };
      }

      let sender = null;
      let senderHubId = null;

      if (body.sender_hub_id) {
        const { data: hub, error: hubError } = await supabase
          .from('hubs')
          .select('id, name, address, city, state, phone')
          .eq('id', body.sender_hub_id)
          .single();
        if (hubError || !hub) {
          return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Selected hub not found' }) };
        }
        senderHubId = hub.id;
        sender = { name: hub.name, address: hub.address, city: hub.city, state: hub.state, phone: hub.phone };
      } else if (body.sender) {
        const senderMissing = ['name', 'address', 'state'].filter((k) => !body.sender[k]);
        if (senderMissing.length > 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: `Missing required sender field(s): ${senderMissing.join(', ')}` }),
          };
        }
        // Optional — every sender today is JulineMart's own hub or a vendor,
        // neither of which has always had a natural per-shipment email to
        // collect, so this stays opt-in rather than required (mirrors
        // recipient.email's own optionality above).
        const senderEmail = normalizeOptionalEmail(body.sender.email);
        if (body.sender.email && !senderEmail) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: 'sender.email is invalid' }),
          };
        }
        sender = {
          name: body.sender.name,
          address: body.sender.address,
          city: body.sender.city || '',
          state: body.sender.state,
          phone: body.sender.phone || '',
          ...(senderEmail ? { email: senderEmail } : {}),
        };
      } else {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'sender_hub_id or sender is required' }) };
      }

      let createdBy = null;
      const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        const { data: authData } = await supabase.auth.getUser(authHeader.slice('Bearer '.length));
        if (authData?.user) createdBy = authData.user.id;
      }

      // Price it now, same as an order gets priced at checkout — a manual
      // shipment shouldn't exist without a real shipping_fee to charge the
      // sender. Hub-mode prices by the destination zone (mirrors a
      // sub-order's hub-based dispatch); no-hub "manual" mode prices by the
      // sender's own pickup zone instead (mirrors calc-shipping.js's
      // vendor_direct branch, which prices by the pickup point's zone).
      const itemWeight = body.item_weight ? Number(body.item_weight) : 1;
      let priceZone;
      let rate;
      try {
        if (senderHubId) {
          priceZone = await resolveZoneForState(supabase, recipient.state);
          if (priceZone) rate = await lookupHubOrZoneRate(supabase, { zoneId: priceZone.id, hubId: senderHubId });
        } else {
          priceZone = await resolveZoneForState(supabase, sender.state);
          if (priceZone) rate = await lookupShippingRate(supabase, { zoneId: priceZone.id });
        }
      } catch (rateErr) {
        console.error('Manual shipment rate lookup error:', rateErr);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Failed to price shipment' }) };
      }

      if (!priceZone || !rate) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'No shipping rate configured for this zone yet — add one via Admin → Rates before creating this shipment.',
          }),
        };
      }

      const shippingFee = computeDispatchCost(rate, itemWeight);
      const shipmentCode = generateShipmentCode();

      const { data: shipment, error: insertError } = await supabase
        .from('manual_shipments')
        .insert({
          shipment_code: shipmentCode,
          sender_hub_id: senderHubId,
          sender,
          recipient: {
            name: recipient.name,
            address: recipient.address,
            city: recipient.city || '',
            state: recipient.state,
            phone: recipient.phone,
            ...(recipientEmail ? { email: recipientEmail } : {}),
          },
          item_description: body.item_description,
          item_weight: itemWeight,
          item_value: body.item_value ? Number(body.item_value) : 0,
          zone_id: priceZone.id,
          shipping_fee: shippingFee,
          created_by: createdBy,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Manual shipment insert error:', insertError);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: insertError.message }) };
      }

      try {
        await supabase.from('activity_logs').insert({
          user_id: createdBy,
          action: 'manual_shipment_created',
          resource_type: 'manual_shipment',
          resource_id: shipment.id,
          details: { shipment_code: shipmentCode, recipient: shipment.recipient },
        });
      } catch (logErr) {
        console.warn('Activity log failed:', logErr);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: shipment }) };
    }

    // Destination-hub only, not a general edit endpoint — this is the one
    // field a dispatcher decides post-creation (whether a local rider
    // should collect this and drop it at a hub for onward Fez dispatch;
    // see rider-jobs.js's 'at_hub' status / manual-shipment-assign-rider.js's
    // destination:'hub' mode).
    if (event.httpMethod === 'PUT' && id) {
      const access = await assertStaffCanCreateShipment(event);
      if (!access.ok) {
        return { statusCode: access.statusCode, headers, body: access.body };
      }

      const body = JSON.parse(event.body || '{}');
      if (!('destination_hub_id' in body)) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'destination_hub_id is required' }) };
      }
      const destinationHubId = body.destination_hub_id || null;

      const { data, error } = await supabase
        .from('manual_shipments')
        .update({ destination_hub_id: destinationHubId })
        .eq('id', id)
        .select('id, destination_hub_id')
        .maybeSingle();

      if (error) return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
      if (!data) return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Manual shipment not found' }) };

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    if (event.httpMethod === 'DELETE') {
      if (!id) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Shipment ID required' }) };
      }

      const access = await assertStaffCanCreateShipment(event);
      if (!access.ok) {
        return { statusCode: access.statusCode, headers, body: access.body };
      }

      const { data: existing, error: fetchError } = await supabase
        .from('manual_shipments')
        .select('id, shipment_code, status, tracking_number, delivery_person_name')
        .eq('id', id)
        .single();

      if (fetchError || !existing) {
        return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Manual shipment not found' }) };
      }

      if (existing.tracking_number || existing.delivery_person_name) {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'Cannot delete a dispatched manual shipment. Only pending shipments can be removed.',
          }),
        };
      }

      const { error: deleteError } = await supabase.from('manual_shipments').delete().eq('id', id);
      if (deleteError) {
        console.error('Manual shipment delete error:', deleteError);
        return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: deleteError.message }) };
      }

      let deletedBy = null;
      const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
      if (authHeader.startsWith('Bearer ')) {
        const { data: authData } = await supabase.auth.getUser(authHeader.slice('Bearer '.length));
        if (authData?.user) deletedBy = authData.user.id;
      }

      try {
        await supabase.from('activity_logs').insert({
          user_id: deletedBy,
          action: 'manual_shipment_deleted',
          resource_type: 'manual_shipment',
          resource_id: id,
          details: { shipment_code: existing.shipment_code },
        });
      } catch (logErr) {
        console.warn('Activity log failed:', logErr);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Manual shipment deleted' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  } catch (error) {
    console.error('manual-shipments error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error', message: error?.message }),
    };
  }
}
