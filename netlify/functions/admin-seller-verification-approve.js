/**
 * Approve or reject a seller verification.
 * POST /api/admin-seller-verification-approve
 * Body: { id, action: 'approve' | 'reject', reject_reason? }
 */
import { createClient } from '@supabase/supabase-js';
import { recordStaffAudit } from './services/auditLog.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  const adminClient = createClient(supabaseUrl, serviceKey);
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

  const { id, action, reject_reason } = body;
  if (!id || !['approve', 'reject'].includes(action)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'id and action (approve|reject) required' }) };
  }

  const { data: row, error: fetchErr } = await adminClient
    .from('seller_verifications')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !row) {
    return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Verification not found' }) };
  }

  const patch =
    action === 'approve'
      ? {
          status: 'approved',
          verified_at: new Date().toISOString(),
          reviewed_by: user.id,
          reject_reason: null,
        }
      : {
          status: 'rejected',
          reviewed_by: user.id,
          reject_reason: reject_reason || 'Rejected by admin',
          verified_at: null,
        };

  const { data: updated, error: updateErr } = await adminClient
    .from('seller_verifications')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (updateErr) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: updateErr.message }) };
  }

  await recordStaffAudit(event, user, {
    action: action === 'approve' ? 'SELLER_VERIFICATION_APPROVED' : 'SELLER_VERIFICATION_REJECTED',
    resource_type: 'seller_verifications',
    resource_id: id,
    details: {
      vendor_id: row.vendor_id,
      verification_type: row.verification_type,
      reject_reason: reject_reason || null,
    },
  });

  return {
    statusCode: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, data: updated }),
  };
};
