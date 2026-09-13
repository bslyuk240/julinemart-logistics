// Admin-triggered: kicks off a WhatsApp template broadcast for one of three
// audiences (body.audience):
//   'opted_in_list' (default)   — everyone on the cross-campaign opt-in list,
//                                  e.g. "the secret code just dropped".
//   'campaign_non_winners'      — THIS campaign's valid, opted-in entrants
//                                  who did not win, e.g. Phase 4's "didn't
//                                  win? here's a reward anyway" remarketing.
//   'campaign_entrants'         — THIS campaign's valid, opted-in entrants
//                                  regardless of win status, for a feedback
//                                  request — each recipient's message carries
//                                  their OWN review link (giveaway_entries.id
//                                  is the link's access token), so this
//                                  audience always builds per-recipient
//                                  variables and ignores any admin-supplied
//                                  `variables` array.
//
// This function ONLY resolves recipients and hands the actual sending off to
// admin-giveaway-broadcast-background.js — see that file's own header for
// why: sending N WhatsApp messages one at a time (paced, so Meta doesn't
// throttle/flag the account) routinely exceeds Netlify's real execution
// ceiling for a normal synchronous function once a campaign has more than a
// couple dozen recipients, which previously showed up to the admin as a bare
// 504 with the DB left stuck at status='running' forever. A background
// function has a ~15 minute ceiling instead of ~10-26 seconds.
//
// Real prerequisite this cannot satisfy from code: `templateName` must refer
// to a template that has actually been approved by Meta as MARKETING (or
// UTILITY) category. Template review happens in Meta Business Manager —
// outside this codebase entirely.

import { requireAdmin, headers, jsonResponse, parseJsonBody } from './services/global-sourcing-utils.js';
import { resolveBroadcastRecipients } from './helpers/giveawayHelpers.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const body = parseJsonBody(event.body);
  if (!body) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

  const campaignId = String(body.campaign_id || '').trim();
  const templateName = String(body.template_name || '').trim();
  const variables = Array.isArray(body.variables) ? body.variables.map((v) => String(v ?? '')) : [];
  const previewOnly = Boolean(body.preview_only);
  const audience = ['campaign_non_winners', 'campaign_entrants'].includes(body.audience) ? body.audience : 'opted_in_list';

  if (!campaignId || (!templateName && !previewOnly)) {
    return jsonResponse(400, { success: false, error: 'campaign_id and template_name are required' });
  }

  const { data: campaign, error: campaignError } = await adminClient
    .from('campaigns')
    .select('id, public_title, slug, campaign_kind')
    .eq('id', campaignId)
    .eq('campaign_kind', 'giveaway')
    .maybeSingle();
  if (campaignError) return jsonResponse(500, { success: false, error: campaignError.message });
  if (!campaign) return jsonResponse(404, { success: false, error: 'Giveaway campaign not found' });

  let recipients;
  try {
    recipients = await resolveBroadcastRecipients(campaign, audience);
  } catch (error) {
    return jsonResponse(500, { success: false, error: error.message });
  }

  const recipientCount = recipients.length;
  if (previewOnly) {
    return jsonResponse(200, { success: true, data: { recipientCount } });
  }
  if (recipientCount === 0) {
    return jsonResponse(400, { success: false, error: 'No opted-in recipients to send to' });
  }

  const { data: broadcast, error: broadcastError } = await adminClient
    .from('giveaway_broadcasts')
    .insert({
      campaign_id: campaign.id,
      template_name: templateName,
      audience,
      status: 'pending',
      recipient_count: recipientCount,
      triggered_by: auth.authUser.id,
    })
    .select('id')
    .single();
  if (broadcastError) return jsonResponse(500, { success: false, error: broadcastError.message });

  // Fire-and-forget: Netlify recognizes the "-background" suffix and runs
  // this as an independent, long-running invocation regardless of how it's
  // called — we don't await its body, only that the request was accepted.
  const siteUrl = (process.env.URL || `https://${event.headers?.host || ''}`).replace(/\/$/, '');
  fetch(`${siteUrl}/.netlify/functions/admin-giveaway-broadcast-background`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': process.env.INTERNAL_BROADCAST_SECRET || '',
    },
    body: JSON.stringify({ broadcastId: broadcast.id, campaignId: campaign.id, audience, templateName, variables }),
  }).catch((error) => console.error('Failed to trigger background broadcast:', error.message));

  return jsonResponse(200, {
    success: true,
    data: { broadcastId: broadcast.id, recipientCount, status: 'pending' },
  });
}
