/**
 * Gift box SKU helpers — format: GBX-{OCCASION}-{RECIPIENT}-{###}
 * Distinct from catalog product SKUs; used as box identifier + voucher matching.
 */
import { normalizeOccasionSlug, normalizeRecipientSlug } from './gift-voucher-tags.js';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function slugToGiftSkuSegment(slug) {
  const raw = String(slug || '').trim().toLowerCase();
  if (!raw || raw === 'any') return 'ANY';
  const normalized = raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'ANY';
}

export function buildGiftBoxSkuPrefix({ occasionSlug, recipientSlug } = {}) {
  const occ = slugToGiftSkuSegment(normalizeOccasionSlug(occasionSlug) || occasionSlug || 'any');
  const rec = slugToGiftSkuSegment(normalizeRecipientSlug(recipientSlug) || recipientSlug || 'any');
  return `GBX-${occ}-${rec}-`;
}

export function buildGiftBoxSkuPrefixFromTags(occasionSlugs = [], recipientSlugs = []) {
  const firstOcc = Array.isArray(occasionSlugs) ? occasionSlugs[0] : null;
  const firstRec = Array.isArray(recipientSlugs) ? recipientSlugs[0] : null;
  return buildGiftBoxSkuPrefix({ occasionSlug: firstOcc, recipientSlug: firstRec });
}

function maxSuffixForPrefix(prefix, skuList) {
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i');
  let max = 0;
  for (const raw of skuList) {
    const m = String(raw || '').trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

async function loadSkusMatchingPrefix(adminClient, prefix) {
  const pattern = `${prefix}%`;
  const [boxes, orders, sessions] = await Promise.all([
    adminClient.from('gift_boxes').select('sku').not('sku', 'is', null).ilike('sku', pattern),
    adminClient.from('gift_orders').select('box_sku').not('box_sku', 'is', null).ilike('box_sku', pattern),
    adminClient
      .from('gift_builder_sessions')
      .select('box_sku')
      .not('box_sku', 'is', null)
      .ilike('box_sku', pattern),
  ]);

  if (boxes.error) throw boxes.error;
  if (orders.error) throw orders.error;
  if (sessions.error) throw sessions.error;

  const out = [];
  for (const row of boxes.data || []) if (row.sku) out.push(row.sku);
  for (const row of orders.data || []) if (row.box_sku) out.push(row.box_sku);
  for (const row of sessions.data || []) if (row.box_sku) out.push(row.box_sku);
  return out;
}

export async function computeNextGiftBoxSku(adminClient, prefix, extraSkus = []) {
  const normalizedPrefix = String(prefix || '').trim().toUpperCase();
  if (!normalizedPrefix) throw new Error('SKU prefix required');
  if (!normalizedPrefix.endsWith('-')) {
    throw new Error('Gift box SKU prefix must end with a hyphen');
  }

  const fromDb = await loadSkusMatchingPrefix(adminClient, normalizedPrefix);
  const combined = [...fromDb, ...extraSkus.map((s) => String(s || '').trim()).filter(Boolean)];
  const max = maxSuffixForPrefix(normalizedPrefix, combined);
  const next = max + 1;
  const seq = String(Math.max(0, Math.floor(next))).padStart(3, '0');
  return `${normalizedPrefix}${seq}`;
}

export async function ensureBuilderSessionBoxSku(adminClient, sessionRow) {
  if (sessionRow.box_sku?.trim()) {
    return String(sessionRow.box_sku).trim().toUpperCase();
  }

  const prefix = buildGiftBoxSkuPrefix({
    occasionSlug: sessionRow.occasion,
    recipientSlug: sessionRow.recipient_type,
  });

  const nextSku = await computeNextGiftBoxSku(adminClient, prefix, []);
  const { error } = await adminClient
    .from('gift_builder_sessions')
    .update({ box_sku: nextSku, updated_at: new Date().toISOString() })
    .eq('id', sessionRow.id);

  if (error) throw error;
  return nextSku;
}
