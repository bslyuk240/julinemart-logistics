/**
 * POST /api/account-deletion   { action: 'status' | 'request' | 'confirm', ... }
 *
 * Customer self-service account deletion.
 *
 *   status   -> { eligible, reasons[] }   why the account can or can't be deleted now
 *   request  -> emails a one-time confirmation link (valid 1 hour); body.origin
 *               may pick which storefront the link points at (allow-listed)
 *   confirm  -> { token } deletes the account
 *
 * Two proofs are needed to delete: a valid signed-in session (Bearer JWT) AND the
 * one-time token that was emailed to the account's address. The user id always
 * comes from the verified JWT, never from the request body. The heavy lifting
 * (points closure, anonymisation, removal) is the delete_customer_account()
 * database function; this file orchestrates it, removes the login, and emails.
 */
import crypto from 'node:crypto';
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { authenticateCustomer } from './services/customerAuth.js';
import { checkRateLimit } from './services/rate-limit.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';

const TOKEN_TTL_MS = 60 * 60 * 1000;
const DEFAULT_ORIGIN = (process.env.STOREFRONT_URL || process.env.PWA_URL || 'https://julinemart.com').replace(/\/$/, '');
const ALLOWED_ORIGINS = new Set(
  [
    DEFAULT_ORIGIN,
    'https://julinemart.com',
    'https://www.julinemart.com',
    'https://test-julinemart.netlify.app',
    ...String(process.env.ACCOUNT_DELETION_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')),
  ].filter(Boolean),
);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function pickOrigin(requested) {
  const o = String(requested || '').trim().replace(/\/$/, '');
  return o && ALLOWED_ORIGINS.has(o) ? o : DEFAULT_ORIGIN;
}

async function loadIdentity(userId) {
  const { data: u, error } = await adminClient.auth.admin.getUserById(userId);
  if (error || !u?.user?.email) throw new Error('Could not load account');
  const { data: c } = await adminClient.from('customers').select('first_name').eq('id', userId).maybeSingle();
  return { email: u.user.email, name: (c?.first_name || '').trim() || 'there' };
}

async function blockers(userId) {
  const { data, error } = await adminClient.rpc('account_deletion_blockers', { p_user: userId });
  if (error) throw error;
  return data;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { success: false, error: 'Database not configured' });

  const { userId, error: authError } = await authenticateCustomer(event);
  if (authError) return jsonResponse(401, { success: false, error: 'Please sign in first.' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { success: false, error: 'Invalid JSON' }); }
  const action = String(body.action || '');

  try {
    // ── status ──────────────────────────────────────────────────────────────
    if (action === 'status') {
      const b = await blockers(userId);
      return jsonResponse(200, { success: true, eligible: !!b.eligible, reasons: b.reasons || [] });
    }

    // ── request: email a one-time link ──────────────────────────────────────
    if (action === 'request') {
      const { limited, response } = await checkRateLimit(event, {
        name: 'account-deletion-request', max: 3, window: '1 h', retryAfterSeconds: 3600,
      });
      if (limited) return response;

      const b = await blockers(userId);
      if (!b.eligible) return jsonResponse(409, { success: false, eligible: false, reasons: b.reasons || [], error: b.reasons?.[0]?.message || 'This account cannot be deleted right now.' });

      const { email, name } = await loadIdentity(userId);
      const token = crypto.randomBytes(32).toString('hex');

      // One live request per account: older pending links stop working.
      await adminClient.from('account_deletion_requests')
        .update({ status: 'cancelled', email: null })
        .eq('user_id', userId).eq('status', 'pending');
      const { error: insErr } = await adminClient.from('account_deletion_requests').insert({
        user_id: userId,
        email,
        token_hash: sha256(token),
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      });
      if (insErr) throw insErr;

      const confirmUrl = `${pickOrigin(body.origin)}/account/delete/confirm?token=${token}`;
      const sent = await sendTransactionalEmail({
        templateName: 'Account Deletion Confirmation',
        to: email,
        data: { customerName: name, confirmUrl },
        source: 'account-deletion',
      });
      if (!sent?.sent) {
        await adminClient.from('account_deletion_requests').update({ status: 'failed', email: null }).eq('token_hash', sha256(token));
        return jsonResponse(502, { success: false, error: 'We could not send the confirmation email. Please try again shortly.' });
      }
      return jsonResponse(200, { success: true, sent_to_hint: email.replace(/^(.).*(@.*)$/, '$1***$2') });
    }

    // ── confirm: delete ─────────────────────────────────────────────────────
    if (action === 'confirm') {
      const token = String(body.token || '');
      if (!/^[a-f0-9]{64}$/.test(token)) return jsonResponse(400, { success: false, error: 'This link is not valid.' });

      const { data: req, error: reqErr } = await adminClient.from('account_deletion_requests')
        .select('id, user_id, email, status, expires_at, summary').eq('token_hash', sha256(token)).maybeSingle();
      if (reqErr) throw reqErr;
      if (!req || req.user_id !== userId) {
        // Same message for "no such link" and "someone else's link".
        return jsonResponse(404, { success: false, error: 'This link is not valid, or it belongs to a different account. Sign in with the account you want to delete.' });
      }
      if (req.status !== 'pending') return jsonResponse(410, { success: false, error: 'This link has already been used or replaced.' });
      if (new Date(req.expires_at).getTime() < Date.now()) {
        await adminClient.from('account_deletion_requests').update({ status: 'expired', email: null }).eq('id', req.id);
        return jsonResponse(410, { success: false, error: 'This link has expired. Please start again from Settings.' });
      }

      const name = (await adminClient.from('customers').select('first_name').eq('id', userId).maybeSingle()).data?.first_name?.trim() || 'there';
      const email = req.email;
      let summary = req.summary || {};

      // Step 1: data. Skipped on a retry that already got this far.
      if (!summary.data_deleted) {
        const { data, error } = await adminClient.rpc('delete_customer_account', { p_user: userId });
        if (error) {
          if (/account_deletion_blocked/.test(error.message || '')) {
            const b = await blockers(userId);
            return jsonResponse(409, { success: false, eligible: false, reasons: b.reasons || [], error: b.reasons?.[0]?.message || 'This account cannot be deleted right now.' });
          }
          throw error;
        }
        summary = { ...(data || {}), data_deleted: true };
        await adminClient.from('account_deletion_requests').update({ summary }).eq('id', req.id);
      }

      // Step 2: the login itself.
      const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
      if (delErr && !/not found/i.test(delErr.message || '')) {
        console.error('account-deletion: auth delete failed', delErr.message);
        await adminClient.from('account_deletion_requests').update({ status: 'failed' }).eq('id', req.id);
        return jsonResponse(500, { success: false, error: 'We removed your data but could not finish closing your login. Please email info@julinemart.com and we will complete it.' });
      }

      // Step 3: final notice, then forget the address everywhere we keep it.
      if (email) {
        await sendTransactionalEmail({ templateName: 'Account Deleted', to: email, data: { customerName: name }, source: 'account-deletion' });
        await adminClient.from('email_logs')
          .update({ recipient: `deleted+${userId.slice(0, 8)}@deleted.invalid` })
          .eq('recipient', email);
      }
      await adminClient.from('account_deletion_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString(), email: null, summary })
        .eq('id', req.id);

      return jsonResponse(200, { success: true, deleted: true });
    }

    return jsonResponse(400, { success: false, error: 'Unknown action' });
  } catch (err) {
    console.error('account-deletion error:', err?.message || err);
    return jsonResponse(500, { success: false, error: 'Something went wrong. Please try again.' });
  }
}
