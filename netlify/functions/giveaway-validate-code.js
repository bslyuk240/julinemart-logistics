// Public endpoint: PWA calls this to unlock the entry form UI before asking
// for any personal details. Deliberately does NOT reveal *why* a code is
// wrong (expired vs. bad code vs. not started) beyond a broad reason, since
// the code itself is a shared marketing gate, not a per-user secret.

import { checkRateLimit } from './services/rate-limit.js';
import {
  buildCorsHeaders,
  isConfigured,
  getActiveGiveawayCampaign,
  codeMatches,
} from './helpers/giveawayHelpers.js';

export async function handler(event) {
  const originHeader = event.headers?.origin || event.headers?.Origin || '';
  const headers = buildCorsHeaders(originHeader);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }
  if (!isConfigured) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Supabase not configured' }) };
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'giveaway-validate-code',
    max: 15,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return { ...response, headers: { ...response.headers, ...headers } };

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON payload' }) };
  }

  const campaignId = (payload.campaign_id || payload.campaignId || '').toString().trim();
  const slug = (payload.slug || '').toString().trim();
  const code = (payload.code || '').toString();

  if ((!campaignId && !slug) || !code) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Missing campaign_id/slug or code' }),
    };
  }

  const { campaign, reason } = await getActiveGiveawayCampaign({ campaignId, slug });
  if (!campaign) {
    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Campaign not found' }) };
  }
  if (reason) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: { valid: false, campaignState: reason } }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, data: { valid: codeMatches(campaign, code) } }),
  };
}
