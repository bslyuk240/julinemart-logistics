/**
 * vendor-approve.js — Admin only
 * Approve or reject a vendor KYC application.
 *
 * POST /api/vendor-approve
 * Body: { application_id, action: 'approve' | 'reject', reject_reason? }
 *
 * On approve:
 *   1. Creates Supabase Auth user (invite email sent)
 *   2. Creates vendors record
 *   3. Updates vendor_applications status → 'approved'
 *
 * On reject:
 *   1. Updates vendor_applications status → 'rejected'
 *   2. TODO: send rejection email
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

  const adminClient = createClient(supabaseUrl, serviceKey);

  // Verify admin
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const anonClient = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '', {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await anonClient.auth.getUser();
  if (authErr || !user) return { statusCode: 401, headers: cors, body: JSON.stringify({ error: 'Invalid token' }) };

  const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { application_id, action, reject_reason } = body;
  if (!application_id || !action) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'application_id and action required' }) };
  }

  // Fetch application
  const { data: app, error: appErr } = await adminClient
    .from('vendor_applications')
    .select('*')
    .eq('id', application_id)
    .single();

  if (appErr || !app) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Application not found' }) };
  if (app.status !== 'pending') {
    return { statusCode: 409, headers: cors, body: JSON.stringify({ error: `Application already ${app.status}` }) };
  }

  // ── REJECT ──────────────────────────────────────────────────────────
  if (action === 'reject') {
    await adminClient.from('vendor_applications').update({
      status: 'rejected',
      reject_reason: reject_reason || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    }).eq('id', application_id);

    // TODO: send rejection email to app.email

    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Application rejected' }),
    };
  }

  // ── APPROVE ─────────────────────────────────────────────────────────
  if (action !== 'approve') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action must be approve or reject' }) };
  }

  /** Synthetic WC id for vendors created only in JLO (no WooCommerce row). Must fit VARCHAR(50) and stay UNIQUE. */
  const syntheticWooId = `jlo-${application_id}`;

  function slugifyStoreSlug(name) {
    const base = String(name || 'store')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    return base || 'store';
  }

  // 1. Create Supabase Auth user (invite)
  const portalBase = (process.env.VENDOR_PORTAL_URL || 'https://vendors.julinemart.com').replace(/\/+$/, '');
  const redirectTo = `${portalBase}/set-password`;
  const { data: invited, error: invErr } = await adminClient.auth.admin.inviteUserByEmail(app.email, {
    redirectTo,
    data: { store_name: app.store_name },
  });

  if (invErr) {
    console.error('invite error:', invErr);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to create auth account: ' + invErr.message }) };
  }

  // 2. Create vendors record (DB requires woocommerce_vendor_id; column is `address` not business_address)
  const store_slug = `${slugifyStoreSlug(app.store_name)}-${String(application_id).slice(0, 8)}`;

  const { data: vendor, error: vErr } = await adminClient.from('vendors').insert({
    woocommerce_vendor_id: syntheticWooId,
    store_name:            app.store_name,
    store_slug,
    email:                 app.email,
    phone:                 app.phone,
    address:               app.business_address,
    state:                 app.state,
    city:                  app.city,
    bank_name:             app.bank_name,
    bank_account_number:   app.bank_account_number,
    bank_account_name:     app.bank_account_name,
    commission_rate:       10,
    is_active:             true,
    user_id:               invited.user.id,
  }).select().single();

  if (vErr) {
    console.error('vendor insert error:', vErr);
    await adminClient.auth.admin.deleteUser(invited.user.id);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to create vendor record',
        detail: vErr.message || String(vErr),
        code: vErr.code,
      }),
    };
  }

  // 3. Mark application approved
  await adminClient.from('vendor_applications').update({
    status:      'approved',
    vendor_id:   vendor.id,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
  }).eq('id', application_id);

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      vendor_id: vendor.id,
      message: `Approved! Invite email sent to ${app.email}`,
    }),
  };
};
