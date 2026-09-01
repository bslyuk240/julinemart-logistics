/**
 * Admin queue for campaigns submitted for review — vendor-submitted
 * (vendor_id set) and, as of the giveaway engine's Skola integration,
 * agent-proposed giveaway campaigns (submitted_via='skola_agent', no vendor)
 * via campaigns.giveaway.submit in public-api.js. Same queue, same
 * approval_status lifecycle — kept as one function rather than forking a
 * second approval pipeline. See admin-vendor-campaigns.js's approve branch
 * for the one behavioral difference: vendor campaigns auto-activate on
 * approval, agent-proposed ones don't.
 * GET  /api/admin-vendor-campaigns?status=pending|approved|rejected|all
 * POST /api/admin-vendor-campaign-approve { id, action: approve|reject, review_notes? }
 */
import { createClient } from '@supabase/supabase-js';
import { corsHeaders, preflightResponse } from './services/cors.js';

const adminClient = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

async function requireAdmin(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return { error: 'Unauthorized', status: 401 };

  const anonClient = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error } = await anonClient.auth.getUser();
  if (error || !user) return { error: 'Invalid token', status: 401 };

  const { data: profile } = await adminClient.from('users').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Forbidden', status: 403 };
  }
  return { user };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();

  const auth = await requireAdmin(event);
  if (auth.error) {
    return { statusCode: auth.status, headers: corsHeaders(), body: JSON.stringify({ error: auth.error }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const url = new URL(event.rawUrl);
      const status = url.searchParams.get('status') || 'pending';

      let query = adminClient
        .from('campaigns')
        .select(`
          id, slug, public_title, status, approval_status, submitted_via, submitted_at, reviewed_at, review_notes,
          hero_config, offer_config, secret_code, grand_prize_description, created_at, updated_at,
          vendors ( id, store_name, email, city, state, woocommerce_vendor_id )
        `)
        .not('submitted_via', 'is', null)
        .order('submitted_at', { ascending: false, nullsFirst: false })
        .limit(100);

      if (status !== 'all') query = query.eq('approval_status', status);

      const { data, error } = await query;
      if (error) throw error;

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ success: true, data: data || [] }),
      };
    }

    if (event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const { id, action, review_notes: reviewNotes } = body;
      if (!id || !['approve', 'reject'].includes(action)) {
        throw new Error('id and action (approve|reject) are required');
      }

      const { data: campaign, error: fetchErr } = await adminClient
        .from('campaigns')
        .select('id, vendor_id, submitted_via, approval_status, start_date, end_date')
        .eq('id', id)
        .not('submitted_via', 'is', null)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!campaign) throw new Error('Campaign submission not found');

      const now = new Date().toISOString();
      const updates = {
        reviewed_at: now,
        reviewed_by: auth.user.id,
        review_notes: reviewNotes || null,
        approval_status: action === 'approve' ? 'approved' : 'rejected',
        updated_at: now,
      };

      // Vendor campaigns auto-activate on approval — low-stakes, the
      // vendor's own products, matches existing behavior. Skola-agent
      // giveaway proposals do NOT: approval only unlocks it for a human to
      // finish in the Giveaways admin page (attach the real reward
      // voucher(s), double check the secret code, confirm dates) before it
      // goes live — a real prize going straight live off an AI draft is a
      // different risk than a vendor's own promo page doing the same.
      if (action === 'approve' && campaign.submitted_via === 'vendor') {
        updates.status = 'active';
        if (!campaign.start_date) updates.start_date = now;
        const endOk = !campaign.end_date || new Date(campaign.end_date).getTime() > Date.now();
        if (!endOk) updates.status = 'expired';
      }

      const { data: updated, error: updateErr } = await adminClient
        .from('campaigns')
        .update(updates)
        .eq('id', id)
        .select('id, slug, approval_status, status')
        .single();

      if (updateErr) throw updateErr;

      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ success: true, data: updated }),
      };
    }

    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: err?.message || 'Request failed' }),
    };
  }
}
