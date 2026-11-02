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

// Supabase Auth sends the email over the project's custom SMTP and can take 10-20s, longer than
// this function's 15s limit (netlify.toml). Stop waiting before Netlify kills us so the admin UI
// gets a real answer instead of a hung request. Auth keeps sending in the background.
const MAIL_WAIT_MS = 11000;
const TIMED_OUT = Symbol('timed-out');

const waitForMail = (promise) => {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), MAIL_WAIT_MS); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const stillSending = (email) => ({
  statusCode: 202,
  headers: { ...cors, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    success: true,
    pending: true,
    message: `The mail server is slow, so the invite to ${email} is still being sent. Check again in a minute before resending.`,
  }),
});

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

  const vendorPortalUrl = (process.env.VENDOR_PORTAL_URL || 'https://vendors.julinemart.com').replace(/\/+$/, '');
  const redirectTo = `${vendorPortalUrl}/set-password`;

  // If already linked, re-send access. First make sure the auth account's email matches the
  // vendor record: when an admin changes the vendor's email, only vendors.email is updated, and
  // resetPasswordForEmail() to an address with no auth account "succeeds" without sending anything.
  if (vendor.user_id) {
    const { data: existing } = await adminClient.auth.admin.getUserById(vendor.user_id);
    const authUser = existing?.user || null;

    // Linked auth user no longer exists — fall through and create a fresh invite below.
    if (authUser) {
      if ((authUser.email || '').toLowerCase() !== vendor.email.toLowerCase()) {
        const { error: emailErr } = await adminClient.auth.admin.updateUserById(authUser.id, {
          email: vendor.email,
          email_confirm: !!authUser.email_confirmed_at,
        });
        if (emailErr) {
          return {
            statusCode: 409,
            headers: cors,
            body: JSON.stringify({ error: `Could not change the login email to ${vendor.email}: ${emailErr.message}` }),
          };
        }
      }

      // Never confirmed (invite not accepted yet): re-send the invite itself.
      if (!authUser.email_confirmed_at) {
        const reInv = await waitForMail(adminClient.auth.admin.inviteUserByEmail(vendor.email, {
          redirectTo,
          data: { vendor_id: vendor.id, store_name: vendor.store_name },
        }));
        if (reInv === TIMED_OUT) return stillSending(vendor.email);
        const reInvErr = reInv.error;
        if (reInvErr) {
          return { statusCode: 500, headers: cors, body: JSON.stringify({ error: reInvErr.message }) };
        }
        return {
          statusCode: 200,
          headers: { ...cors, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, message: `Invite re-sent to ${vendor.email}` }),
        };
      }

      // Confirmed account: send a password-reset email so they can set/change their password.
      // NOTE: generateLink() only creates a URL — it does NOT send an email.
      // resetPasswordForEmail() actually sends the email AND honours the custom redirectTo.
      const reset = await waitForMail(adminClient.auth.resetPasswordForEmail(vendor.email, { redirectTo }));
      if (reset === TIMED_OUT) return stillSending(vendor.email);
      const resetErr = reset.error;
      if (resetErr) {
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: resetErr.message }) };
      }
      return {
        statusCode: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'Password setup email sent to ' + vendor.email }),
      };
    }
  }

  // Create auth user via invite (sends email with password-setup link)
  const inviteResult = await waitForMail(adminClient.auth.admin.inviteUserByEmail(vendor.email, {
    redirectTo,
    data: { vendor_id: vendor.id, store_name: vendor.store_name },
  }));
  // On a timeout the auth user is created but we never see its id, so the vendor is not linked yet;
  // the next "Resend invite" finds that unconfirmed account, re-sends and links it.
  if (inviteResult === TIMED_OUT) return stillSending(vendor.email);
  const { data: invited, error: invErr } = inviteResult;

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
