/**
 * influencer-invite.js
 * Admin endpoint: send a Supabase Auth invite to an existing influencer.
 * POST /api/influencer-invite  { influencer_id }
 * Links influencers.user_id once the auth user is created.
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
  if (!profile || !['admin', 'shop_manager', 'manager'].includes(profile.role)) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const { influencer_id } = JSON.parse(event.body || '{}');
  if (!influencer_id) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'influencer_id required' }) };
  }

  // Fetch influencer record
  const { data: influencer, error: iErr } = await adminClient
    .from('influencers')
    .select('id, name, email, user_id')
    .eq('id', influencer_id)
    .single();

  if (iErr || !influencer) {
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Influencer not found' }) };
  }
  if (!influencer.email) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Influencer has no email address on record' }) };
  }

  // Guard against placeholder/incomplete emails
  const placeholderDomains = ['@wcfm.local', '@placeholder.', '@example.com', '@localhost'];
  if (placeholderDomains.some(d => influencer.email.toLowerCase().includes(d))) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({
        error: `Cannot send invite — "${influencer.email}" is a placeholder email. Please update this influencer's real email address first.`,
        placeholder: true,
      }),
    };
  }

  const influencerPortalUrl = (process.env.INFLUENCER_PORTAL_URL || 'https://influencer.julinemart.com').replace(/\/+$/, '');
  const redirectTo = `${influencerPortalUrl}/set-password`;

  // If already linked, send a password-reset email so they can set/change their password.
  // NOTE: generateLink() only creates a URL — it does NOT send an email.
  // resetPasswordForEmail() actually sends the email AND honours the custom redirectTo.
  if (influencer.user_id) {
    const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(influencer.email, { redirectTo });
    if (resetErr) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: resetErr.message }) };
    }
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Password setup email sent to ' + influencer.email }),
    };
  }

  // Create auth user via invite (sends email with password-setup link)
  const { data: invited, error: invErr } = await adminClient.auth.admin.inviteUserByEmail(influencer.email, {
    redirectTo,
    data: { influencer_id: influencer.id, name: influencer.name },
  });

  if (invErr) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: invErr.message }) };
  }

  // Link user_id on influencer record
  await adminClient
    .from('influencers')
    .update({ user_id: invited.user.id })
    .eq('id', influencer.id);

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      message: `Invite sent to ${influencer.email}`,
      auth_user_id: invited.user.id,
    }),
  };
};
