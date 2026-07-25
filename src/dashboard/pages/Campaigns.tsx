import { useEffect, useMemo, useState } from 'react';
import {
  Megaphone, Plus, Edit, Trash2, Copy, Loader2, Eye, EyeOff,
  CheckCircle, PauseCircle, Clock, Archive as ArchiveIcon, FileEdit,
  QrCode, Download, X, BarChart3, ScanLine, Sparkles, ChevronUp, ChevronDown, Ticket,
} from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  slugifyChannel, buildCampaignTrackingUrl, generateQrPngDataUrl, generateQrSvgMarkup,
  downloadDataUrl, downloadSvgMarkup,
} from '../../lib/qr';

const STOREFRONT_BASE_URL = 'https://julinemart.com';

// INT-502 — Campaign Builder. A single well-organized form rather than a
// true paginated wizard (no react-hook-form / wizard library in this repo,
// and a fragile half-built wizard is worse than one solid form — see
// docs/campaigns-build-plan.md Phase 5 deviation note). Section ordering
// uses number inputs, not drag-and-drop (no @dnd-kit here either).

type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';
type TargetType = 'vendor' | 'category' | 'product' | 'collection' | 'multi_vendor' | 'general';
type SectionType = 'hero' | 'benefits' | 'vendor_story' | 'products' | 'offer' | 'reviews' | 'media_gallery' | 'cta_footer';
type ReviewScope = 'product' | 'featured_products' | 'vendor' | 'category' | 'mixed';
type ProductSource = 'automatic' | 'manual' | 'rules_based';

interface CampaignRow {
  id: string;
  slug: string;
  internal_name: string;
  public_title: string;
  campaign_objective: string | null;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  target_type: TargetType;
  target_id: string | null;
  hero_config: Record<string, any> | null;
  vendor_override: Record<string, any> | null;
  product_selection_rules: Record<string, any> | null;
  review_rules: Record<string, any> | null;
  offer_config: Record<string, any> | null;
  created_at: string;
}

interface SectionRow {
  section_type: SectionType;
  order_index: number;
  is_visible: boolean;
  config?: Record<string, any> | null;
}

interface MediaGalleryItem {
  type: 'image' | 'video';
  url: string;
  caption: string;
}

interface QrVariantRow {
  id: string;
  campaign_id: string;
  channel_name: string;
  tracking_slug: string;
  created_at: string;
}

const ALL_SECTIONS: SectionType[] = ['hero', 'benefits', 'vendor_story', 'products', 'offer', 'reviews', 'media_gallery'];

interface FormState {
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

const emptyForm: FormState = {
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
};

const emptySections = (): Record<SectionType, { visible: boolean; order: number }> =>
  Object.fromEntries(ALL_SECTIONS.map((s, i) => [s, { visible: true, order: i }])) as any;

const statusColors: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-orange-100 text-orange-800',
  expired: 'bg-red-100 text-red-800',
  archived: 'bg-gray-200 text-gray-600',
};

const statusIcons: Record<CampaignStatus, any> = {
  draft: FileEdit,
  scheduled: Clock,
  active: CheckCircle,
  paused: PauseCircle,
  expired: Clock,
  archived: ArchiveIcon,
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function CampaignsPage() {
  const { user, session } = useAuth();
  const notification = useNotification();
  const isAdmin = useMemo(() => user?.role === 'admin', [user?.role]);

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);
  const [sections, setSections] = useState(emptySections());
  const [showId, setShowId] = useState<Record<string, boolean>>({});

  const [vouchers, setVouchers] = useState<{ id: string; code: string; campaign_name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [vendorsList, setVendorsList] = useState<{ id: string; store_name: string; logo_url: string | null; woocommerce_vendor_id: string | null }[]>([]);

  // Inline "create voucher for this campaign" shortcut (INT-505) — only usable
  // once the campaign has a real id (editingId), since the voucher links back
  // via campaign_id. Scope (vendor/product/category) is inherited from the
  // campaign's own targeting rather than re-entered.
  const [voucherPanelOpen, setVoucherPanelOpen] = useState(false);
  const [voucherCreating, setVoucherCreating] = useState(false);
  const [voucherForm, setVoucherForm] = useState({
    code: '',
    discount_type: 'percentage' as 'free' | 'percentage' | 'fixed_amount',
    discount_value: '' as number | '',
    max_uses: 1000,
    max_uses_per_customer: 1,
    valid_until: '',
  });

  // QR generation (INT-504)
  const [qrCampaign, setQrCampaign] = useState<CampaignRow | null>(null);
  const [qrVariants, setQrVariants] = useState<QrVariantRow[]>([]);
  const [qrScanCounts, setQrScanCounts] = useState<Record<string, number>>({});
  const [qrImages, setQrImages] = useState<Record<string, { png: string; svg: string }>>({});
  const [newChannelName, setNewChannelName] = useState('');
  const [qrBusy, setQrBusy] = useState(false);

  // Analytics summary (Screen 3, condensed)
  const [analyticsCampaign, setAnalyticsCampaign] = useState<CampaignRow | null>(null);
  const [analyticsData, setAnalyticsData] = useState<{
    funnel: Record<string, number>;
    revenue: number;
    channelBreakdown: { channel_name: string; scans: number }[];
  } | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    void loadCampaigns();
    void loadLookups();
  }, []);

  async function loadCampaigns() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCampaigns(data || []);
    } catch (err: any) {
      console.error('Failed to load campaigns', err);
      notification.error('Load failed', err?.message || 'Could not fetch campaigns');
    } finally {
      setLoading(false);
    }
  }

  async function loadLookups() {
    const [{ data: v }, { data: c }, { data: vend }] = await Promise.all([
      supabase.from('campaign_vouchers').select('id, code, campaign_name').eq('status', 'active'),
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('vendors').select('id, store_name, logo_url, woocommerce_vendor_id').eq('is_active', true).order('store_name'),
    ]);
    setVouchers(v || []);
    setCategories(c || []);
    setVendorsList(vend || []);
  }

  // AI content assistant — INT-503. Drafts hero/vendor copy for the campaign
  // landing page, reusing the same Anthropic Claude Haiku call already shipped
  // for admin-ai-product-draft / admin-ai-email-draft (netlify/functions),
  // not a new AI provider.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContext, setAiContext] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<{
    headline: string;
    subtitle: string;
    badge_text: string;
    cta_label: string;
    vendor_story: string;
  } | null>(null);

  async function generateCampaignAiDraft() {
    if (!session?.access_token) {
      notification.error('Unauthorized', 'Please sign in again.');
      return;
    }
    setAiGenerating(true);
    setAiResult(null);
    try {
      const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
      const categoryName = categories.find((c) => c.id === formData.product_category_id)?.name || '';
      const res = await fetch(`${functionsBase}/admin-ai-campaign-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          public_title: formData.public_title,
          campaign_objective: formData.campaign_objective,
          target_type: formData.target_type,
          vendor_name: formData.vendor_name,
          category_name: categoryName,
          context: aiContext,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'AI draft failed');
      setAiResult(json.data);
    } catch (err: any) {
      notification.error('AI Draft', err?.message || 'Failed to generate draft');
    } finally {
      setAiGenerating(false);
    }
  }

  function suggestVoucherCode(): string {
    const base = (formData.slug || formData.public_title || 'campaign')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    const suffix = Math.floor(100 + Math.random() * 900);
    return `${base}-${suffix}`;
  }

  function toggleVoucherPanel() {
    setVoucherForm((f) => ({ ...f, code: f.code || suggestVoucherCode() }));
    setVoucherPanelOpen((o) => !o);
  }

  async function handleCreateCampaignVoucher() {
    if (!editingId) {
      notification.error('Save first', 'Save this campaign as a draft first, then reopen it to create a linked voucher.');
      return;
    }
    if (!voucherForm.code.trim()) {
      notification.error('Validation', 'Voucher code is required');
      return;
    }
    if (voucherForm.discount_type !== 'free' && (!voucherForm.discount_value || Number(voucherForm.discount_value) <= 0)) {
      notification.error('Validation', 'Discount value must be greater than 0');
      return;
    }

    setVoucherCreating(true);
    try {
      // Scope inherited from the campaign's own targeting — vendor/product/
      // category — rather than re-entered, so the voucher can't drift out of
      // sync with what the campaign is actually promoting.
      const vendorIds = formData.target_type === 'vendor' && formData.target_id ? [formData.target_id] : [];
      const productIds =
        formData.product_source === 'manual'
          ? formData.product_manual_ids.split(',').map((s) => s.trim()).filter(Boolean)
          : [];
      // Prefer product-selection category, else category-targeted campaign id.
      const categoryIds = formData.product_category_id
        ? [formData.product_category_id]
        : formData.target_type === 'category' && formData.target_id
          ? [formData.target_id]
          : [];

      const payload = {
        code: voucherForm.code.trim().toUpperCase(),
        campaign_name: formData.public_title.trim() || formData.internal_name.trim(),
        campaign_id: editingId,
        discount_type: voucherForm.discount_type,
        discount_value: voucherForm.discount_type === 'free' ? 0 : Number(voucherForm.discount_value),
        vendor_ids: vendorIds,
        product_ids: productIds,
        category_ids: categoryIds,
        max_uses: Number(voucherForm.max_uses) || 1,
        max_uses_per_customer: Number(voucherForm.max_uses_per_customer) || 1,
        valid_from: new Date().toISOString(),
        valid_until: voucherForm.valid_until
          ? new Date(voucherForm.valid_until).toISOString()
          : formData.end_date
          ? new Date(formData.end_date).toISOString()
          : null,
        created_by: user?.email || 'system',
      };

      const { data, error } = await supabase
        .from('campaign_vouchers')
        .insert(payload)
        .select('id, code, campaign_name')
        .single();
      if (error) throw error;

      setVouchers((prev) => [...prev, data]);
      setFormData((f) => ({ ...f, offer_voucher_id: data.id }));
      setVoucherPanelOpen(false);
      setVoucherForm({ code: '', discount_type: 'percentage', discount_value: '', max_uses: 1000, max_uses_per_customer: 1, valid_until: '' });
      notification.success('Voucher created', `${data.code} created and linked to this campaign`);
    } catch (err: any) {
      console.error('Create campaign voucher error', err);
      notification.error('Save failed', err?.message || 'Unable to create voucher');
    } finally {
      setVoucherCreating(false);
    }
  }

  function addMediaItem() {
    setFormData((prev) => ({
      ...prev,
      media_gallery_items: [...prev.media_gallery_items, { type: 'image', url: '', caption: '' }],
    }));
  }

  function updateMediaItem(index: number, patch: Partial<MediaGalleryItem>) {
    setFormData((prev) => ({
      ...prev,
      media_gallery_items: prev.media_gallery_items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function removeMediaItem(index: number) {
    setFormData((prev) => ({
      ...prev,
      media_gallery_items: prev.media_gallery_items.filter((_, i) => i !== index),
    }));
  }

  function resetForm() {
    setFormData(emptyForm);
    setSections(emptySections());
    setEditingId(null);
    setVoucherPanelOpen(false);
    setVoucherForm({ code: '', discount_type: 'percentage', discount_value: '', max_uses: 1000, max_uses_per_customer: 1, valid_until: '' });
  }

  function openCreate() {
    resetForm();
    setFormOpen(true);
  }

  async function openEdit(campaign: CampaignRow) {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can edit campaigns');
      return;
    }
    const hero = campaign.hero_config || {};
    const vendor = campaign.vendor_override || {};
    const rules = campaign.product_selection_rules || {};
    const reviews = campaign.review_rules || {};
    const offer = campaign.offer_config || {};

    setFormData({
      internal_name: campaign.internal_name,
      public_title: campaign.public_title,
      slug: campaign.slug,
      campaign_objective: campaign.campaign_objective || '',
      status: campaign.status,
      start_date: campaign.start_date ? campaign.start_date.slice(0, 16) : '',
      end_date: campaign.end_date ? campaign.end_date.slice(0, 16) : '',
      target_type: campaign.target_type,
      target_id: campaign.target_id || '',

      hero_headline: hero.headline || '',
      hero_subtitle: hero.subtitle || '',
      hero_cta_label: hero.ctaLabel || 'Shop Now',
      hero_badge_text: hero.badgeText || '',
      hero_image_desktop: hero.heroImageDesktop || '',
      hero_image_mobile: hero.heroImageMobile || '',
      hero_intro_video: hero.introductoryVideoUrl || '',

      vendor_name: vendor.name || '',
      vendor_logo: vendor.logoUrl || '',
      vendor_story: vendor.story || '',
      vendor_location: vendor.location || '',
      vendor_years_operating: vendor.yearsOperating ?? '',
      vendor_store_link: vendor.storeLinkUrl || '',
      vendor_shop_image: vendor.shopImageUrl || '',
      vendor_intro_video: vendor.introVideoUrl || '',

      product_source: rules.source || 'automatic',
      product_category_id: rules.categoryIds?.[0] ? String(rules.categoryIds[0]) : '',
      product_manual_ids: (rules.manualProductIds || []).join(', '),
      product_min_rating: rules.minimumRating ?? '',
      product_in_stock_only: rules.inStockOnly ?? true,
      product_discounted_only: rules.discountedOnly ?? false,
      product_max_products: rules.maxProducts ?? 12,

      review_scope: reviews.scope || 'mixed',
      review_min_rating: reviews.minimumRating ?? 4,
      review_max_reviews: reviews.maxReviews ?? 5,
      review_verified_only: reviews.verifiedPurchaseOnly ?? true,

      offer_voucher_id: offer.voucherId || '',

      media_gallery_items: [],
    });

    const { data: sectionRows } = await supabase
      .from('campaign_sections')
      .select('section_type, order_index, is_visible, config')
      .eq('campaign_id', campaign.id);

    const nextSections = emptySections();
    (sectionRows as SectionRow[] | null)?.forEach((s) => {
      if (nextSections[s.section_type]) {
        nextSections[s.section_type] = { visible: s.is_visible, order: s.order_index };
      }
    });
    setSections(nextSections);

    const mediaGallerySection = (sectionRows as SectionRow[] | null)?.find((s) => s.section_type === 'media_gallery');
    setFormData((prev) => ({
      ...prev,
      media_gallery_items: Array.isArray(mediaGallerySection?.config?.items) ? mediaGallerySection!.config!.items : [],
    }));
    setEditingId(campaign.id);
    setFormOpen(true);
  }

  function buildPayload() {
    const voucher = vouchers.find((v) => v.id === formData.offer_voucher_id);
    const selectedVendor = vendorsList.find((v) => v.id === formData.target_id);
    const rawStoreLink = formData.vendor_store_link.trim();
    // Accept "/vendor/10", bare "10", or mistaken "/10" — always persist the
    // storefront route the PWA actually serves.
    const normalizedStoreLink = (() => {
      if (!rawStoreLink) {
        const routeKey = selectedVendor?.woocommerce_vendor_id || formData.target_id.trim();
        return routeKey ? `/vendor/${routeKey}` : undefined;
      }
      if (/^https?:\/\//i.test(rawStoreLink) || rawStoreLink.startsWith('/vendor/')) return rawStoreLink;
      return `/vendor/${rawStoreLink.replace(/^\//, '')}`;
    })();

    return {
      internal_name: formData.internal_name.trim(),
      public_title: formData.public_title.trim(),
      slug: formData.slug.trim() || slugify(formData.public_title),
      campaign_objective: formData.campaign_objective.trim() || null,
      status: formData.status,
      start_date: formData.start_date ? new Date(formData.start_date).toISOString() : null,
      end_date: formData.end_date ? new Date(formData.end_date).toISOString() : null,
      target_type: formData.target_type,
      target_id: formData.target_id.trim() || null,

      hero_config: {
        headline: formData.hero_headline.trim(),
        subtitle: formData.hero_subtitle.trim(),
        ctaLabel: formData.hero_cta_label.trim() || 'Shop Now',
        badgeText: formData.hero_badge_text.trim() || undefined,
        heroImageDesktop: formData.hero_image_desktop.trim() || undefined,
        heroImageMobile: formData.hero_image_mobile.trim() || undefined,
        introductoryVideoUrl: formData.hero_intro_video.trim() || undefined,
      },
      vendor_override:
        formData.target_type === 'vendor' && formData.vendor_name.trim()
          ? {
              name: formData.vendor_name.trim(),
              story: formData.vendor_story.trim() || undefined,
              location: formData.vendor_location.trim() || undefined,
              yearsOperating: formData.vendor_years_operating === '' ? undefined : Number(formData.vendor_years_operating),
              storeLinkUrl: normalizedStoreLink,
              logoUrl: formData.vendor_logo.trim() || undefined,
              shopImageUrl: formData.vendor_shop_image.trim() || undefined,
              introVideoUrl: formData.vendor_intro_video.trim() || undefined,
            }
          : {},
      product_selection_rules: {
        source: formData.product_source,
        categoryIds: formData.product_category_id ? [formData.product_category_id] : undefined,
        manualProductIds: formData.product_manual_ids
          ? formData.product_manual_ids.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
        minimumRating: formData.product_min_rating === '' ? undefined : Number(formData.product_min_rating),
        inStockOnly: formData.product_in_stock_only,
        discountedOnly: formData.product_discounted_only,
        maxProducts: Number(formData.product_max_products) || 12,
      },
      review_rules: {
        scope: formData.review_scope,
        minimumRating: formData.review_min_rating === '' ? undefined : Number(formData.review_min_rating),
        maxReviews: Number(formData.review_max_reviews) || 5,
        verifiedPurchaseOnly: formData.review_verified_only,
      },
      offer_config: voucher
        ? {
            voucherId: voucher.id,
            couponCode: voucher.code,
            displayText: voucher.campaign_name,
          }
        : {},
    };
  }

  async function saveSections(campaignId: string) {
    await supabase.from('campaign_sections').delete().eq('campaign_id', campaignId);
    const mediaItems = formData.media_gallery_items.filter((item) => item.url.trim());
    const rows = ALL_SECTIONS.map((type) => ({
      campaign_id: campaignId,
      section_type: type,
      order_index: sections[type].order,
      is_visible: sections[type].visible,
      config: type === 'media_gallery' ? { items: mediaItems } : {},
    }));
    const { error } = await supabase.from('campaign_sections').insert(rows);
    if (error) throw error;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can manage campaigns');
      return;
    }
    if (!formData.internal_name.trim() || !formData.public_title.trim()) {
      notification.error('Validation', 'Internal name and public title are required');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      let campaignId = editingId;

      if (editingId) {
        const { error } = await supabase.from('campaigns').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('campaigns').insert(payload).select('id').single();
        if (error) throw error;
        campaignId = data.id;
      }

      await saveSections(campaignId!);
      notification.success(editingId ? 'Updated' : 'Created', `Campaign ${editingId ? 'updated' : 'created'} successfully`);
      setFormOpen(false);
      resetForm();
      await loadCampaigns();
    } catch (err: any) {
      console.error('Save campaign error', err);
      notification.error('Save failed', err?.message || 'Unable to save campaign');
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(campaign: CampaignRow) {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can duplicate campaigns');
      return;
    }
    try {
      const { data: sectionRows } = await supabase
        .from('campaign_sections')
        .select('section_type, order_index, is_visible, config')
        .eq('campaign_id', campaign.id);

      const { data: newCampaign, error } = await supabase
        .from('campaigns')
        .insert({
          slug: `${campaign.slug}-copy-${Date.now().toString(36)}`,
          internal_name: `${campaign.internal_name} (Copy)`,
          public_title: campaign.public_title,
          campaign_objective: campaign.campaign_objective,
          status: 'draft',
          target_type: campaign.target_type,
          target_id: campaign.target_id,
          hero_config: campaign.hero_config,
          vendor_override: campaign.vendor_override,
          product_selection_rules: campaign.product_selection_rules,
          review_rules: campaign.review_rules,
          offer_config: campaign.offer_config,
        })
        .select('id')
        .single();
      if (error) throw error;

      if (sectionRows?.length) {
        await supabase.from('campaign_sections').insert(
          sectionRows.map((s) => ({ ...s, campaign_id: newCampaign.id }))
        );
      }

      notification.success('Duplicated', 'Campaign duplicated as a new draft');
      await loadCampaigns();
    } catch (err: any) {
      console.error('Duplicate campaign error', err);
      notification.error('Duplicate failed', err?.message || 'Unable to duplicate campaign');
    }
  }

  async function handleStatusChange(id: string, status: CampaignStatus) {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can change campaign status');
      return;
    }
    try {
      const { error } = await supabase.from('campaigns').update({ status }).eq('id', id);
      if (error) throw error;
      notification.success('Updated', `Campaign marked as ${status}`);
      await loadCampaigns();
    } catch (err: any) {
      notification.error('Update failed', err?.message || 'Unable to update status');
    }
  }

  async function handleDelete(id: string) {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can delete campaigns');
      return;
    }
    if (!confirm('Delete this campaign? Sections, QR variants, and analytics events will also be deleted.')) return;
    try {
      const { error } = await supabase.from('campaigns').delete().eq('id', id);
      if (error) throw error;
      notification.success('Deleted', 'Campaign removed');
      await loadCampaigns();
    } catch (err: any) {
      notification.error('Delete failed', err?.message || 'Unable to delete campaign');
    }
  }

  // ---- QR generation (INT-504) --------------------------------------------

  async function openQr(campaign: CampaignRow) {
    setQrCampaign(campaign);
    setQrImages({});
    setNewChannelName('');
    await loadQrVariants(campaign.id);
  }

  async function loadQrVariants(campaignId: string) {
    try {
      const { data, error } = await supabase
        .from('campaign_qr_variants')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const variants = (data as QrVariantRow[]) || [];
      setQrVariants(variants);

      if (variants.length) {
        const { data: events } = await supabase
          .from('campaign_analytics_events')
          .select('qr_id')
          .eq('campaign_id', campaignId)
          .eq('event_type', 'scan');
        const counts: Record<string, number> = {};
        (events || []).forEach((e: { qr_id: string | null }) => {
          if (e.qr_id) counts[e.qr_id] = (counts[e.qr_id] || 0) + 1;
        });
        setQrScanCounts(counts);
      } else {
        setQrScanCounts({});
      }
    } catch (err: any) {
      notification.error('Load failed', err?.message || 'Could not load QR variants');
    }
  }

  async function handleAddChannel() {
    if (!qrCampaign || !newChannelName.trim()) return;
    const trackingSlug = slugifyChannel(newChannelName);
    if (!trackingSlug) {
      notification.error('Validation', 'Enter a channel name (e.g. "Vendor Shop Poster")');
      return;
    }
    setQrBusy(true);
    try {
      const { error } = await supabase.from('campaign_qr_variants').insert({
        campaign_id: qrCampaign.id,
        channel_name: newChannelName.trim(),
        tracking_slug: `${trackingSlug}-${Date.now().toString(36)}`,
      });
      if (error) throw error;
      setNewChannelName('');
      await loadQrVariants(qrCampaign.id);
      notification.success('Channel added', 'New QR channel created');
    } catch (err: any) {
      notification.error('Save failed', err?.message || 'Unable to add channel');
    } finally {
      setQrBusy(false);
    }
  }

  async function handleDeleteChannel(variantId: string) {
    if (!qrCampaign) return;
    if (!confirm('Delete this QR channel? Existing scan history for it stays, but the QR image will stop resolving.')) return;
    try {
      const { error } = await supabase.from('campaign_qr_variants').delete().eq('id', variantId);
      if (error) throw error;
      await loadQrVariants(qrCampaign.id);
    } catch (err: any) {
      notification.error('Delete failed', err?.message || 'Unable to delete channel');
    }
  }

  async function ensureQrImage(variant: QrVariantRow) {
    if (qrImages[variant.id] || !qrCampaign) return;
    const trackingUrl = buildCampaignTrackingUrl(STOREFRONT_BASE_URL, qrCampaign.slug, variant.tracking_slug);
    const [png, svg] = await Promise.all([generateQrPngDataUrl(trackingUrl), generateQrSvgMarkup(trackingUrl)]);
    setQrImages((prev) => ({ ...prev, [variant.id]: { png, svg } }));
  }

  // ---- Analytics summary (condensed Screen 3) ------------------------------

  const FUNNEL_STAGES = ['scan', 'page_visit', 'add_to_cart', 'checkout_start', 'checkout_complete'];

  async function openAnalytics(campaign: CampaignRow) {
    setAnalyticsCampaign(campaign);
    setAnalyticsLoading(true);
    try {
      const [{ data: events }, { data: variants }] = await Promise.all([
        supabase
          .from('campaign_analytics_events')
          .select('event_type, revenue, qr_id')
          .eq('campaign_id', campaign.id),
        supabase.from('campaign_qr_variants').select('id, channel_name').eq('campaign_id', campaign.id),
      ]);

      const funnel: Record<string, number> = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0]));
      let revenue = 0;
      const scansByQr: Record<string, number> = {};

      (events || []).forEach((e: { event_type: string; revenue: number | null; qr_id: string | null }) => {
        if (funnel[e.event_type] != null) funnel[e.event_type]++;
        if (e.event_type === 'checkout_complete') revenue += Number(e.revenue || 0);
        if (e.event_type === 'scan' && e.qr_id) scansByQr[e.qr_id] = (scansByQr[e.qr_id] || 0) + 1;
      });

      const channelBreakdown = ((variants as { id: string; channel_name: string }[]) || []).map((v) => ({
        channel_name: v.channel_name,
        scans: scansByQr[v.id] || 0,
      }));

      setAnalyticsData({ funnel, revenue, channelBreakdown });
    } catch (err: any) {
      notification.error('Load failed', err?.message || 'Could not load analytics');
    } finally {
      setAnalyticsLoading(false);
    }
  }

  const stats = useMemo(() => {
    const active = campaigns.filter((c) => c.status === 'active').length;
    const draft = campaigns.filter((c) => c.status === 'draft').length;
    return { total: campaigns.length, active, draft };
  }, [campaigns]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Marketing Campaigns</h1>
          <p className="text-gray-600 mt-2">
            Build QR-linked, vendor-spotlight landing pages for julinemart.com/campaigns/[slug]
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary flex items-center">
            <Plus className="w-5 h-5 mr-2" />
            Create Campaign
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Campaigns</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <Megaphone className="w-8 h-8 text-primary-600" />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active</p>
              <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Drafts</p>
              <p className="text-2xl font-bold text-gray-900">{stats.draft}</p>
            </div>
            <FileEdit className="w-8 h-8 text-gray-500" />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="card text-center py-12">
          <Megaphone className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">No campaigns created yet.</p>
          {isAdmin && (
            <button onClick={openCreate} className="btn-primary">
              Create your first campaign
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaigns.map((campaign) => {
            const StatusIcon = statusIcons[campaign.status];
            return (
              <div key={campaign.id} className="card space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{campaign.public_title}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">
                        /{showId[campaign.id] ? campaign.slug : campaign.slug.slice(0, 12) + (campaign.slug.length > 12 ? '…' : '')}
                      </code>
                      <button onClick={() => setShowId((p) => ({ ...p, [campaign.id]: !p[campaign.id] }))} className="text-gray-400 hover:text-gray-600">
                        {showId[campaign.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 shrink-0 ${statusColors[campaign.status]}`}>
                    <StatusIcon className="w-3 h-3" />
                    {campaign.status}
                  </span>
                </div>

                <p className="text-xs text-gray-500 capitalize">Target: {campaign.target_type.replace('_', ' ')}</p>

                <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pt-2 border-t">
                  <button onClick={() => openQr(campaign)} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-100">
                    <QrCode className="w-4 h-4" /> QR Codes
                  </button>
                  <button onClick={() => openAnalytics(campaign)} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                    <BarChart3 className="w-4 h-4" /> Analytics
                  </button>
                  {isAdmin && (
                    <>
                      <button onClick={() => openEdit(campaign)} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                        <Edit className="w-4 h-4" /> Edit
                      </button>
                      <button onClick={() => handleDuplicate(campaign)} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                        <Copy className="w-4 h-4" /> Duplicate
                      </button>
                      {campaign.status === 'active' ? (
                        <button onClick={() => handleStatusChange(campaign.id, 'paused')} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 hover:bg-orange-100">
                          <PauseCircle className="w-4 h-4" /> Pause
                        </button>
                      ) : campaign.status !== 'archived' ? (
                        <button onClick={() => handleStatusChange(campaign.id, 'active')} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100">
                          <CheckCircle className="w-4 h-4" /> Publish
                        </button>
                      ) : null}
                      {campaign.status !== 'archived' && (
                        <button onClick={() => handleStatusChange(campaign.id, 'archived')} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100">
                          <ArchiveIcon className="w-4 h-4" /> Archive
                        </button>
                      )}
                      <button onClick={() => handleDelete(campaign.id)} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
                        <Trash2 className="w-4 h-4" /> Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold">{editingId ? 'Edit Campaign' : 'Create Campaign'}</h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">1. Campaign overview</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Internal Name *</label>
                    <input type="text" value={formData.internal_name} onChange={(e) => setFormData({ ...formData, internal_name: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Public Title *</label>
                    <input type="text" value={formData.public_title} onChange={(e) => setFormData({ ...formData, public_title: e.target.value, slug: formData.slug || slugify(e.target.value) })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">URL Slug *</label>
                    <input type="text" value={formData.slug} onChange={(e) => setFormData({ ...formData, slug: slugify(e.target.value) })} placeholder="kitchen-world-summer" className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                    <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as CampaignStatus })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                      {(['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'] as CampaignStatus[]).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
                    <input type="datetime-local" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
                    <input type="datetime-local" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Target Type</label>
                    <select value={formData.target_type} onChange={(e) => setFormData({ ...formData, target_type: e.target.value as TargetType })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                      {(['vendor', 'category', 'product', 'collection', 'multi_vendor', 'general'] as TargetType[]).map((t) => (
                        <option key={t} value={t}>{t.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {formData.target_type === 'vendor'
                        ? 'Target Vendor'
                        : formData.target_type === 'category'
                          ? 'Target Category'
                          : 'Target ID'}
                    </label>
                    {formData.target_type === 'vendor' ? (
                      <select
                        value={formData.target_id}
                        onChange={(e) => {
                          const v = vendorsList.find((x) => x.id === e.target.value);
                          const routeKey = v?.woocommerce_vendor_id || e.target.value;
                          setFormData({
                            ...formData,
                            target_id: e.target.value,
                            vendor_name: v?.store_name || formData.vendor_name,
                            vendor_logo: v?.logo_url || formData.vendor_logo,
                            vendor_store_link: routeKey ? `/vendor/${routeKey}` : formData.vendor_store_link,
                          });
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">Select a vendor…</option>
                        {vendorsList.map((v) => (
                          <option key={v.id} value={v.id}>{v.store_name}</option>
                        ))}
                      </select>
                    ) : formData.target_type === 'category' ? (
                      <select
                        value={formData.target_id}
                        onChange={(e) => setFormData({
                          ...formData,
                          target_id: e.target.value,
                          // Keep product-selection category in sync for voucher scoping.
                          product_category_id: e.target.value || formData.product_category_id,
                          product_source: e.target.value ? 'rules_based' : formData.product_source,
                        })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      >
                        <option value="">Select a category…</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={formData.target_id}
                        onChange={(e) => setFormData({ ...formData, target_id: e.target.value })}
                        placeholder="vendor / category / product uuid"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500"
                      />
                    )}
                  </div>
                </div>
              </section>

              <div className="rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setAiOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-purple-50 transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-purple-800">
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    Draft landing page copy with AI
                    <span className="text-xs font-normal text-purple-500">— headline, subtitle, vendor story &amp; more</span>
                  </span>
                  {aiOpen ? <ChevronUp className="w-4 h-4 text-purple-400" /> : <ChevronDown className="w-4 h-4 text-purple-400" />}
                </button>

                {aiOpen && (
                  <div className="px-4 pb-4 space-y-3 border-t border-purple-200">
                    <div className="pt-3">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Extra context <span className="text-gray-400">(optional — e.g. "30% off all sneakers this weekend")</span>
                      </label>
                      <input
                        type="text"
                        value={aiContext}
                        onChange={(e) => { setAiContext(e.target.value); setAiResult(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generateCampaignAiDraft(); } }}
                        placeholder="Describe the promotion in a sentence…"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Uses the public title, objective, target type{formData.vendor_name ? ', vendor name' : ''} and category already filled in above.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void generateCampaignAiDraft()}
                      disabled={aiGenerating}
                      className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {aiGenerating
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                        : <><Sparkles className="w-4 h-4" /> Generate</>}
                    </button>

                    {aiResult && (
                      <div className="rounded-lg border border-purple-200 bg-white p-3 space-y-2">
                        {([
                          ['headline', 'Headline', aiResult.headline, () => setFormData((f) => ({ ...f, hero_headline: aiResult.headline }))],
                          ['subtitle', 'Subtitle', aiResult.subtitle, () => setFormData((f) => ({ ...f, hero_subtitle: aiResult.subtitle }))],
                          ['badge_text', 'Badge text', aiResult.badge_text, () => setFormData((f) => ({ ...f, hero_badge_text: aiResult.badge_text }))],
                          ['cta_label', 'CTA label', aiResult.cta_label, () => setFormData((f) => ({ ...f, hero_cta_label: aiResult.cta_label }))],
                          ...(formData.target_type === 'vendor' && aiResult.vendor_story
                            ? [['vendor_story', 'Vendor story', aiResult.vendor_story, () => setFormData((f) => ({ ...f, vendor_story: aiResult.vendor_story }))] as const]
                            : []),
                        ] as const)
                          .filter(([, , value]) => value)
                          .map(([key, label, value, apply]) => (
                            <div key={key}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
                                  <p className="text-sm text-gray-900 whitespace-pre-line">{value}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={apply}
                                  className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors"
                                >
                                  Use
                                </button>
                              </div>
                              <div className="border-t border-gray-100 mt-2" />
                            </div>
                          ))}
                        <button
                          type="button"
                          onClick={() => setFormData((f) => ({
                            ...f,
                            hero_headline: aiResult.headline || f.hero_headline,
                            hero_subtitle: aiResult.subtitle || f.hero_subtitle,
                            hero_badge_text: aiResult.badge_text || f.hero_badge_text,
                            hero_cta_label: aiResult.cta_label || f.hero_cta_label,
                            vendor_story: f.target_type === 'vendor' && aiResult.vendor_story ? aiResult.vendor_story : f.vendor_story,
                          }))}
                          className="w-full py-2 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                        >
                          Use all
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <section className="space-y-4 pt-4 border-t">
                <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">2. Hero</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Headline *</label>
                    <input type="text" value={formData.hero_headline} onChange={(e) => setFormData({ ...formData, hero_headline: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" required />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Subtitle</label>
                    <textarea value={formData.hero_subtitle} onChange={(e) => setFormData({ ...formData, hero_subtitle: e.target.value })} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">CTA Label</label>
                    <input type="text" value={formData.hero_cta_label} onChange={(e) => setFormData({ ...formData, hero_cta_label: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Badge Text</label>
                    <input type="text" value={formData.hero_badge_text} onChange={(e) => setFormData({ ...formData, hero_badge_text: e.target.value })} placeholder="Free delivery over ₦15,000" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Hero Image URL (Desktop)</label>
                    <input type="text" value={formData.hero_image_desktop} onChange={(e) => setFormData({ ...formData, hero_image_desktop: e.target.value })} placeholder="https://... (Supabase Storage or Cloudinary)" className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Hero Image URL (Mobile)</label>
                    <input type="text" value={formData.hero_image_mobile} onChange={(e) => setFormData({ ...formData, hero_image_mobile: e.target.value })} placeholder="Optional — falls back to desktop image" className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Intro Video URL</label>
                    <input type="text" value={formData.hero_intro_video} onChange={(e) => setFormData({ ...formData, hero_intro_video: e.target.value })} placeholder="https://... (Supabase Storage, YouTube, or Vimeo link)" className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                    <p className="text-xs text-gray-500 mt-1">
                      Paste a link for now — upload a file, then paste its Storage URL here (no direct upload widget yet).
                    </p>
                  </div>
                </div>
              </section>

              {formData.target_type === 'vendor' && (
                <section className="space-y-4 pt-4 border-t">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">3. Vendor story</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Vendor</label>
                      <select value={formData.target_id} onChange={(e) => {
                        const v = vendorsList.find((x) => x.id === e.target.value);
                        const routeKey = v?.woocommerce_vendor_id || e.target.value;
                        setFormData({
                          ...formData,
                          target_id: e.target.value,
                          vendor_name: v?.store_name || formData.vendor_name,
                          vendor_logo: v?.logo_url || formData.vendor_logo,
                          // Storefront vendor pages live at /vendor/[woo_or_jlo_key], not /[id].
                          vendor_store_link: routeKey ? `/vendor/${routeKey}` : formData.vendor_store_link,
                        });
                      }} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                        <option value="">Select a vendor…</option>
                        {vendorsList.map((v) => (
                          <option key={v.id} value={v.id}>{v.store_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                      <input type="text" value={formData.vendor_location} onChange={(e) => setFormData({ ...formData, vendor_location: e.target.value })} placeholder="Lagos, Nigeria" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Vendor Logo URL</label>
                      <input type="text" value={formData.vendor_logo} onChange={(e) => setFormData({ ...formData, vendor_logo: e.target.value })} placeholder="Auto-filled from vendor profile — paste over to override" className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                      <p className="text-xs text-gray-500 mt-1">Shown as the vendor badge on the hero section, instead of initials.</p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Vendor Story</label>
                      <textarea value={formData.vendor_story} onChange={(e) => setFormData({ ...formData, vendor_story: e.target.value })} rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Years Operating</label>
                      <input type="number" value={formData.vendor_years_operating} onChange={(e) => setFormData({ ...formData, vendor_years_operating: e.target.value === '' ? '' : Number(e.target.value) })} min="0" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Full Store Link</label>
                      <input type="text" value={formData.vendor_store_link} onChange={(e) => setFormData({ ...formData, vendor_store_link: e.target.value })} placeholder="/vendor/123" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Shop Image URL</label>
                      <input type="text" value={formData.vendor_shop_image} onChange={(e) => setFormData({ ...formData, vendor_shop_image: e.target.value })} placeholder="https://..." className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Intro Video URL</label>
                      <input type="text" value={formData.vendor_intro_video} onChange={(e) => setFormData({ ...formData, vendor_intro_video: e.target.value })} placeholder="https://..." className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                    </div>
                  </div>
                </section>
              )}

              <section className="space-y-4 pt-4 border-t">
                <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">4. Product selection</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Selection Method</label>
                    <select value={formData.product_source} onChange={(e) => setFormData({ ...formData, product_source: e.target.value as ProductSource })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                      <option value="automatic">Automatic (in-stock, top-rated)</option>
                      <option value="rules_based">Rules-based (category + filters)</option>
                      <option value="manual">Manual (pick product IDs)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Max Products</label>
                    <input type="number" value={formData.product_max_products} onChange={(e) => setFormData({ ...formData, product_max_products: Number(e.target.value) })} min="1" max="50" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  {formData.product_source === 'rules_based' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                      <select value={formData.product_category_id} onChange={(e) => setFormData({ ...formData, product_category_id: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                        <option value="">Any category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {formData.product_source === 'manual' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Product IDs (comma-separated)</label>
                      <input type="text" value={formData.product_manual_ids} onChange={(e) => setFormData({ ...formData, product_manual_ids: e.target.value })} placeholder="123, 456, 789" className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary-500" />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Rating</label>
                    <input type="number" value={formData.product_min_rating} onChange={(e) => setFormData({ ...formData, product_min_rating: e.target.value === '' ? '' : Number(e.target.value) })} min="0" max="5" step="0.1" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="flex items-center gap-4 pt-7">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={formData.product_in_stock_only} onChange={(e) => setFormData({ ...formData, product_in_stock_only: e.target.checked })} />
                      In stock only
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={formData.product_discounted_only} onChange={(e) => setFormData({ ...formData, product_discounted_only: e.target.checked })} />
                      Discounted only
                    </label>
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t">
                <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">5. Reviews</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Review Source</label>
                    <select value={formData.review_scope} onChange={(e) => setFormData({ ...formData, review_scope: e.target.value as ReviewScope })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                      <option value="mixed">Mixed (featured → vendor → category)</option>
                      <option value="featured_products">Featured products only</option>
                      <option value="vendor">Vendor only</option>
                      <option value="category">Category only</option>
                      <option value="product">Single product</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Max Reviews</label>
                    <input type="number" value={formData.review_max_reviews} onChange={(e) => setFormData({ ...formData, review_max_reviews: Number(e.target.value) })} min="1" max="50" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Rating</label>
                    <input type="number" value={formData.review_min_rating} onChange={(e) => setFormData({ ...formData, review_min_rating: e.target.value === '' ? '' : Number(e.target.value) })} min="0" max="5" step="0.5" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="flex items-center pt-7">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={formData.review_verified_only} onChange={(e) => setFormData({ ...formData, review_verified_only: e.target.checked })} />
                      Verified purchases only
                    </label>
                  </div>
                </div>
              </section>

              <section className="space-y-4 pt-4 border-t">
                <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">6. Offer</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Link an existing voucher</label>
                  <select value={formData.offer_voucher_id} onChange={(e) => setFormData({ ...formData, offer_voucher_id: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                    <option value="">No offer</option>
                    {vouchers.map((v) => (
                      <option key={v.id} value={v.id}>{v.code} — {v.campaign_name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Vouchers are managed on the Vouchers page — create one there first if you don't see it here.
                  </p>
                </div>

                {editingId ? (
                  <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50/40 overflow-hidden">
                    <button
                      type="button"
                      onClick={toggleVoucherPanel}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-purple-50 transition-colors"
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold text-purple-800">
                        <Ticket className="w-4 h-4 text-purple-500" />
                        Create a new voucher for this campaign
                      </span>
                      {voucherPanelOpen ? <ChevronUp className="w-4 h-4 text-purple-400" /> : <ChevronDown className="w-4 h-4 text-purple-400" />}
                    </button>

                    {voucherPanelOpen && (
                      <div className="px-4 pb-4 space-y-3 border-t border-purple-200 pt-3">
                        <p className="text-xs text-gray-500">
                          Scope is inherited from this campaign automatically —{' '}
                          {formData.target_type === 'vendor' && formData.target_id
                            ? `restricted to ${formData.vendor_name || 'the selected vendor'}`
                            : formData.product_source === 'manual' && formData.product_manual_ids
                            ? `restricted to ${formData.product_manual_ids.split(',').filter(Boolean).length} specific product(s)`
                            : formData.product_category_id
                            ? 'restricted to the selected category'
                            : 'no restriction — applies storewide'}
                          .
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Voucher Code</label>
                            <input
                              type="text"
                              value={voucherForm.code}
                              onChange={(e) => setVoucherForm({ ...voucherForm, code: e.target.value.toUpperCase() })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-purple-400"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Discount Type</label>
                            <select
                              value={voucherForm.discount_type}
                              onChange={(e) => setVoucherForm({ ...voucherForm, discount_type: e.target.value as any })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                            >
                              <option value="free">Free (100% Off)</option>
                              <option value="percentage">Percentage Off</option>
                              <option value="fixed_amount">Fixed Amount Off</option>
                            </select>
                          </div>
                          {voucherForm.discount_type !== 'free' && (
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">Discount Value</label>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={voucherForm.discount_value}
                                onChange={(e) => setVoucherForm({ ...voucherForm, discount_value: e.target.value === '' ? '' : Number(e.target.value) })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                              />
                            </div>
                          )}
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Max Total Uses</label>
                            <input
                              type="number"
                              min="1"
                              value={voucherForm.max_uses}
                              onChange={(e) => setVoucherForm({ ...voucherForm, max_uses: Number(e.target.value) })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Max Uses Per Customer</label>
                            <input
                              type="number"
                              min="1"
                              value={voucherForm.max_uses_per_customer}
                              onChange={(e) => setVoucherForm({ ...voucherForm, max_uses_per_customer: Number(e.target.value) })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">Valid Until (optional)</label>
                            <input
                              type="datetime-local"
                              value={voucherForm.valid_until}
                              onChange={(e) => setVoucherForm({ ...voucherForm, valid_until: e.target.value })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-400"
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCreateCampaignVoucher()}
                          disabled={voucherCreating}
                          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
                        >
                          {voucherCreating
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
                            : <><Ticket className="w-4 h-4" /> Create &amp; Link Voucher</>}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-gray-500">
                    Save this campaign as a draft first, then reopen it here to create a voucher linked directly to it.
                  </p>
                )}
              </section>

              <section className="space-y-4 pt-4 border-t">
                <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">7. Media gallery</h3>
                <p className="text-xs text-gray-500">
                  Customer testimonial videos, behind-the-scenes content, or user-generated photos. Paste a link for
                  now — upload a file, then paste its Storage URL here (no direct upload widget yet).
                </p>
                <div className="space-y-3">
                  {formData.media_gallery_items.map((item, index) => (
                    <div key={index} className="flex flex-wrap items-start gap-3 bg-gray-50 rounded-lg px-3 py-3">
                      <select
                        value={item.type}
                        onChange={(e) => updateMediaItem(index, { type: e.target.value as 'image' | 'video' })}
                        className="px-2 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="image">Image</option>
                        <option value="video">Video</option>
                      </select>
                      <input
                        type="text"
                        value={item.url}
                        onChange={(e) => updateMediaItem(index, { url: e.target.value })}
                        placeholder={item.type === 'video' ? 'Video URL' : 'Image URL'}
                        className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                      />
                      <input
                        type="text"
                        value={item.caption}
                        onChange={(e) => updateMediaItem(index, { caption: e.target.value })}
                        placeholder="Caption (optional)"
                        className="flex-1 min-w-[160px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                      />
                      <button
                        type="button"
                        onClick={() => removeMediaItem(index)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addMediaItem}
                    className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700"
                  >
                    <Plus className="w-4 h-4" /> Add media item
                  </button>
                </div>
              </section>

              <section className="space-y-3 pt-4 border-t">
                <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600">8. Page sections</h3>
                <div className="space-y-2">
                  {ALL_SECTIONS.map((type) => (
                    <div key={type} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                      <label className="flex items-center gap-2 flex-1 text-sm font-medium text-gray-700 capitalize">
                        <input
                          type="checkbox"
                          checked={sections[type].visible}
                          onChange={(e) => setSections({ ...sections, [type]: { ...sections[type], visible: e.target.checked } })}
                        />
                        {type.replace('_', ' ')}
                      </label>
                      <input
                        type="number"
                        value={sections[type].order}
                        onChange={(e) => setSections({ ...sections, [type]: { ...sections[type], order: Number(e.target.value) } })}
                        className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                        title="Display order"
                      />
                    </div>
                  ))}
                </div>
              </section>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={() => { setFormOpen(false); resetForm(); }} className="btn-secondary" disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex items-center" disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...
                    </>
                  ) : editingId ? 'Update Campaign' : 'Save as Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {qrCampaign && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2"><QrCode className="w-5 h-5" /> QR Channels</h2>
                <p className="text-sm text-gray-600 mt-1">{qrCampaign.public_title}</p>
              </div>
              <button onClick={() => setQrCampaign(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  placeholder="e.g. Vendor Shop Poster, Instagram, Flyer"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
                <button onClick={handleAddChannel} disabled={qrBusy || !isAdmin} className="btn-primary flex items-center whitespace-nowrap">
                  <Plus className="w-4 h-4 mr-1" /> Add Channel
                </button>
              </div>

              {qrVariants.length === 0 ? (
                <p className="text-gray-500 text-center py-8 text-sm">
                  No QR channels yet. Add one above — each channel gets its own trackable QR code pointing at the same campaign page.
                </p>
              ) : (
                <div className="space-y-3">
                  {qrVariants.map((variant) => (
                    <div key={variant.id} className="border border-gray-200 rounded-lg p-4 flex items-center gap-4">
                      <button
                        onClick={() => ensureQrImage(variant)}
                        className="w-20 h-20 flex-none rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden"
                        title="Generate preview"
                      >
                        {qrImages[variant.id] ? (
                          <img src={qrImages[variant.id].png} alt={`QR for ${variant.channel_name}`} className="w-full h-full object-contain" />
                        ) : (
                          <QrCode className="w-8 h-8 text-gray-300" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{variant.channel_name}</p>
                        <p className="text-xs text-gray-500 font-mono truncate">?qr_source={variant.tracking_slug}</p>
                        <p className="text-xs text-gray-600 flex items-center gap-1 mt-1">
                          <ScanLine className="w-3 h-3" /> {qrScanCounts[variant.id] || 0} scans
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-none">
                        <button
                          onClick={async () => {
                            await ensureQrImage(variant);
                            const img = qrImages[variant.id];
                            if (img) downloadDataUrl(img.png, `${variant.tracking_slug}.png`);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline"
                        >
                          <Download className="w-3.5 h-3.5" /> PNG
                        </button>
                        <button
                          onClick={async () => {
                            await ensureQrImage(variant);
                            const img = qrImages[variant.id];
                            if (img) downloadSvgMarkup(img.svg, `${variant.tracking_slug}.svg`);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline"
                        >
                          <Download className="w-3.5 h-3.5" /> SVG
                        </button>
                        {isAdmin && (
                          <button onClick={() => handleDeleteChannel(variant.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {analyticsCampaign && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Campaign Analytics</h2>
                <p className="text-sm text-gray-600 mt-1">{analyticsCampaign.public_title}</p>
              </div>
              <button onClick={() => { setAnalyticsCampaign(null); setAnalyticsData(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {analyticsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
                </div>
              ) : analyticsData ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="card">
                      <p className="text-xs text-gray-600">Revenue Attributed</p>
                      <p className="text-xl font-bold text-gray-900">₦{analyticsData.revenue.toLocaleString('en-NG')}</p>
                    </div>
                    <div className="card">
                      <p className="text-xs text-gray-600">Conversion Rate</p>
                      <p className="text-xl font-bold text-gray-900">
                        {analyticsData.funnel.scan > 0
                          ? `${((analyticsData.funnel.checkout_complete / analyticsData.funnel.scan) * 100).toFixed(1)}%`
                          : '—'}
                      </p>
                    </div>
                    <div className="card">
                      <p className="text-xs text-gray-600">Total Scans</p>
                      <p className="text-xl font-bold text-gray-900">{analyticsData.funnel.scan}</p>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600 mb-3">Conversion Funnel</h3>
                    <div className="space-y-2">
                      {FUNNEL_STAGES.map((stage) => {
                        const count = analyticsData.funnel[stage] || 0;
                        const max = Math.max(1, analyticsData.funnel.scan || 1);
                        const pct = Math.min(100, (count / max) * 100);
                        return (
                          <div key={stage}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="capitalize text-gray-700">{stage.replace('_', ' ')}</span>
                              <span className="font-mono font-semibold text-gray-900">{count}</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2">
                              <div className="h-2 rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wide text-primary-600 mb-3">Scans by Channel</h3>
                    {analyticsData.channelBreakdown.length === 0 ? (
                      <p className="text-sm text-gray-500">No QR channels created yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {analyticsData.channelBreakdown.map((c) => (
                          <div key={c.channel_name} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                            <span className="text-gray-700">{c.channel_name}</span>
                            <span className="font-mono font-semibold text-gray-900">{c.scans} scans</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
