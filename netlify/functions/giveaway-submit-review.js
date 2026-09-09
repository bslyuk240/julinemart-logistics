// Public endpoint: submits a campaign_reviews row from the PWA's
// review-composer page. The entry's own id is the access control (see
// giveaway-get-review-context.js's comment) — no login required. Always
// lands as status='pending'; nothing here shows on the homepage until an
// admin approves it.

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
    name: 'giveaway-submit-review',
    max: 5,
    window: '5 m',
    retryAfterSeconds: 300,
  });
  if (limited) return { ...response, headers: { ...response.headers, ...headers } };

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Invalid JSON payload' }) };
  }

  const entryId = (payload.entry_id || '').toString().trim();
  const rating = Number(payload.rating);
  const body = (payload.body || '').toString().trim();
  const reviewerNameOverride = (payload.reviewer_name || '').toString().trim();

  if (!entryId || !rating || !body) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'entry_id, rating and body are required' }) };
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'rating must be an integer from 1 to 5' }) };
  }
  if (body.length > 2000) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Review is too long (2000 characters max)' }) };
  }

  const { data: entry, error: entryError } = await supabase
    .from('giveaway_entries')
    .select('id, full_name, status, campaign_id')
    .eq('id', entryId)
    .maybeSingle();

  if (entryError) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: entryError.message }) };
  }
  if (!entry || entry.status !== 'valid') {
    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Entry not found' }) };
  }

  const { data: review, error: insertError } = await supabase
    .from('campaign_reviews')
    .insert({
      campaign_id: entry.campaign_id,
      giveaway_entry_id: entryId,
      reviewer_name: reviewerNameOverride || firstName(entry.full_name) || 'JulineMart customer',
      rating,
      body,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertError) {
    // 23505 = unique_violation on giveaway_entry_id — this entry already left a review.
    if (insertError.code === '23505') {
      return { statusCode: 409, headers, body: JSON.stringify({ success: false, error: 'already_reviewed' }) };
    }
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: insertError.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { reviewId: review.id } }) };
}
