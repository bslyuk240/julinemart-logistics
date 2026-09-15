// Background Function (Netlify treats any "-background.js" file specially:
// the triggering request gets an immediate empty response, and this keeps
// running independently for up to ~15 minutes instead of the ~10-26 second
// ceiling a normal function gets). This is where the actual WhatsApp sending
// happens for admin-giveaway-broadcast.js — that function only resolves
// recipients and creates the giveaway_broadcasts row before handing off here.
//
// Not reachable from the browser: guarded by a shared secret header rather
// than requireAdmin, since this is only ever invoked server-to-server by
// admin-giveaway-broadcast.js, which already did the real admin auth check.
// Reuses ADMIN_SECRET (already used this way by several other functions,
// e.g. fez-register-webhook.js) rather than a dedicated new env var — see
// that call site's own comment on why: AWS Lambda's 4KB per-function
// environment size cap.
//
// Three things make this safe to retry after a partial run (which is
// exactly what happens the moment Netlify kills a long broadcast mid-send)
// and keep its counts honest even while running:
//   1. getAlreadyMessagedPhones() skips anyone who already has a
//      non-failed message for this campaign+template combo, so re-running
//      the same audience never double-messages someone.
//   2. Progress is written via increment_giveaway_broadcast_counts — an
//      atomic +1 DELTA, not an absolute overwrite — after every send. This
//      matters because internal-whatsapp-webhook.js reconciles the same
//      row from a completely separate process the moment Meta's async
//      delivery-status callback flips a message from "sent" to "failed"
//      (confirmed live: under a second after the send, i.e. almost always
//      while this loop is still running). Two absolute-value writers racing
//      on the same row silently clobber each other; two +1/-1 deltas can't.
//   3. The final tally is RECOMPUTED from internal_whatsapp_messages (the
//      real source of truth) rather than trusted from this function's own
//      local counters, so even a stretch of fast-arriving webhook events
//      this loop's deltas didn't fully keep up with gets corrected once at
//      completion.

import { supabase, resolveBroadcastRecipients, makeBroadcastVariableBuilder, getAlreadyMessagedPhones, sendWhatsAppTemplateToRecipients } from './helpers/giveawayHelpers.js';

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
}

async function bumpCounts(broadcastId, sentDelta, failedDelta) {
  await supabase.rpc('increment_giveaway_broadcast_counts', {
    p_broadcast_id: broadcastId,
    p_sent_delta: sentDelta,
    p_failed_delta: failedDelta,
  });
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const providedSecret = event.headers?.['x-internal-secret'] || event.headers?.['X-Internal-Secret'];
  const expectedSecret = process.env.ADMIN_SECRET || '';
  if (!expectedSecret || providedSecret !== expectedSecret) {
    console.error('[admin-giveaway-broadcast-background] rejected: missing/invalid internal secret');
    return { statusCode: 401, body: '' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: '' };
  }

  const { broadcastId, campaignId, audience, templateName, variables } = payload;
  if (!broadcastId || !campaignId || !templateName) return { statusCode: 400, body: '' };

  try {
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, public_title, slug')
      .eq('id', campaignId)
      .single();
    if (campaignError || !campaign) throw campaignError || new Error('Campaign not found');

    const allRecipients = await resolveBroadcastRecipients(campaign, audience);
    const alreadyMessaged = await getAlreadyMessagedPhones(campaignId, templateName);
    const pendingRecipients = allRecipients.filter((r) => !alreadyMessaged.has(normalizePhone(r.phone)));
    const skippedCount = allRecipients.length - pendingRecipients.length;

    // Safe as a plain SET (not a delta): nothing else writes to this row
    // before any message has actually been sent, so there's nothing to race.
    await supabase
      .from('giveaway_broadcasts')
      .update({ status: 'running', sent_count: skippedCount, failed_count: 0 })
      .eq('id', broadcastId);

    if (pendingRecipients.length > 0) {
      const buildVariables = makeBroadcastVariableBuilder(audience, campaign, variables || []);

      await sendWhatsAppTemplateToRecipients(pendingRecipients, {
        templateName,
        buildVariables,
        broadcastId,
        onAttempt: (succeeded) => bumpCounts(broadcastId, succeeded ? 1 : 0, succeeded ? 0 : 1),
      });
    }

    // Definitive recount from the real source of truth — self-heals any
    // in-flight race the delta-based writes above didn't fully catch up to.
    const { count: failedFinal } = await supabase
      .from('internal_whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId)
      .eq('status', 'failed');
    const { count: attemptedFinal } = await supabase
      .from('internal_whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('broadcast_id', broadcastId);
    const trueFailed = failedFinal || 0;
    const trueSent = skippedCount + (attemptedFinal || 0) - trueFailed;

    await supabase
      .from('giveaway_broadcasts')
      .update({
        status: trueFailed === allRecipients.length ? 'failed' : 'completed',
        sent_count: trueSent,
        failed_count: trueFailed,
        completed_at: new Date().toISOString(),
      })
      .eq('id', broadcastId);
  } catch (error) {
    console.error('[admin-giveaway-broadcast-background] failed:', error.message);
    await supabase
      .from('giveaway_broadcasts')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', broadcastId)
      .then(() => {}, () => {});
  }

  return { statusCode: 200, body: '' };
}
