// Phase 3 (JLO side only — see project memory for why the Skola-side event
// routing was deliberately left out of this phase's scope).
//
// Pushes campaign lifecycle events into Skola Workforce's EXISTING generic
// inbound webhook receiver (skola-workforce/app/api/webhooks/integrations/
// [integrationId]/route.ts) — nothing new was built on the Skola side. That
// receiver verifies HMAC-SHA256(secret, rawBody) as a hex digest via
// lib/webhook-signing.ts's signPayload/verifySignature, and dedupes on
// (integrationId, externalEventId) — this file mirrors that scheme exactly.
//
// Setup this depends on (a real, human step in Skola's own UI, not something
// this code can do for itself): in Skola Workforce, go to the JulineMart
// project's Integrations page, find the custom_api integration connected to
// this JLO instance, and click "Enable webhooks" — that generates a secret
// shown ONCE. Set:
//   SKOLA_WEBHOOK_URL    = https://<skola-app-host>/api/webhooks/integrations/<that integration's id>
//   SKOLA_WEBHOOK_SECRET = the shown secret (starts with "whsec_")
// Until both are set, sendSkolaEvent() is a no-op that logs a warning — it
// must never fail or block the giveaway action that triggered it.

import { createHmac } from 'crypto';

function isConfigured() {
  return Boolean(process.env.SKOLA_WEBHOOK_URL && process.env.SKOLA_WEBHOOK_SECRET);
}

/**
 * @param {string} eventType e.g. 'campaign.launched', 'giveaway.winner_drawn'
 * @param {string} eventId Stable id for dedup — same id sent twice is a no-op
 *   on Skola's side (its own unique constraint), so callers can use a
 *   resource-derived id (e.g. `campaign.launched:${campaignId}`) rather than
 *   a fresh uuid per call, to naturally collapse repeat saves of the same
 *   already-active campaign into one stored event.
 * @param {Record<string, unknown>} payload
 */
export async function sendSkolaEvent(eventType, eventId, payload) {
  if (!isConfigured()) {
    console.warn(`[skolaWebhook] Not configured (SKOLA_WEBHOOK_URL/SKOLA_WEBHOOK_SECRET) — skipping ${eventType}`);
    return { sent: false, reason: 'not_configured' };
  }

  const rawBody = JSON.stringify({ event_type: eventType, ...payload });
  const signature = createHmac('sha256', process.env.SKOLA_WEBHOOK_SECRET).update(rawBody, 'utf-8').digest('hex');

  try {
    const response = await fetch(process.env.SKOLA_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Skola-Event-Id': eventId,
        'X-Skola-Signature': signature,
      },
      body: rawBody,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[skolaWebhook] ${eventType} rejected: ${response.status} ${text.slice(0, 200)}`);
      return { sent: false, reason: `http_${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    // Never let a Skola outage break a giveaway launch/draw — this is a
    // best-effort notification, not a step the core flow depends on.
    console.error(`[skolaWebhook] ${eventType} failed:`, error.message);
    return { sent: false, reason: 'network_error' };
  }
}

/** "Chioma Okafor" -> "Chioma O." — enough for a public winner announcement without pushing full PII to a third-party product. */
export function toPublicName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
