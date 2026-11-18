/**
 * /api/admin-rewards-config — JulinePoints versioned settings (JLO admin).
 *
 *   GET                       versions, active version, recent audit, wallet totals
 *   POST {action:'create_draft', policy, note?}
 *   POST {action:'update_draft', id, policy, note?}
 *   POST {action:'delete_draft', id}
 *   POST {action:'publish', id, effective_from?, reason?}   (immutable afterwards)
 *   POST {action:'cancel',  id, reason?}                    (only before it takes effect)
 *
 * Read: admin + manager. Write: admin only. Every change writes rewards_admin_audit.
 * A published version applies to NEW events from effective_from; earlier events
 * keep the config_version_id they were stamped with, so nothing is revalued.
 */
import { headers, jsonResponse, requireAdmin, parseJsonBody } from './services/global-sourcing-utils.js';
import { validatePolicy, getActiveConfig } from './services/rewards-config.js';

const READ_ROLES = ['admin', 'manager'];
const WRITE_ROLES = ['admin'];
// Publishing "now" from a form takes a moment; tolerate a little clock skew.
const PAST_TOLERANCE_MS = 5 * 60 * 1000;

async function audit(db, authUser, action, versionId, before, after, reason) {
  const { error } = await db.from('rewards_admin_audit').insert({
    actor_id: authUser?.id || null,
    actor_email: authUser?.email || null,
    action,
    config_version_id: versionId || null,
    before_state: before ?? null,
    after_state: after ?? null,
    reason: reason || null,
  });
  if (error) console.error('admin-rewards-config: audit insert failed', error.message);
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const isRead = event.httpMethod === 'GET';
  if (!isRead && event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, isRead ? READ_ROLES : WRITE_ROLES);
  if (auth.errorResponse) return auth.errorResponse;
  const { authUser, adminClient: db } = auth;

  try {
    if (isRead) {
      const [versions, audits, active, accounts, drift, review] = await Promise.all([
        db.from('rewards_config_versions')
          .select('id, version, status, effective_from, policy, note, created_at, published_at, cancelled_at')
          .order('version', { ascending: false }).limit(50),
        db.from('rewards_admin_audit')
          .select('id, actor_email, action, config_version_id, reason, created_at')
          .order('created_at', { ascending: false }).limit(50),
        getActiveConfig(db),
        db.from('rewards_accounts').select('balance_points', { count: 'exact' }),
        db.from('rewards_reconciliation').select('user_id', { count: 'exact', head: true }),
        db.from('rewards_referral_awards')
          .select('id, order_id, referrer_id, referee_id, qualifying_amount, points, signals, created_at')
          .eq('status', 'in_review').order('created_at', { ascending: true }).limit(100),
      ]);
      for (const r of [versions, audits, accounts, review]) if (r.error) throw r.error;

      // Admins may see who is involved so they can judge a flagged referral.
      const ids = [...new Set((review.data || []).flatMap((a) => [a.referrer_id, a.referee_id]))];
      const orderIds = (review.data || []).map((a) => a.order_id);
      const [{ data: people }, { data: orderRows }] = await Promise.all([
        ids.length ? db.from('customers').select('id, email, first_name, last_name').in('id', ids) : { data: [] },
        orderIds.length ? db.from('orders').select('id, order_number').in('id', orderIds) : { data: [] },
      ]);
      const personById = new Map((people || []).map((p) => [p.id, p]));
      const orderNo = new Map((orderRows || []).map((o) => [o.id, o.order_number]));
      const reviewQueue = (review.data || []).map((a) => ({
        id: a.id,
        order_number: orderNo.get(a.order_id) ?? null,
        referrer: personById.get(a.referrer_id)?.email || a.referrer_id,
        referee: personById.get(a.referee_id)?.email || a.referee_id,
        qualifying_amount: a.qualifying_amount,
        points: a.points,
        signals: a.signals,
        created_at: a.created_at,
      }));
      const outstanding = (accounts.data || []).reduce((s, a) => s + (a.balance_points || 0), 0);
      return jsonResponse(200, {
        success: true,
        active_version_id: active?.id || null,
        versions: versions.data || [],
        audit: audits.data || [],
        review_queue: reviewQueue,
        totals: {
          wallets: accounts.count ?? (accounts.data || []).length,
          outstanding_points: outstanding,
          reconciliation_drift_accounts: drift.error ? null : drift.count ?? 0,
        },
      });
    }

    const body = parseJsonBody(event.body);
    if (!body) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });
    const { action, id } = body;

    if (action === 'create_draft' || action === 'update_draft') {
      const check = validatePolicy(body.policy);
      if (!check.ok) return jsonResponse(422, { success: false, error: 'Invalid policy', details: check.errors });

      if (action === 'create_draft') {
        const { data, error } = await db.from('rewards_config_versions')
          .insert({ status: 'draft', policy: body.policy, note: body.note || null, created_by: authUser.id })
          .select().single();
        if (error) throw error;
        await audit(db, authUser, 'DRAFT_CREATED', data.id, null, data.policy, body.note);
        return jsonResponse(201, { success: true, version: data });
      }

      if (!id) return jsonResponse(400, { success: false, error: 'id is required' });
      const { data: before } = await db.from('rewards_config_versions').select('*').eq('id', id).maybeSingle();
      if (!before) return jsonResponse(404, { success: false, error: 'Version not found' });
      if (before.status !== 'draft') {
        return jsonResponse(409, { success: false, error: 'Only drafts can be edited. Create a new draft from this version.' });
      }
      const { data, error } = await db.from('rewards_config_versions')
        .update({ policy: body.policy, note: body.note ?? before.note })
        .eq('id', id).eq('status', 'draft').select().maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse(409, { success: false, error: 'Draft changed or was published; reload.' });
      await audit(db, authUser, 'DRAFT_UPDATED', id, before.policy, data.policy, body.note);
      return jsonResponse(200, { success: true, version: data });
    }

    if (action === 'delete_draft') {
      if (!id) return jsonResponse(400, { success: false, error: 'id is required' });
      const { data: before } = await db.from('rewards_config_versions').select('*').eq('id', id).maybeSingle();
      if (!before) return jsonResponse(404, { success: false, error: 'Version not found' });
      if (before.status !== 'draft') return jsonResponse(409, { success: false, error: 'Only drafts can be deleted' });
      const { error } = await db.from('rewards_config_versions').delete().eq('id', id).eq('status', 'draft');
      if (error) throw error;
      await audit(db, authUser, 'DRAFT_DELETED', null, before.policy, null, body.reason);
      return jsonResponse(200, { success: true });
    }

    if (action === 'publish') {
      if (!id) return jsonResponse(400, { success: false, error: 'id is required' });
      const { data: before } = await db.from('rewards_config_versions').select('*').eq('id', id).maybeSingle();
      if (!before) return jsonResponse(404, { success: false, error: 'Version not found' });
      if (before.status !== 'draft') return jsonResponse(409, { success: false, error: 'Only a draft can be published' });

      const check = validatePolicy(before.policy);
      if (!check.ok) return jsonResponse(422, { success: false, error: 'Invalid policy', details: check.errors });

      const now = Date.now();
      let effective = body.effective_from ? Date.parse(body.effective_from) : now;
      if (Number.isNaN(effective)) return jsonResponse(400, { success: false, error: 'effective_from is not a valid date-time' });
      if (effective < now - PAST_TOLERANCE_MS) {
        return jsonResponse(400, { success: false, error: 'effective_from cannot be in the past' });
      }
      effective = Math.max(effective, now);

      const { data, error } = await db.from('rewards_config_versions')
        .update({
          status: 'published',
          effective_from: new Date(effective).toISOString(),
          published_by: authUser.id,
          published_at: new Date().toISOString(),
        })
        .eq('id', id).eq('status', 'draft').select().maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse(409, { success: false, error: 'Draft changed or was already published' });
      await audit(db, authUser, 'VERSION_PUBLISHED', id, null,
        { effective_from: data.effective_from, enabled: data.policy?.programme?.enabled }, body.reason);
      return jsonResponse(200, { success: true, version: data });
    }

    if (action === 'cancel') {
      if (!id) return jsonResponse(400, { success: false, error: 'id is required' });
      const { data: before } = await db.from('rewards_config_versions').select('*').eq('id', id).maybeSingle();
      if (!before) return jsonResponse(404, { success: false, error: 'Version not found' });
      if (before.status !== 'published' || new Date(before.effective_from).getTime() <= Date.now()) {
        return jsonResponse(409, {
          success: false,
          error: 'Only a published version that has not taken effect yet can be cancelled. To change live settings, publish a newer version.',
        });
      }
      const { data, error } = await db.from('rewards_config_versions')
        .update({ status: 'cancelled', cancelled_by: authUser.id, cancelled_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'published').gt('effective_from', new Date().toISOString())
        .select().maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse(409, { success: false, error: 'Version took effect or changed; reload.' });
      await audit(db, authUser, 'VERSION_CANCELLED', id, { effective_from: before.effective_from }, null, body.reason);
      return jsonResponse(200, { success: true, version: data });
    }

    if (action === 'review_award') {
      if (!id) return jsonResponse(400, { success: false, error: 'id is required' });
      if (!['approve', 'reject'].includes(body.decision)) {
        return jsonResponse(400, { success: false, error: 'decision must be approve or reject' });
      }
      // Approve releases the award to the normal vesting sweep (delivery + hold);
      // it does not credit points immediately.
      const { data, error } = await db.rpc('rewards_review_referral_award', {
        p_award_id: id,
        p_decision: body.decision,
        p_reviewer: authUser.id,
        p_reason: body.reason || null,
      });
      if (error) {
        if (/not found or not awaiting review/.test(error.message || '')) {
          return jsonResponse(409, { success: false, error: 'That referral is no longer awaiting review.' });
        }
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      await audit(db, authUser, body.decision === 'approve' ? 'REFERRAL_APPROVED' : 'REFERRAL_REJECTED',
        null, { award_id: id }, { status: row?.status }, body.reason);
      return jsonResponse(200, { success: true, award: row });
    }

    return jsonResponse(400, { success: false, error: 'Unknown action' });
  } catch (err) {
    console.error('admin-rewards-config error:', err?.message || err);
    return jsonResponse(500, { success: false, error: 'Rewards config request failed' });
  }
}
