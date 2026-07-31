export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';
export type TargetType = 'vendor' | 'category' | 'product' | 'collection' | 'multi_vendor' | 'general';
export type SectionType = 'hero' | 'benefits' | 'vendor_story' | 'products' | 'offer' | 'reviews' | 'media_gallery' | 'cta_footer';
export type ReviewScope = 'product' | 'featured_products' | 'vendor' | 'category' | 'mixed';
export type ProductSource = 'automatic' | 'manual' | 'rules_based';

export interface MediaGalleryItem {
  type: 'image' | 'video';
  url: string;
  caption: string;
  thumbnailUrl: string;
}

export interface CampaignWizardForm {
  internal_name: string;
  public_title: string;
  slug: string;
  campaign_objective: string;
  status: CampaignStatus;
  start_date: string;
  end_date: string;
  target_type: TargetType;
  target_id: string;

  hero_headline: string;
  hero_subtitle: string;
  hero_cta_label: string;
  hero_badge_text: string;
  hero_image_desktop: string;
  hero_image_mobile: string;
  hero_intro_video: string;

  vendor_name: string;
  vendor_logo: string;
  vendor_story: string;
  vendor_location: string;
  vendor_years_operating: number | '';
  vendor_store_link: string;
  vendor_shop_image: string;
  vendor_intro_video: string;

  product_source: ProductSource;
  product_category_id: string;
  product_manual_ids: string;
  product_min_rating: number | '';
  product_in_stock_only: boolean;
  product_discounted_only: boolean;
  product_max_products: number;

  review_scope: ReviewScope;
  review_min_rating: number | '';
  review_max_reviews: number;
  review_verified_only: boolean;

  offer_voucher_id: string;

  media_gallery_items: MediaGalleryItem[];
}

export const ALL_SECTIONS: SectionType[] = ['hero', 'benefits', 'vendor_story', 'products', 'offer', 'reviews', 'media_gallery'];

export const WIZARD_STEPS = [
  { id: 'overview', title: 'Overview', subtitle: 'Name, schedule & status' },
  { id: 'hero', title: 'Hero', subtitle: 'Headline, images & CTA' },
  { id: 'target', title: 'Target', subtitle: 'Audience & vendor story' },
  { id: 'products', title: 'Products', subtitle: 'What to show on the page' },
  { id: 'reviews', title: 'Reviews', subtitle: 'Social proof rules' },
  { id: 'offer', title: 'Offer', subtitle: 'Linked voucher (optional)' },
  { id: 'review', title: 'Review', subtitle: 'Confirm & save' },
] as const;

export const emptyCampaignWizardForm = (): CampaignWizardForm => ({
  internal_name: '',
  public_title: '',
  slug: '',
  campaign_objective: '',
  status: 'draft',
  start_date: '',
  end_date: '',
  target_type: 'general',
  target_id: '',

  hero_headline: '',
  hero_subtitle: '',
  hero_cta_label: 'Shop Now',
  hero_badge_text: '',
  hero_image_desktop: '',
  hero_image_mobile: '',
  hero_intro_video: '',

  vendor_name: '',
  vendor_logo: '',
  vendor_story: '',
  vendor_location: '',
  vendor_years_operating: '',
  vendor_store_link: '',
  vendor_shop_image: '',
  vendor_intro_video: '',

  product_source: 'automatic',
  product_category_id: '',
  product_manual_ids: '',
  product_min_rating: '',
  product_in_stock_only: true,
  product_discounted_only: false,
  product_max_products: 12,

  review_scope: 'mixed',
  review_min_rating: 4,
  review_max_reviews: 5,
  review_verified_only: true,

  offer_voucher_id: '',

  media_gallery_items: [],
});

export const emptySections = (): Record<SectionType, { visible: boolean; order: number }> =>
  Object.fromEntries(ALL_SECTIONS.map((s, i) => [s, { visible: s !== 'media_gallery', order: i }])) as Record<
    SectionType,
    { visible: boolean; order: number }
  >;

const DRAFT_VERSION = 1;
const STORAGE_PREFIX = 'julinemart-campaign-wizard';

export interface CampaignWizardDraft {
  version: number;
  editingId: string | null;
  step: number;
  form: CampaignWizardForm;
  sections: Record<SectionType, { visible: boolean; order: number }>;
  updatedAt: string;
}

export function draftStorageKey(editingId: string | null): string {
  return editingId ? `${STORAGE_PREFIX}:edit:${editingId}` : `${STORAGE_PREFIX}:new`;
}

export function loadCampaignWizardDraft(editingId: string | null): CampaignWizardDraft | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(editingId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CampaignWizardDraft;
    if (parsed.version !== DRAFT_VERSION) return null;
    if (parsed.editingId !== editingId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCampaignWizardDraft(draft: Omit<CampaignWizardDraft, 'version' | 'updatedAt'>): void {
  const payload: CampaignWizardDraft = {
    ...draft,
    version: DRAFT_VERSION,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(draftStorageKey(draft.editingId), JSON.stringify(payload));
  } catch {
    // Quota exceeded — wizard still works, just won't persist.
  }
}

export function clearCampaignWizardDraft(editingId: string | null): void {
  localStorage.removeItem(draftStorageKey(editingId));
}

export function hasNewCampaignDraft(): boolean {
  const draft = loadCampaignWizardDraft(null);
  if (!draft) return false;
  return draftHasContent(draft);
}

export function draftHasContent(draft: CampaignWizardDraft): boolean {
  if (draft.step > 0) return true;
  const f = draft.form;
  return Boolean(
    f.internal_name.trim() ||
      f.public_title.trim() ||
      f.slug.trim() ||
      f.hero_headline.trim() ||
      f.target_id.trim(),
  );
}

export function slugifyCampaign(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
