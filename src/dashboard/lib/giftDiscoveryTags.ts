/** Keep in sync with PWA `src/lib/gifts/discovery.ts` slugs. */
export const GIFT_OCCASION_TAGS = [
  { slug: 'birthday', label: 'Birthday' },
  { slug: 'romantic', label: 'Romantic' },
  { slug: 'mothers-day', label: "Mother's Day" },
  { slug: 'fathers-day', label: "Father's Day" },
  { slug: 'wedding', label: 'Wedding' },
  { slug: 'thank-you', label: 'Thank you' },
  { slug: 'congratulations', label: 'Congratulations' },
  { slug: 'new-baby', label: 'New baby' },
] as const;

export const GIFT_RECIPIENT_TAGS = [
  { slug: 'her', label: 'For her' },
  { slug: 'him', label: 'For him' },
  { slug: 'mum', label: 'Mum' },
  { slug: 'dad', label: 'Dad' },
  { slug: 'friend', label: 'Friend' },
  { slug: 'family', label: 'Family' },
  { slug: 'colleague', label: 'Colleague' },
  { slug: 'kids', label: 'Kids' },
] as const;
