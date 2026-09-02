// Public endpoint: PWA calls this once the visitor has typed the (already
// unlocked) secret code and filled the short entry form. Re-validates the
// code and campaign window server-side rather than trusting the earlier
// giveaway-validate-code call — the frontend gate is a UX nicety, not the
// actual security boundary.
//
// Duplicate/invalid submissions are still INSERTED (with status set
// accordingly), not rejected outright, so admin reporting can show
// "N submissions, M valid, D duplicate, I invalid" the way the plan calls for.

import { checkRateLimit } from './services/rate-limit.js';
import {
  supabase,
  buildCorsHeaders,
  isConfigured,
  getActiveGiveawayCampaign,
  codeMatches,
  normalizeNigerianPhone,
  resolveRewardVoucher,
  findExistingCustomer,
  recordMarketingOptIn,
  isCampaignEntryRateExceeded,
} from './helpers/giveawayHelpers.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(statusCode, headers, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

export async function handler(event) {
  const originHeader = event.headers?.origin || event.headers?.Origin || '';
  const headers = buildCorsHeaders(originHeader);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, headers, { success: false, error: 'Method not allowed' });
  }
  if (!isConfigured) {
    return jsonResponse(500, headers, { success: false, error: 'Supabase not configured' });
  }

  const { limited, response } = await checkRateLimit(event, {
    name: 'giveaway-submit-entry',
    max: 5,
    window: '5 m',
    retryAfterSeconds: 300,
  });
  if (limited) return { ...response, headers: { ...response.headers, ...headers } };

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, headers, { success: false, error: 'Invalid JSON payload' });
  }

  const campaignId = (payload.campaign_id || payload.campaignId || '').toString().trim();
  const slug = (payload.slug || '').toString().trim();
  const code = (payload.code || '').toString();
  const fullName = (payload.full_name || payload.fullName || '').toString().trim();
  const rawPhone = (payload.whatsapp_number || payload.whatsappNumber || '').toString().trim();
  // Now required — winner/reward notifications need a real address to send
  // to, and WhatsApp-only entries had no way to receive them.
  const email = (payload.email || '').toString().trim();
  const location = (payload.location || '').toString().trim() || null;
  const marketingOptIn = Boolean(payload.marketing_opt_in ?? payload.marketingOptIn);
  const source = (payload.source || '').toString().trim() || null;

  if ((!campaignId && !slug) || !code || !fullName || !rawPhone || !email) {
    return jsonResponse(400, headers, {
      success: false,
      error: 'Missing required field(s): campaign_id/slug, code, full_name, whatsapp_number, email',
    });
  }
  if (!EMAIL_RE.test(email)) {
    return jsonResponse(400, headers, { success: false, error: 'Enter a valid email address' });
  }

  const normalizedPhone = normalizeNigerianPhone(rawPhone);
  if (!normalizedPhone) {
    return jsonResponse(400, headers, { success: false, error: 'Enter a valid Nigerian WhatsApp number' });
  }

  const { campaign, reason } = await getActiveGiveawayCampaign({ campaignId, slug });
  if (!campaign) {
    return jsonResponse(404, headers, { success: false, error: 'Campaign not found' });
  }
  if (reason) {
    return jsonResponse(409, headers, { success: false, error: 'campaign_not_open', campaignState: reason });
  }

  // Per-campaign ceiling, independent of IP — see isCampaignEntryRateExceeded's
  // own comment for why this exists alongside (not instead of) the IP-based
  // checkRateLimit above.
  if (await isCampaignEntryRateExceeded(campaign.id)) {
    return jsonResponse(429, headers, { success: false, error: 'Too many entries right now — try again shortly.' });
  }

  if (!codeMatches(campaign, code)) {
    return jsonResponse(400, headers, { success: false, error: 'invalid_code' });
  }

  try {
    // Duplicate check — an entrant who already has a VALID entry for this
    // campaign gets a new row recorded as 'duplicate' (kept for reporting,
    // not silently dropped) rather than a hard rejection.
    const { data: existingValid } = await supabase
      .from('giveaway_entries')
      .select('id, entry_position, reward_tier')
      .eq('campaign_id', campaign.id)
      .eq('whatsapp_number', normalizedPhone)
      .eq('status', 'valid')
      .maybeSingle();

    if (existingValid) {
      await supabase.from('giveaway_entries').insert({
        campaign_id: campaign.id,
        full_name: fullName,
        whatsapp_number: normalizedPhone,
        email,
        location,
        source,
        marketing_opt_in: marketingOptIn,
        status: 'duplicate',
        invalid_reason: 'already_entered',
      });

      return jsonResponse(200, headers, {
        success: true,
        data: {
          status: 'duplicate',
          entryPosition: existingValid.entry_position,
          rewardTier: existingValid.reward_tier,
          message: 'You already have an entry in this giveaway.',
        },
      });
    }

    // Known, accepted limitation: entry_position is a count-then-insert, so a
    // burst of concurrent submissions can hand out the same position to more
    // than one entrant (unlike the phone-uniqueness race above, which is
    // closed at the DB level). This only blurs the early-bird cutoff by a
    // handful of entries in a burst — not worth a serialized-transaction fix
    // for a marketing giveaway's reporting field.
    const { count: validCount } = await supabase
      .from('giveaway_entries')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .eq('status', 'valid');

    const nextPosition = (validCount || 0) + 1;

    if (campaign.entry_limit != null && nextPosition > campaign.entry_limit) {
      await supabase.from('giveaway_entries').insert({
        campaign_id: campaign.id,
        full_name: fullName,
        whatsapp_number: normalizedPhone,
        email,
        location,
        source,
        marketing_opt_in: marketingOptIn,
        status: 'invalid',
        invalid_reason: 'entry_limit_reached',
      });

      return jsonResponse(409, headers, { success: false, error: 'entry_limit_reached' });
    }

    const rewardTier =
      campaign.early_bird_limit != null && nextPosition <= campaign.early_bird_limit
        ? 'early_bird'
        : 'standard';

    const customerId = await findExistingCustomer({ phone: normalizedPhone, email });

    const { data: entry, error: insertError } = await supabase
      .from('giveaway_entries')
      .insert({
        campaign_id: campaign.id,
        full_name: fullName,
        whatsapp_number: normalizedPhone,
        email,
        location,
        source,
        marketing_opt_in: marketingOptIn,
        status: 'valid',
        entry_position: nextPosition,
        reward_tier: rewardTier,
        customer_id: customerId,
      })
      .select('id, entry_position, reward_tier')
      .single();

    if (insertError) {
      // 23505 = unique_violation on idx_giveaway_entries_unique_valid_phone —
      // another request for the same phone number won the race between our
      // duplicate check above and this insert. Record this attempt as a
      // duplicate instead of surfacing a raw 500.
      if (insertError.code === '23505') {
        const { data: winner } = await supabase
          .from('giveaway_entries')
          .select('entry_position, reward_tier')
          .eq('campaign_id', campaign.id)
          .eq('whatsapp_number', normalizedPhone)
          .eq('status', 'valid')
          .maybeSingle();

        await supabase.from('giveaway_entries').insert({
          campaign_id: campaign.id,
          full_name: fullName,
          whatsapp_number: normalizedPhone,
          email,
          location,
          source,
          marketing_opt_in: marketingOptIn,
          status: 'duplicate',
          invalid_reason: 'already_entered',
        });

        return jsonResponse(200, headers, {
          success: true,
          data: {
            status: 'duplicate',
            entryPosition: winner?.entry_position ?? null,
            rewardTier: winner?.reward_tier ?? null,
            message: 'You already have an entry in this giveaway.',
          },
        });
      }

      console.error('Failed to record giveaway entry:', insertError);
      return jsonResponse(500, headers, { success: false, error: 'Failed to record entry' });
    }

    const reward =
      rewardTier === 'early_bird' ? await resolveRewardVoucher(campaign.early_bird_voucher_id) : null;

    if (marketingOptIn) {
      // Fire-and-forget-ish (still awaited, but failure here must never fail
      // an otherwise-successful entry) — feeds the cross-campaign broadcast
      // list, not just this campaign's own records.
      await recordMarketingOptIn({
        phone: normalizedPhone,
        customerId,
        source: `giveaway_entry:${campaign.id}`,
      }).catch((error) => console.error('Failed to record marketing opt-in:', error));
    }

    return jsonResponse(200, headers, {
      success: true,
      data: {
        entryId: entry.id,
        status: 'valid',
        entryPosition: entry.entry_position,
        rewardTier: entry.reward_tier,
        reward,
      },
    });
  } catch (error) {
    console.error('Giveaway entry handler error:', error);
    return jsonResponse(500, headers, { success: false, error: 'Failed to submit entry' });
  }
}
