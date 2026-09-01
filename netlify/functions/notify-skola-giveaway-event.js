// Admin-triggered (called from Giveaways.tsx right after a save-to-active,
// draw, or redraw succeeds — same fire-and-forget pattern already used there
// for logActivity()). Fetches whatever the event needs server-side rather
// than trusting client-supplied payload fields, since a winner's PII
// shouldn't be something the browser dictates what gets sent to a
// third-party product.
//
// Delivery itself goes through the EXISTING generic outbound webhook
// dispatcher (services/webhookDelivery.js's sendWebhookEvent — already used
// for order.updated/shipment.delayed), not a bespoke sender: it already signs
// with the exact scheme Skola's receiver expects, already has a configured,
// active "Skola Workforce" row in webhook_endpoints with its secret encrypted
// at rest, and already retries on failure (process-webhook-retries-scheduled.js)
// — none of which a one-off implementation would get for free. An earlier
// version of this file rolled its own HMAC signing + fetch + env-var secret;
// that was redundant with infrastructure that already existed and already
// covers this project, and has been removed.

import { requireAdmin, headers, jsonResponse, parseJsonBody } from './services/global-sourcing-utils.js';
import { sendWebhookEvent } from './services/webhookDelivery.js';

const KNOWN_EVENT_TYPES = ['campaign.launched', 'giveaway.winner_drawn', 'giveaway.winner_redrawn'];

/** "Chioma Okafor" -> "Chioma O." — enough for a public winner announcement without pushing full PII to a third-party product. */
function toPublicName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const auth = await requireAdmin(event, ['admin', 'manager']);
  if (auth.errorResponse) return auth.errorResponse;
  const { adminClient } = auth;

  const body = parseJsonBody(event.body);
  if (!body) return jsonResponse(400, { success: false, error: 'Invalid JSON body' });

  const eventType = String(body.event_type || '').trim();
  const campaignId = String(body.campaign_id || '').trim();
  if (!KNOWN_EVENT_TYPES.includes(eventType) || !campaignId) {
    return jsonResponse(400, { success: false, error: `event_type must be one of ${KNOWN_EVENT_TYPES.join(', ')}; campaign_id is required` });
  }

  const { data: campaign, error: campaignError } = await adminClient
    .from('campaigns')
    .select('id, slug, public_title, campaign_kind, start_date, end_date, grand_prize_description')
    .eq('id', campaignId)
    .eq('campaign_kind', 'giveaway')
    .maybeSingle();
  if (campaignError) return jsonResponse(500, { success: false, error: campaignError.message });
  if (!campaign) return jsonResponse(404, { success: false, error: 'Giveaway campaign not found' });

  const campaignPayload = {
    id: campaign.id,
    slug: campaign.slug,
    public_title: campaign.public_title,
    start_date: campaign.start_date,
    end_date: campaign.end_date,
    grand_prize_description: campaign.grand_prize_description,
    url: `https://julinemart.com/campaigns/${campaign.slug}`,
  };

  if (eventType === 'campaign.launched') {
    try {
      await sendWebhookEvent('campaign.launched', { campaign: campaignPayload });
    } catch (err) {
      return jsonResponse(500, { success: false, error: err.message });
    }
    return jsonResponse(200, { success: true, data: { dispatched: true } });
  }

  const { data: draw, error: drawError } = await adminClient
    .from('giveaway_draws')
    .select('id, winning_entry_id, eligible_entry_count, drawn_at')
    .eq('campaign_id', campaign.id)
    .eq('status', 'completed')
    .order('drawn_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (drawError) return jsonResponse(500, { success: false, error: drawError.message });
  if (!draw) return jsonResponse(404, { success: false, error: 'No completed draw found for this campaign' });

  const { data: winningEntry, error: entryError } = await adminClient
    .from('giveaway_entries')
    .select('full_name, location, entry_position')
    .eq('id', draw.winning_entry_id)
    .maybeSingle();
  if (entryError) return jsonResponse(500, { success: false, error: entryError.message });

  try {
    await sendWebhookEvent(eventType, {
      campaign: campaignPayload,
      winner: {
        public_name: toPublicName(winningEntry?.full_name),
        location: winningEntry?.location || null,
        entry_position: winningEntry?.entry_position ?? null,
      },
      eligible_entry_count: draw.eligible_entry_count,
      drawn_at: draw.drawn_at,
    });
  } catch (err) {
    return jsonResponse(500, { success: false, error: err.message });
  }

  return jsonResponse(200, { success: true, data: { dispatched: true } });
}
