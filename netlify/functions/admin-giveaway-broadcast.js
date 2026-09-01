// Admin-triggered: sends a WhatsApp template message (e.g. "the secret code
// just dropped") to everyone on the cross-campaign opt-in list
// (whatsapp_marketing_consent). Reuses the existing internal WhatsApp send
// primitive (sendWhatsAppTemplate) rather than a parallel integration — see
// helpers/giveawayHelpers.js's recordMarketingOptIn for how the list is built.
//
// Real prerequisite this cannot satisfy from code: `templateName` must refer
// to a template that has actually been approved by Meta as MARKETING category
// (internal_whatsapp_templates.meta_template_status = 'APPROVED'). Template
// review happens in Meta Business Manager — outside this codebase entirely.
// This function will fail loudly per-recipient against the real Cloud API if
// the template isn't approved; it does not pretend to verify that itself.

import { requireAdmin, headers, jsonResponse, parseJsonBody } from './services/global-sourcing-utils.js';
import { sendWhatsAppTemplate } from './services/internalWhatsapp.js';

const SEND_DELAY_MS = 150; // gentle pacing, not a hard Meta rate-limit calculation

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  if (!campaignId || !templateName) {
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

  const { data: recipients, error: recipientsError } = await adminClient
    .from('whatsapp_marketing_consent')
    .select('phone, customer_id')
    .eq('opted_in', true);
  if (recipientsError) return jsonResponse(500, { success: false, error: recipientsError.message });

  const recipientCount = recipients?.length || 0;
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
      status: 'running',
      recipient_count: recipientCount,
      triggered_by: auth.authUser.id,
    })
    .select('id')
    .single();
  if (broadcastError) return jsonResponse(500, { success: false, error: broadcastError.message });

  let sentCount = 0;
  let failedCount = 0;

  // Sequential, not Promise.all — deliberately paced so one admin click can't
  // burst-fire hundreds of simultaneous Cloud API calls.
  for (const recipient of recipients) {
    try {
      await sendWhatsAppTemplate({
        to: recipient.phone,
        templateName,
        variables,
        contactType: 'customer',
      });
      sentCount += 1;
    } catch (error) {
      console.error(`Broadcast send failed for ${recipient.phone}:`, error.message);
      failedCount += 1;
    }
    await sleep(SEND_DELAY_MS);
  }

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
