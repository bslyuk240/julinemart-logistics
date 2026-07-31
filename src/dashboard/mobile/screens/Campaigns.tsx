import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Loader, Megaphone, Plus, Trash2 } from 'lucide-react';
import { supabase, useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { STOREFRONT_CAMPAIGN_BASE } from '../lib/marketingApi';
import {
  CampaignWizardForm,
  MediaGalleryItem,
  SectionType,
  emptySections,
  hasNewCampaignDraft,
} from '../lib/campaignWizardDraft';
import { CampaignWizard } from './CampaignWizard';

type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';
type TargetType = 'vendor' | 'category' | 'product' | 'collection' | 'multi_vendor' | 'general';

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
  hero_config: Record<string, string> | null;
  vendor_override: Record<string, unknown> | null;
  product_selection_rules: Record<string, unknown> | null;
  review_rules: Record<string, unknown> | null;
  offer_config: Record<string, unknown> | null;
}

interface SectionRow {
  section_type: SectionType;
  order_index: number;
  is_visible: boolean;
  config?: { items?: Partial<MediaGalleryItem>[] } | null;
}

const STATUS_CLS: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-700',
  archived: 'bg-gray-100 text-gray-500',
};

function rowToWizardForm(campaign: CampaignRow, mediaItems: MediaGalleryItem[]): CampaignWizardForm {
  const hero = campaign.hero_config || {};
  const vendor = (campaign.vendor_override || {}) as Record<string, unknown>;
  const rules = (campaign.product_selection_rules || {}) as Record<string, unknown>;
  const reviews = (campaign.review_rules || {}) as Record<string, unknown>;
  const offer = (campaign.offer_config || {}) as Record<string, unknown>;

  return {
    internal_name: campaign.internal_name,
    public_title: campaign.public_title,
    slug: campaign.slug,
    campaign_objective: campaign.campaign_objective || '',
    status: campaign.status,
    start_date: campaign.start_date ? campaign.start_date.slice(0, 16) : '',
    end_date: campaign.end_date ? campaign.end_date.slice(0, 16) : '',
    target_type: campaign.target_type,
    target_id: campaign.target_id || '',

    hero_headline: (hero.headline as string) || '',
    hero_subtitle: (hero.subtitle as string) || '',
    hero_cta_label: (hero.ctaLabel as string) || 'Shop Now',
    hero_badge_text: (hero.badgeText as string) || '',
    hero_image_desktop: (hero.heroImageDesktop as string) || '',
    hero_image_mobile: (hero.heroImageMobile as string) || '',
    hero_intro_video: (hero.introductoryVideoUrl as string) || '',

    vendor_name: (vendor.name as string) || '',
    vendor_logo: (vendor.logoUrl as string) || '',
    vendor_story: (vendor.story as string) || '',
    vendor_location: (vendor.location as string) || '',
    vendor_years_operating: vendor.yearsOperating != null ? Number(vendor.yearsOperating) : '',
    vendor_store_link: (vendor.storeLinkUrl as string) || '',
    vendor_shop_image: (vendor.shopImageUrl as string) || '',
    vendor_intro_video: (vendor.introVideoUrl as string) || '',

    product_source: (rules.source as CampaignWizardForm['product_source']) || 'automatic',
    product_category_id: Array.isArray(rules.categoryIds) && rules.categoryIds[0] ? String(rules.categoryIds[0]) : '',
    product_manual_ids: Array.isArray(rules.manualProductIds) ? (rules.manualProductIds as string[]).join(', ') : '',
    product_min_rating: rules.minimumRating != null ? Number(rules.minimumRating) : '',
    product_in_stock_only: rules.inStockOnly !== false,
    product_discounted_only: Boolean(rules.discountedOnly),
    product_max_products: Number(rules.maxProducts) || 12,

    review_scope: (reviews.scope as CampaignWizardForm['review_scope']) || 'mixed',
    review_min_rating: reviews.minimumRating != null ? Number(reviews.minimumRating) : 4,
    review_max_reviews: Number(reviews.maxReviews) || 5,
    review_verified_only: reviews.verifiedPurchaseOnly !== false,

    offer_voucher_id: (offer.voucherId as string) || '',

    media_gallery_items: mediaItems,
  };
}

export default function MobileCampaigns() {
  const { user } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [seedForm, setSeedForm] = useState<CampaignWizardForm | null>(null);
  const [seedSections, setSeedSections] = useState(emptySections());
  const [selected, setSelected] = useState<CampaignRow | null>(null);
  const [filter, setFilter] = useState('');
  const [draftPending, setDraftPending] = useState(hasNewCampaignDraft);
  const isAdmin = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'social_media_manager';

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('campaigns').select('*').order('created_at', { ascending: false });
    if (error) notification.error('Load failed', error.message);
    else setRows((data as CampaignRow[]) || []);
    setDraftPending(hasNewCampaignDraft());
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter((c) => c.internal_name.toLowerCase().includes(q) || c.public_title.toLowerCase().includes(q) || c.slug.includes(q));
  }, [rows, filter]);

  const campaignUrl = (slug: string) => `${STOREFRONT_CAMPAIGN_BASE}/${slug}`;

  const openDetail = (c: CampaignRow) => {
    setSelected(c);
    setDetailOpen(true);
  };

  const openCreate = () => {
    setEditingId(null);
    setSeedForm(null);
    setSeedSections(emptySections());
    setWizardOpen(true);
  };

  const openEdit = async (c: CampaignRow) => {
    const { data: sectionRows } = await supabase
      .from('campaign_sections')
      .select('section_type, order_index, is_visible, config')
      .eq('campaign_id', c.id);

    const nextSections = emptySections();
    (sectionRows as SectionRow[] | null)?.forEach((s) => {
      if (nextSections[s.section_type]) {
        nextSections[s.section_type] = { visible: s.is_visible, order: s.order_index };
      }
    });

    const mediaGallerySection = (sectionRows as SectionRow[] | null)?.find((s) => s.section_type === 'media_gallery');
    const rawMediaItems = Array.isArray(mediaGallerySection?.config?.items) ? mediaGallerySection!.config!.items! : [];
    const mediaItems: MediaGalleryItem[] = rawMediaItems.map((item) => ({
      type: item.type ?? 'image',
      url: item.url ?? '',
      caption: item.caption ?? '',
      thumbnailUrl: item.thumbnailUrl ?? '',
    }));

    setEditingId(c.id);
    setSeedForm(rowToWizardForm(c, mediaItems));
    setSeedSections(nextSections);
    setWizardOpen(true);
  };

  const handleWizardSaved = () => {
    setWizardOpen(false);
    setDetailOpen(false);
    setEditingId(null);
    setSeedForm(null);
    setDraftPending(hasNewCampaignDraft());
    load();
  };

  const setStatus = async (id: string, status: CampaignStatus) => {
    const { error } = await supabase.from('campaigns').update({ status }).eq('id', id);
    if (error) notification.error('Update failed', error.message);
    else {
      load();
      setDetailOpen(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this campaign?')) return;
    const { error } = await supabase.from('campaigns').delete().eq('id', id);
    if (error) notification.error('Delete failed', error.message);
    else {
      setDetailOpen(false);
      load();
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Campaigns</h1>
              <p className="text-xs text-gray-500">Landing pages & tracking</p>
            </div>
            {isAdmin && (
              <button type="button" onClick={openCreate} className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            )}
          </div>

          {draftPending && isAdmin && (
            <button
              type="button"
              onClick={openCreate}
              className="flex w-full items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3 text-left"
            >
              <div>
                <p className="text-sm font-semibold text-indigo-900">Continue draft</p>
                <p className="text-xs text-indigo-700">Pick up where you left off</p>
              </div>
              <Megaphone className="h-5 w-5 text-indigo-500" />
            </button>
          )}

          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search campaigns…"
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-gray-100"
            style={{ fontSize: '16px' }}
          />

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openDetail(c)}
                  className="flex w-full gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-gray-100"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
                    <Megaphone className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{c.public_title}</p>
                    <p className="truncate text-xs text-gray-500">{c.internal_name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[c.status]}`}>{c.status}</span>
                      <span className="text-[10px] text-gray-400">/{c.slug}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <CampaignWizard
        open={wizardOpen}
        editingId={editingId}
        seedForm={seedForm}
        seedSections={seedSections}
        onClose={() => setWizardOpen(false)}
        onSaved={handleWizardSaved}
      />

      <Sheet open={detailOpen} onClose={() => setDetailOpen(false)} ariaLabel="Campaign details">
        {selected && (
          <>
            <h3 className="text-base font-bold">{selected.public_title}</h3>
            <p className="text-xs text-gray-500">{selected.internal_name}</p>
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[selected.status]}`}>{selected.status}</span>
            <div className="flex gap-2">
              <a href={campaignUrl(selected.slug)} target="_blank" rel="noreferrer" className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-primary-600">
                <ExternalLink className="h-3.5 w-3.5" /> Open page
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(campaignUrl(selected.slug));
                  notification.success('Copied', 'Campaign URL copied');
                }}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-semibold"
              >
                <Copy className="h-3.5 w-3.5" /> Copy URL
              </button>
            </div>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDetailOpen(false);
                    void openEdit(selected);
                  }}
                  className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-semibold"
                >
                  Edit campaign
                </button>
                <div className="flex flex-wrap gap-2">
                  {selected.status !== 'active' && (
                    <button type="button" onClick={() => void setStatus(selected.id, 'active')} className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white">
                      Activate
                    </button>
                  )}
                  {selected.status === 'active' && (
                    <button type="button" onClick={() => void setStatus(selected.id, 'paused')} className="rounded-lg bg-yellow-500 px-3 py-2 text-xs font-semibold text-white">
                      Pause
                    </button>
                  )}
                  <button type="button" onClick={() => void setStatus(selected.id, 'archived')} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold">
                    Archive
                  </button>
                  <button type="button" onClick={() => void remove(selected.id)} className="ml-auto text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-400">QR codes & analytics available on desktop.</p>
              </>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
