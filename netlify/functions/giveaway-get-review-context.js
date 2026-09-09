// Public endpoint: the PWA's review-composer page (/campaigns/[slug]/review/
// [entryId]) calls this first to decide what to render. The entry's own id
// (a uuid, already unguessable) IS the access control here — no login, no
// separate token. Deliberately returns only what the composer page needs to
// render (first name, campaign title, whether a review already exists) —
// never the entry's phone/email/full name/location.

import { checkRateLimit } from './services/rate-limit.js';
import { supabase, buildCorsHeaders, isConfigured } from './helpers/giveawayHelpers.js';

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || '';
}

export async function handler(event) {
  const originHeader = event.headers?.origin || event.headers?.Origin || '';
  const headers = buildCorsHeaders(originHeader);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }
  if (!isConfigured) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'Supabase not configured' }) };
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'giveaway-get-review-context',
    max: 20,
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

  const entryId = (payload.entry_id || '').toString().trim();
  if (!entryId) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'entry_id is required' }) };
  }

  const { data: entry, error: entryError } = await supabase
    .from('giveaway_entries')
    .select('id, full_name, status, campaign_id, campaigns(public_title)')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: entryError.message }) };
  }
  if (!entry || entry.status !== 'valid') {
    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Entry not found' }) };
  }

  const { data: existingReview } = await supabase
    .from('campaign_reviews')
    .select('id')
    .eq('giveaway_entry_id', entryId)
    .maybeSingle();

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      data: {
        valid: true,
        alreadyReviewed: Boolean(existingReview),
        firstName: firstName(entry.full_name),
        campaignTitle: entry.campaigns?.public_title || '',
      },
    }),
  };
}
