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
//
// Two things make this safe to retry after a partial run (which is exactly
// what happens the moment Netlify kills a long broadcast mid-send):
//   1. getAlreadyMessagedPhones() skips anyone who already has a
//      non-failed message for this campaign+template combo, so re-running
//      the same audience never double-messages someone.
//   2. Progress (sent_count/failed_count) is written to giveaway_broadcasts
//      after EVERY send, not once at the end — so even an ungraceful death
//      leaves an accurate, non-misleading record instead of freezing at
//      "running" forever.

import { supabase, resolveBroadcastRecipients, makeBroadcastVariableBuilder, getAlreadyMessagedPhones, sendWhatsAppTemplateToRecipients } from './helpers/giveawayHelpers.js';

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };

  const providedSecret = event.headers?.['x-internal-secret'] || event.headers?.['X-Internal-Secret'];
  const expectedSecret = process.env.INTERNAL_BROADCAST_SECRET || '';
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

    await supabase
      .from('giveaway_broadcasts')
      .update({ status: 'running', sent_count: skippedCount, failed_count: 0 })
      .eq('id', broadcastId);

    if (pendingRecipients.length === 0) {
      await supabase
        .from('giveaway_broadcasts')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', broadcastId);
      return { statusCode: 200, body: '' };
    }

    const buildVariables = makeBroadcastVariableBuilder(audience, campaign, variables || []);

    const { sentCount, failedCount } = await sendWhatsAppTemplateToRecipients(pendingRecipients, {
      templateName,
      buildVariables,
      broadcastId,
      startingSentCount: skippedCount,
      onProgress: async (currentSent, currentFailed) => {
        await supabase
          .from('giveaway_broadcasts')
          .update({ sent_count: currentSent, failed_count: currentFailed })
          .eq('id', broadcastId);
      },
    });

    const finalStatus = failedCount === allRecipients.length ? 'failed' : 'completed';
    await supabase
      .from('giveaway_broadcasts')
      .update({ status: finalStatus, sent_count: sentCount, failed_count: failedCount, completed_at: new Date().toISOString() })
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
