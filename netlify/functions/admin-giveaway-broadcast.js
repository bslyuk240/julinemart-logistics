// Admin-triggered: sends a WhatsApp template message to one of two audiences
// (body.audience):
//   'opted_in_list' (default)   — everyone on the cross-campaign opt-in list,
//                                  e.g. "the secret code just dropped".
//   'campaign_non_winners'      — THIS campaign's valid, opted-in entrants
//                                  who did not win, e.g. Phase 4's "didn't
//                                  win? here's a reward anyway" remarketing.
// Reuses the existing internal WhatsApp send primitive (sendWhatsAppTemplate)
// rather than a parallel integration — see helpers/giveawayHelpers.js's
// recordMarketingOptIn for how the opt-in list is built.
//
// Real prerequisite this cannot satisfy from code: `templateName` must refer
// to a template that has actually been approved by Meta as MARKETING category
// (internal_whatsapp_templates.meta_template_status = 'APPROVED'). Template
// review happens in Meta Business Manager — outside this codebase entirely.
// This function will fail loudly per-recipient against the real Cloud API if
// the template isn't approved; it does not pretend to verify that itself.

import { requireAdmin, headers, jsonResponse, parseJsonBody } from './services/global-sourcing-utils.js';
import { sendWhatsAppTemplateToRecipients } from './helpers/giveawayHelpers.js';

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
  const audience = body.audience === 'campaign_non_winners' ? 'campaign_non_winners' : 'opted_in_list';

  if (!campaignId || (!templateName && !previewOnly)) {
    return jsonResponse(400, { success: false, error: 'campaign_id and template_name are required' });
  }

  const { data: campaign, error: campaignError } = await adminClient
    .from('campaigns')
    .select('id, public_title, campaign_kind')
    .eq('id', campaignId)
    .eq('campaign_kind', 'giveaway')
    .maybeSingle();
  if (campaignError) return jsonResponse(500, { success: false, error: campaignError.message });
  if (!campaign) return jsonResponse(404, { success: false, error: 'Giveaway campaign not found' });

  let recipients;
  if (audience === 'campaign_non_winners') {
    // This campaign's valid entrants who did NOT win, filtered against the
    // durable opt-in list (an entry's own marketing_opt_in flag reflects
    // consent at entry time — this join also respects any opt-out since).
    const { data: entryRows, error: entriesError } = await adminClient
      .from('giveaway_entries')
      .select('whatsapp_number, customer_id')
      .eq('campaign_id', campaignId)
      .eq('status', 'valid')
      .eq('marketing_opt_in', true)
      .neq('winner_status', 'selected')
      .neq('winner_status', 'contacted')
      .neq('winner_status', 'verified')
      .neq('winner_status', 'processing')
      .neq('winner_status', 'delivered');
    if (entriesError) return jsonResponse(500, { success: false, error: entriesError.message });

    const phones = [...new Set((entryRows || []).map((e) => e.whatsapp_number))];
    if (phones.length === 0) {
      recipients = [];
    } else {
      const { data: consentRows, error: consentError } = await adminClient
        .from('whatsapp_marketing_consent')
        .select('phone, customer_id')
        .eq('opted_in', true)
        .in('phone', phones);
      if (consentError) return jsonResponse(500, { success: false, error: consentError.message });
      recipients = consentRows || [];
    }
  } else {
    const { data: consentRows, error: recipientsError } = await adminClient
      .from('whatsapp_marketing_consent')
      .select('phone, customer_id')
      .eq('opted_in', true);
    if (recipientsError) return jsonResponse(500, { success: false, error: recipientsError.message });
    recipients = consentRows || [];
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
      status: 'running',
      recipient_count: recipientCount,
      triggered_by: auth.authUser.id,
    })
    .select('id')
    .single();
  if (broadcastError) return jsonResponse(500, { success: false, error: broadcastError.message });

  // Sequential, not Promise.all — deliberately paced (see
  // sendWhatsAppTemplateToRecipients) so one admin click can't burst-fire
  // hundreds of simultaneous Cloud API calls. Shared with the agent-facing
  // marketing.leads.send_whatsapp capability so the two paths can't diverge.
  const { sentCount, failedCount } = await sendWhatsAppTemplateToRecipients(recipients, { templateName, variables });

  const finalStatus = failedCount === recipientCount ? 'failed' : 'completed';
  await adminClient
    .from('giveaway_broadcasts')
    .update({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', broadcast.id);

  return jsonResponse(200, {
    success: true,
    data: { broadcastId: broadcast.id, recipientCount, sentCount, failedCount, status: finalStatus },
  });
}
