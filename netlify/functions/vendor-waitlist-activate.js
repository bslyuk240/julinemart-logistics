/**
 * vendor-waitlist-activate.js — Admin only
 * Called when admin marks a city as 'active' in approved_vendor_locations.
 * Finds all un-notified waitlist entries for that city and sends them
 * an activation email with a link to the registration form.
 *
 * POST /.netlify/functions/vendor-waitlist-activate
 * Body: { location_id }   — the approved_vendor_locations.id that just went live
 */
import { createClient } from '@supabase/supabase-js';
import { sendTransactionalEmail } from './services/emailNotifications.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

async function requireAdmin(event, adminClient) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const anonClient = createClient(
    supabaseUrl,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user } } = await anonClient.auth.getUser();
  if (!user) return null;

  const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'manager'].includes(profile.role)) return null;
  return user;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const adminClient = createClient(supabaseUrl, serviceKey);
  const user = await requireAdmin(event, adminClient);
  if (!user) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { location_id } = body;
  if (!location_id) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'location_id required' }) };
  }

  // Fetch the location that just went live
  const { data: location, error: locErr } = await adminClient
    .from('approved_vendor_locations')
    .select('state, city, lga, status')
    .eq('id', location_id)
    .single();

  if (locErr || !location) {
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Location not found' }) };
  }
  if (location.status !== 'active') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Location is not active. Set it to active first.' }) };
  }

  // Find all un-notified waitlist entries for this city
  const { data: entries, error: wlErr } = await adminClient
    .from('vendor_location_waitlist')
    .select('id, full_name, email, city, state, lga')
    .eq('state', location.state)
    .eq('city', location.city)
    .is('notified_at', null);

  if (wlErr) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to fetch waitlist' }) };
  }

  if (!entries || entries.length === 0) {
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, notified: 0, message: 'No un-notified waitlist entries for this location.' }),
    };
  }

  const portalBase = (process.env.VENDOR_PORTAL_URL || 'https://vendors.julinemart.com').replace(/\/+$/, '');
  const registrationUrl = `${portalBase}/register`;
  const now = new Date().toISOString();
  let notified = 0;

  for (const entry of entries) {
    const emailResult = await sendTransactionalEmail({
      templateName: 'Vendor Waitlist Activation',
      to: entry.email,
      data: {
        vendor_name:       entry.full_name,
        city:              location.city,
        state:             location.state,
        lga:               location.lga,
        registration_url:  registrationUrl,
        support_email:     process.env.SUPPORT_EMAIL || 'support@julinemart.com',
      },
    }).catch((err) => {
      console.error(`activation email failed for ${entry.email}:`, err);
      return null;
    });

    if (emailResult !== null) {
      await adminClient
        .from('vendor_location_waitlist')
        .update({ notified_at: now })
        .eq('id', entry.id);
      notified++;
    }
  }

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      notified,
      total: entries.length,
      message: `Activation emails sent to ${notified} of ${entries.length} waitlisted vendors for ${location.city}, ${location.state}.`,
    }),
  };
};
