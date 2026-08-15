/** Keep in sync with PWA `src/lib/gifts/discovery.ts` and JLO `giftDiscoveryTags.ts`. */

export const GIFT_OCCASION_SLUGS = [
  'birthday',
  'romantic',
  'mothers-day',
  'fathers-day',
  'wedding',
  'thank-you',
  'congratulations',
  'new-baby',
];

export const GIFT_RECIPIENT_SLUGS = ['her', 'him', 'mum', 'dad', 'friend', 'family', 'colleague', 'kids'];

const OCCASION_LABEL_TO_SLUG = new Map([
  ['birthday', 'birthday'],
  ['romantic', 'romantic'],
  ["mother's day", 'mothers-day'],
  ['mothers day', 'mothers-day'],
  ["father's day", 'fathers-day'],
  ['fathers day', 'fathers-day'],
  ['wedding', 'wedding'],
  ['thank you', 'thank-you'],
  ['thank-you', 'thank-you'],
  ['congratulations', 'congratulations'],
  ['new baby', 'new-baby'],
  ['new-baby', 'new-baby'],
]);

const RECIPIENT_LABEL_TO_SLUG = new Map([
  ['for her', 'her'],
  ['her', 'her'],
  ['for him', 'him'],
  ['him', 'him'],
  ['for mum', 'mum'],
  ['mum', 'mum'],
  ['for dad', 'dad'],
  ['dad', 'dad'],
  ['for a friend', 'friend'],
  ['friend', 'friend'],
  ['for family', 'family'],
  ['family', 'family'],
  ['for a colleague', 'colleague'],
  ['colleague', 'colleague'],
  ['for kids', 'kids'],
  ['kids', 'kids'],
]);

export function normalizeGiftSku(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

export function normalizeOccasionSlug(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (GIFT_OCCASION_SLUGS.includes(lower)) return lower;
  return OCCASION_LABEL_TO_SLUG.get(lower) || null;
}

export function normalizeRecipientSlug(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (GIFT_RECIPIENT_SLUGS.includes(lower)) return lower;
  return RECIPIENT_LABEL_TO_SLUG.get(lower) || null;
}

export function uniqueSlugs(values) {
  return [...new Set(values.filter(Boolean))];
}
