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
