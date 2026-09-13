// Giveaway / Secret-Code Drop engine — shared logic for the two public
// customer-facing endpoints (giveaway-validate-code, giveaway-submit-entry).
// Mirrors voucherHelpers.js's conventions (CORS whitelist, service-role
// client, rate limiting) rather than inventing a new pattern.
//
// Reward issuance deliberately does NOT mint new voucher codes — it reads the
// campaign's existing early_bird_voucher_id/grand_prize_voucher_id from
// campaign_vouchers, reusing the voucher engine's own validation/redemption
// path at checkout instead of duplicating it.

import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppTemplate } from '../services/internalWhatsapp.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL || '', SERVICE_ROLE_KEY || '');
export const isConfigured = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

const envOrigins = (process.env.VOUCHER_ALLOWED_ORIGIN || '')
  .split(',')
  .map((originEntry) => originEntry.trim())
  .filter(Boolean);

const ORIGIN_WHITELIST = [
  ...envOrigins,
  'https://dev-lab--julinemart-pwa.netlify.app',
  'https://julinemart-pwa.netlify.app',
  'https://julinemart.com',
  'https://www.julinemart.com',
]
  .filter(Boolean)
  .map((origin) => origin.trim());

const DEFAULT_ORIGIN = ORIGIN_WHITELIST.length > 0 ? ORIGIN_WHITELIST[0] : '*';

function resolveOrigin(originHeader = '') {
  const cleaned = originHeader.trim();
  if (!cleaned) return DEFAULT_ORIGIN;
  if (ORIGIN_WHITELIST.includes('*')) return '*';
  if (ORIGIN_WHITELIST.includes(cleaned)) return cleaned;
  return DEFAULT_ORIGIN;
}

export function buildCorsHeaders(originHeader = '') {
  const resolvedOrigin = resolveOrigin(originHeader);
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': resolvedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

const NG_PHONE_RE = /^(\+234|0)[789]\d{9}$/;

/** Same shape as the checkout/signup regex in julinemart-pwa — normalizes to +234XXXXXXXXXX for duplicate matching. */
export function normalizeNigerianPhone(raw) {
  const trimmed = (raw || '').toString().trim().replace(/[\s-]/g, '');
  if (!NG_PHONE_RE.test(trimmed)) return null;
  return trimmed.startsWith('0') ? `+234${trimmed.slice(1)}` : trimmed;
}

export async function getActiveGiveawayCampaign({ campaignId, slug }) {
  let query = supabase.from('campaigns').select('*').eq('campaign_kind', 'giveaway');
  query = campaignId ? query.eq('id', campaignId) : query.eq('slug', slug);

  const { data: campaign, error } = await query.single();
  if (error || !campaign) return { campaign: null, reason: 'not_found' };

  if (campaign.status !== 'active') return { campaign, reason: 'not_active' };

  const now = new Date();
  if (campaign.start_date && new Date(campaign.start_date) > now) {
    return { campaign, reason: 'not_started' };
  }
  if (campaign.end_date && new Date(campaign.end_date) < now) {
    return { campaign, reason: 'ended' };
  }

  return { campaign, reason: null };
}

export function codeMatches(campaign, submittedCode) {
  const expected = (campaign.secret_code || '').trim().toLowerCase();
  const actual = (submittedCode || '').trim().toLowerCase();
  return Boolean(expected) && expected === actual;
}

/** Read-only lookup of the voucher a reward tier should hand out — never mints a new code. */
export async function resolveRewardVoucher(voucherId) {
  if (!voucherId) return null;
  const { data: voucher } = await supabase
    .from('campaign_vouchers')
    .select('code, discount_type, discount_value, description, status, valid_until')
    .eq('id', voucherId)
    .single();

  if (!voucher || voucher.status !== 'active') return null;
  if (voucher.valid_until && new Date(voucher.valid_until) < new Date()) return null;

  return {
    code: voucher.code,
    discountType: voucher.discount_type,
    discountValue: voucher.discount_value,
    description: voucher.description,
  };
}

/**
 * Per-campaign entry-submission ceiling, independent of IP — closes the gap
 * where the shared IP-based rate limiter (services/rate-limit.js) can be
 * bypassed by distributing fake submissions across many IPs (residential
 * proxies, mobile carrier NAT churn). Backed by a plain count query against
 * giveaway_entries itself, not Redis — so unlike the shared limiter, there is
 * no "fails open silently if Redis is unreachable" failure mode to worry
 * about here; if the DB is unreachable the request fails loudly like every
 * other DB-dependent step in this handler already does.
 */
export async function isCampaignEntryRateExceeded(campaignId, { maxPerWindow = 40, windowSeconds = 60 } = {}) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from('giveaway_entries')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .gte('created_at', since);

  if (error) {
    // Same posture as the rest of this file: a query failure here shouldn't
    // itself become the reason a legitimate entrant gets blocked, but it's
    // logged loudly rather than silently swallowed.
    console.error('[isCampaignEntryRateExceeded] count query failed:', error.message);
    return false;
  }

  return (count || 0) >= maxPerWindow;
}

export async function findExistingCustomer({ phone, email }) {
  if (phone) {
    const { data } = await supabase.from('customers').select('id').eq('phone', phone).maybeSingle();
    if (data?.id) return data.id;
  }
  if (email) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .ilike('email', email)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  return null;
}

/**
 * Phase 2 — records/refreshes a durable, cross-campaign opt-in so a future
 * campaign's "code just dropped" broadcast can reach this person, not just
 * this one entry. Upserted by phone: re-entering a later giveaway with the
 * box checked again just refreshes opted_in_at, it doesn't duplicate rows.
 * Never downgrades an existing opt-OUT — someone who opted out and enters a
 * new giveaway without checking the box again stays opted out.
 */
export async function recordMarketingOptIn({ phone, email, customerId, source }) {
  if (!phone) return;
  await supabase
    .from('whatsapp_marketing_consent')
    .upsert(
      {
        phone,
        email: email || null,
        customer_id: customerId || null,
        opted_in: true,
        source: source || null,
        opted_in_at: new Date().toISOString(),
        opted_out_at: null,
        opted_out_reason: null,
      },
      { onConflict: 'phone' }
    );
}

/**
 * Sequential, paced WhatsApp template send to a list of recipients — shared
 * by both the admin-triggered broadcast panel (admin-giveaway-broadcast.js)
 * and the agent-facing marketing.leads.send_whatsapp capability
 * (public-api.js), so the two paths can't drift into different pacing or
 * error-handling behavior over time.
 *
 * `variables` is the same array sent to every recipient (the original,
 * still-default behavior — e.g. "the code just dropped"). Pass
 * `buildVariables(recipient)` instead when each person needs their own
 * values — e.g. a feedback-request template whose {{3}} is that entrant's
 * own review link, which can't be a single shared value.
 *
 * `onProgress(sentCount, failedCount)`, if given, fires after every attempt
 * — the background broadcast function uses this to persist counts to
 * giveaway_broadcasts incrementally, so a run that dies partway through
 * (Netlify killing a long-running invocation, a crash) still leaves an
 * accurate record instead of freezing at whatever the last full-completion
 * write happened to be — see admin-giveaway-broadcast-background.js.
 */
export async function sendWhatsAppTemplateToRecipients(recipients, { templateName, variables = [], buildVariables, broadcastId, onProgress, startingSentCount = 0, startingFailedCount = 0 }) {
  let sentCount = startingSentCount;
  let failedCount = startingFailedCount;

  for (const recipient of recipients) {
    try {
      await sendWhatsAppTemplate({
        to: recipient.phone,
        templateName,
        variables: buildVariables ? buildVariables(recipient) : variables,
        contactType: 'customer',
        broadcastId,
      });
      sentCount += 1;
    } catch (error) {
      console.error(`Broadcast send failed for ${recipient.phone}:`, error.message);
      failedCount += 1;
    }
    if (onProgress) await onProgress(sentCount, failedCount);
    await new Promise((resolve) => setTimeout(resolve, 150)); // gentle pacing, not a hard Meta rate-limit calculation
  }

  return { sentCount, failedCount, recipientCount: recipients.length };
}

/**
 * Resolves who a WhatsApp broadcast should reach for a given audience —
 * shared by admin-giveaway-broadcast.js (preview + kicking off the
 * background send) and admin-giveaway-broadcast-background.js (the actual
 * send), so recipient logic can't drift between the two.
 */
export async function resolveBroadcastRecipients(campaign, audience) {
  if (audience === 'campaign_entrants') {
    const { data: entryRows, error: entriesError } = await supabase
      .from('giveaway_entries')
      .select('id, whatsapp_number, full_name')
      .eq('campaign_id', campaign.id)
      .eq('status', 'valid')
      .eq('marketing_opt_in', true);
    if (entriesError) throw entriesError;

    const phones = [...new Set((entryRows || []).map((e) => e.whatsapp_number))];
    if (phones.length === 0) return [];

    const { data: consentRows, error: consentError } = await supabase
      .from('whatsapp_marketing_consent')
      .select('phone')
      .eq('opted_in', true)
      .in('phone', phones);
    if (consentError) throw consentError;
    const optedInPhones = new Set((consentRows || []).map((c) => c.phone));

    return (entryRows || [])
      .filter((e) => optedInPhones.has(e.whatsapp_number))
      .map((e) => ({ phone: e.whatsapp_number, entryId: e.id, firstName: (e.full_name || '').trim().split(/\s+/)[0] || 'there' }));
  }

  if (audience === 'campaign_non_winners') {
    const { data: entryRows, error: entriesError } = await supabase
      .from('giveaway_entries')
      .select('whatsapp_number, customer_id')
      .eq('campaign_id', campaign.id)
      .eq('status', 'valid')
      .eq('marketing_opt_in', true)
      .neq('winner_status', 'selected')
      .neq('winner_status', 'contacted')
      .neq('winner_status', 'verified')
      .neq('winner_status', 'processing')
      .neq('winner_status', 'delivered');
    if (entriesError) throw entriesError;

    const phones = [...new Set((entryRows || []).map((e) => e.whatsapp_number))];
    if (phones.length === 0) return [];

    const { data: consentRows, error: consentError } = await supabase
      .from('whatsapp_marketing_consent')
      .select('phone, customer_id')
      .eq('opted_in', true)
      .in('phone', phones);
    if (consentError) throw consentError;
    return consentRows || [];
  }

  const { data: consentRows, error: recipientsError } = await supabase
    .from('whatsapp_marketing_consent')
    .select('phone, customer_id')
    .eq('opted_in', true);
  if (recipientsError) throw recipientsError;
  return consentRows || [];
}

/** Matches resolveBroadcastRecipients — builds each recipient's actual send variables. */
export function makeBroadcastVariableBuilder(audience, campaign, sharedVariables) {
  if (audience === 'campaign_entrants') {
    const pwaBase = (process.env.PWA_BASE_URL || 'https://julinemart.com').replace(/\/$/, '');
    return (recipient) => [
      recipient.firstName,
      campaign.public_title,
      `${pwaBase}/campaigns/${campaign.slug}/review/${recipient.entryId}`,
    ];
  }
  return () => sharedVariables;
}

/**
 * Phones that already got this exact template for this exact campaign and
 * didn't fail — scoped by campaign_id (via giveaway_broadcasts) and
 * template_name, not by a time window, so a resumed/retried send after a
 * partial failure never double-messages someone, while a genuinely
 * different campaign reusing the same template name is unaffected.
 * See admin-giveaway-broadcast-background.js — this is what makes retrying
 * a partially-completed broadcast safe.
 */
export async function getAlreadyMessagedPhones(campaignId, templateName) {
  const { data: broadcastRows, error: broadcastError } = await supabase
    .from('giveaway_broadcasts')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('template_name', templateName);
  if (broadcastError) throw broadcastError;
  const broadcastIds = (broadcastRows || []).map((b) => b.id);
  if (broadcastIds.length === 0) return new Set();

  const { data: messageRows, error: messageError } = await supabase
    .from('internal_whatsapp_messages')
    .select('thread_id')
    .in('broadcast_id', broadcastIds)
    .neq('status', 'failed');
  if (messageError) throw messageError;
  const threadIds = [...new Set((messageRows || []).map((m) => m.thread_id))];
  if (threadIds.length === 0) return new Set();

  const { data: threadRows, error: threadError } = await supabase
    .from('internal_whatsapp_threads')
    .select('contact_phone')
    .in('id', threadIds);
  if (threadError) throw threadError;

  // contact_phone is stored without '+' (see normalizePhone in
  // internalWhatsapp.js) — normalize the same way so lookups against
  // recipient.phone (which does have '+') actually match.
  return new Set((threadRows || []).map((t) => t.contact_phone));
}
