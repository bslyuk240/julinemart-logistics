// Shared contract with julinemart-pwa (INT-501).
// Keep this file's shapes identical to src/types/campaigns.ts over there —
// this repo writes these rows (Campaign Builder), the PWA reads them.
//
// section_type is fixed here as the canonical list (build-plan Appendix A
// flagged 3 conflicting lists in the source PRD; this is the settled answer):
export type CampaignSectionType =
  | 'hero'
  | 'benefits'
  | 'vendor_story'
  | 'products'
  | 'offer'
  | 'reviews'
  | 'media_gallery'
  | 'cta_footer'
  | 'giveaway_entry';

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';

export type CampaignTargetType = 'vendor' | 'category' | 'product' | 'collection' | 'multi_vendor' | 'general';

// Giveaway / Secret-Code Drop engine (Campaign Engine Phase 1). 'merchandising'
// is every campaign that existed before this — landing page + product offer.
// 'giveaway' campaigns use the giveaway_* fields below instead of (or in
// addition to) product_selection_rules, and render a `giveaway_entry` section
// rather than (or alongside) `products`/`offer`.
export type CampaignKind = 'merchandising' | 'giveaway';

export type GiveawayEntryStatus = 'valid' | 'duplicate' | 'invalid';
export type GiveawayRewardTier = 'early_bird' | 'standard';
export type GiveawayWinnerStatus =
  | 'none'
  | 'selected'
  | 'contacted'
  | 'verified'
  | 'processing'
  | 'delivered'
  | 'forfeited';
export type GiveawayDrawStatus = 'completed' | 'forfeited';

export interface GiveawayEntry {
  id: string;
  campaignId: string;
  fullName: string;
  whatsappNumber: string;
  email?: string | null;
  location?: string | null;
  customerId?: string | null;
  source?: string | null;
  status: GiveawayEntryStatus;
  invalidReason?: string | null;
  entryPosition?: number | null;
  rewardTier?: GiveawayRewardTier | null;
  marketingOptIn: boolean;
  winnerStatus: GiveawayWinnerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GiveawayDraw {
  id: string;
  campaignId: string;
  winningEntryId: string;
  eligibleEntryCount: number;
  drawnBy?: string | null;
  drawnAt: string;
  status: GiveawayDrawStatus;
  forfeitReason?: string | null;
  redrawOf?: string | null;
}

export type CampaignAnalyticsEventType =
  | 'scan'
  | 'page_visit'
  | 'video_view'
  | 'cta_click'
  | 'add_to_cart'
  | 'checkout_start'
  | 'checkout_complete';

export interface CampaignHeroConfig {
  headline: string;
  subtitle: string;
  heroImageDesktop?: string;
  heroImageMobile?: string;
  introductoryVideoUrl?: string;
  ctaLabel: string;
  ctaActionUrl?: string;
  secondaryCtaLabel?: string;
  secondaryCtaVideoUrl?: string;
  badgeText?: string;
  brandThemePalette?: { primaryColor?: string; badgeTextColor?: string };
}

export interface CampaignBenefit {
  title: string;
  description: string;
  icon?: string;
}

// media_gallery section config shape: { items: CampaignMediaItem[] }
export interface CampaignMediaItem {
  type: 'image' | 'video';
  url: string;
  caption?: string;
  /** Video only. Optional — YouTube links auto-derive a thumbnail without this. */
  thumbnailUrl?: string;
}

export interface CampaignVendorOverride {
  vendorId: string | number;
  name?: string;
  logoUrl?: string;
  shopImageUrl?: string;
  story?: string;
  location?: string;
  introVideoUrl?: string;
  yearsOperating?: number;
  storeLinkUrl?: string;
}

export type ProductSelectionSource = 'automatic' | 'manual' | 'rules_based';

export interface CampaignProductSelectionRules {
  source: ProductSelectionSource;
  vendorId?: string | number;
  categoryIds?: (string | number)[];
  manualProductIds?: (string | number)[];
  pinnedProductIds?: (string | number)[];
  minimumRating?: number;
  inStockOnly?: boolean;
  discountedOnly?: boolean;
  maxProducts?: number;
  excludeSkus?: string[];
}

export type ReviewScope = 'product' | 'featured_products' | 'vendor' | 'category' | 'mixed';

export interface CampaignReviewRules {
  scope: ReviewScope;
  minimumRating?: number;
  maxReviews?: number;
  verifiedPurchaseOnly?: boolean;
  imagesOnly?: boolean;
  sort?: 'newest' | 'highest_rated' | 'manual';
  allowVideoTestimonials?: boolean;
  fallbackScope?: ReviewScope;
  manualExclusionIds?: string[];
}

// Mirrors the fields already present on `CampaignVoucher` in
// src/dashboard/pages/Vouchers.tsx — the campaign offer should LINK an
// existing voucher/coupon record from that system, not define a parallel
// discount engine. See build-plan Appendix C.
export interface CampaignOfferConfig {
  voucherId?: string;
  couponCode?: string;
  discountType?: 'free' | 'percentage' | 'fixed_amount';
  discountValue?: number;
  freeDelivery?: boolean;
  minimumSpend?: number;
  newCustomersOnly?: boolean;
  displayText?: string;
  expirationDate?: string;
}

export interface CampaignSection {
  id: string;
  campaignId: string;
  sectionType: CampaignSectionType;
  orderIndex: number;
  isVisible: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface CampaignQrVariant {
  id: string;
  campaignId: string;
  channelName: string;
  trackingSlug: string;
  createdAt: string;
}

export interface CampaignAnalyticsEvent {
  id: number;
  campaignId: string;
  qrId?: string | null;
  eventType: CampaignAnalyticsEventType;
  visitorSessionId: string;
  userId?: string | null;
  orderId?: string | null;
  revenue?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CampaignManualExclusion {
  id: string;
  campaignId: string;
  entityType: 'review' | 'product';
  entityId: string;
  reason?: string;
  createdBy?: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  slug: string;
  internalName: string;
  publicTitle: string;
  campaignObjective?: string;
  status: CampaignStatus;
  startDate?: string;
  endDate?: string;
  targetType: CampaignTargetType;
  targetId?: string;
  templateId?: string;

  sectionLayout: CampaignSection[];
  heroConfig: CampaignHeroConfig;
  vendorOverride?: CampaignVendorOverride;
  productSelectionRules: CampaignProductSelectionRules;
  reviewRules: CampaignReviewRules;
  offerConfig?: CampaignOfferConfig;
  metaSeo?: { title?: string; description?: string; ogImage?: string };

  // Giveaway / Secret-Code Drop fields — only meaningful when campaignKind
  // is 'giveaway'. See GiveawayEntry/GiveawayDraw above. campaignKind is
  // optional (defaults to 'merchandising') so every pre-existing literal
  // Campaign object in tests/fixtures doesn't need updating for this field.
  campaignKind?: CampaignKind;
  secretCode?: string | null;
  entryLimit?: number | null;
  earlyBirdLimit?: number | null;
  earlyBirdVoucherId?: string | null;
  grandPrizeVoucherId?: string | null;
  grandPrizeDescription?: string | null;

  createdAt: string;
  updatedAt: string;
}
