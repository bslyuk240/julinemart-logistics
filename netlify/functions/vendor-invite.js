/**
 * vendor-invite.js
 * Admin endpoint: send a Supabase Auth invite to an existing vendor.
 * POST /api/vendor-invite  { vendor_id }
 * Links vendors.user_id once the auth user is created.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  // Require admin auth
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const adminClient = createClient(supabaseUrl, serviceKey);

  // Verify caller is an admin
  const anonClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid token' }) };
  }
  const { data: profile } = await adminClient
    .from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'shop_manager'].includes(profile.role)) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const { vendor_id } = JSON.parse(event.body || '{}');
  if (!vendor_id) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'vendor_id required' }) };
  }

  // Fetch vendor record
  const { data: vendor, error: vErr } = await adminClient
    .from('vendors')
    .select('id, store_name, email, user_id')
    .eq('id', vendor_id)
    .single();

  if (vErr || !vendor) {
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Vendor not found' }) };
  }
  if (!vendor.email) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Vendor has no email address on record' }) };
  }

  // Guard against placeholder emails generated during WooCommerce migration
  const placeholderDomains = ['@wcfm.local', '@placeholder.', '@example.com', '@localhost'];
  if (placeholderDomains.some(d => vendor.email.toLowerCase().includes(d))) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({
        error: `Cannot send invite — "${vendor.email}" is a placeholder email. Please update this vendor's real email address first.`,
        placeholder: true,
      }),
    };
  }

  const vendorPortalUrl = (process.env.VENDOR_PORTAL_URL || 'https://vendors-julinemart.netlify.app').replace(/\/+$/, '');
  const redirectTo = `${vendorPortalUrl}/set-password`;

  // If already linked, resend a password-reset link so they can set/reset their password
  if (vendor.user_id) {
    const { data: resetLink, error: magicErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: vendor.email,
      options: { redirectTo },
    });
    if (magicErr) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: magicErr.message }) };
    }
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Password setup link resent to ' + vendor.email }),
    };
  }

  // Create auth user via invite (sends email with password-setup link)
  const { data: invited, error: invErr } = await adminClient.auth.admin.inviteUserByEmail(vendor.email, {
    redirectTo,
    data: { vendor_id: vendor.id, store_name: vendor.store_name },
  });

  if (invErr) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: invErr.message }) };
  }

  // Link user_id on vendor record
  await adminClient
    .from('vendors')
    .update({ user_id: invited.user.id })
    .eq('id', vendor.id);

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      message: `Invite sent to ${vendor.email}`,
      auth_user_id: invited.user.id,
    }),
  };
};
