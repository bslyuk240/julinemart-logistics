// Manual Shipments — ad-hoc waybills not tied to any customer order or
// return request. List / detail / create only; dispatch is a separate
// action (manual-shipment-fez-dispatch.js / manual-shipment-assign-rider.js),
// same as orders (create first, dispatch second).

import { createClient } from '@supabase/supabase-js';
import { assertStaffCanCreateShipment, assertStaffCanReadShipments } from './services/shipmentAccess.js';

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
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
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
        sender = {
          name: body.sender.name,
          address: body.sender.address,
          city: body.sender.city || '',
          state: body.sender.state,
          phone: body.sender.phone || '',
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
          },
          item_description: body.item_description,
          item_weight: body.item_weight ? Number(body.item_weight) : 1,
          item_value: body.item_value ? Number(body.item_value) : 0,
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
