import { useEffect, useMemo, useState } from 'react';
import {
  Gift, Plus, Edit, Loader2, Loader, Users, Trophy, Radio,
  RotateCcw, Send, RefreshCw, ChevronRight, ExternalLink,
} from 'lucide-react';
import { supabase, useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { logActivity } from '../../lib/logActivity';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';

// Mobile counterpart of dashboard/pages/Giveaways.tsx (Campaign Engine Phase
// 1). Same data model and Supabase/RPC calls as the desktop page — reshaped
// into two Sheets (edit form, entries & draw) instead of centered modals so
// it fits the phone shell. See the desktop file for the domain notes this
// intentionally doesn't repeat.

type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';
type WinnerStatus = 'none' | 'selected' | 'contacted' | 'verified' | 'processing' | 'delivered' | 'forfeited';
type BroadcastAudience = 'opted_in_list' | 'campaign_non_winners' | 'campaign_entrants';

interface GiveawayCampaignRow {
  id: string;
  slug: string;
  internal_name: string;
  public_title: string;
  campaign_objective: string | null;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  secret_code: string | null;
  entry_limit: number | null;
  early_bird_limit: number | null;
  early_bird_voucher_id: string | null;
  grand_prize_voucher_id: string | null;
  grand_prize_description: string | null;
  grand_prize_product_url: string | null;
  consolation_voucher_id: string | null;
  hero_config: {
    headline?: string;
    subtitle?: string;
    ctaLabel?: string;
    heroImageDesktop?: string;
    heroImageMobile?: string;
    [key: string]: unknown;
  } | null;
  created_at: string;
}

interface VoucherOption {
  id: string;
  code: string;
  campaign_name: string;
  discount_type: 'percentage' | 'fixed' | 'free' | string;
  discount_value: number | null;
}

function formatRewardPhrase(voucher: VoucherOption | undefined): string {
  if (!voucher) return '';
  if (voucher.discount_type === 'percentage') return `${voucher.discount_value}% off your next order`;
  if (voucher.discount_type === 'fixed') return `₦${voucher.discount_value?.toLocaleString()} off your next order`;
  return 'a free reward';
}

interface EntryRow {
  id: string;
  full_name: string;
  whatsapp_number: string;
  email: string | null;
  location: string | null;
  status: 'valid' | 'duplicate' | 'invalid';
  entry_position: number | null;
  reward_tier: string | null;
  winner_status: WinnerStatus;
  created_at: string;
}

interface DrawRow {
  id: string;
  winning_entry_id: string;
  eligible_entry_count: number;
  drawn_at: string;
  status: 'completed' | 'forfeited';
  forfeit_reason: string | null;
  redraw_of: string | null;
}

interface WhatsAppTemplateOption {
  name: string;
  category: string;
  meta_template_status: string;
}

interface BroadcastRow {
  id: string;
  template_name: string;
  audience: BroadcastAudience;
  status: 'pending' | 'running' | 'completed' | 'failed';
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
}

interface ReviewRow {
  id: string;
  reviewer_name: string;
  rating: number;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

interface FormState {
  internal_name: string;
  public_title: string;
  slug: string;
  campaign_objective: string;
  status: CampaignStatus;
  start_date: string;
  end_date: string;
  hero_headline: string;
  hero_subtitle: string;
  hero_cta_label: string;
  hero_image_desktop: string;
  hero_image_mobile: string;
  secret_code: string;
  entry_limit: number | '';
  early_bird_limit: number | '';
  early_bird_voucher_id: string;
  grand_prize_voucher_id: string;
  grand_prize_description: string;
  grand_prize_product_url: string;
  consolation_voucher_id: string;
}

const emptyForm: FormState = {
  internal_name: '',
  public_title: '',
  slug: '',
  campaign_objective: '',
  status: 'draft',
  start_date: '',
  end_date: '',
  hero_headline: '',
  hero_subtitle: '',
  hero_cta_label: 'Enter Now',
  hero_image_desktop: '',
  hero_image_mobile: '',
  secret_code: '',
  entry_limit: '',
  early_bird_limit: '',
  early_bird_voucher_id: '',
  grand_prize_voucher_id: '',
  grand_prize_description: '',
  grand_prize_product_url: '',
  consolation_voucher_id: '',
};

const STATUS_CLS: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  expired: 'bg-red-100 text-red-700',
  archived: 'bg-gray-100 text-gray-500',
};

const WINNER_STEPS: WinnerStatus[] = ['selected', 'contacted', 'verified', 'processing', 'delivered'];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** See desktop Giveaways.tsx for why this can't be a bare `.slice(0, 16)`. */
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const localMs = d.getTime() - d.getTimezoneOffset() * 60000;
  return new Date(localMs).toISOString().slice(0, 16);
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm';

export default function MobileGiveaways() {
  const { user } = useAuth();
  const notification = useNotification();

  const [campaigns, setCampaigns] = useState<GiveawayCampaignRow[]>([]);
  const [entryCounts, setEntryCounts] = useState<Record<string, { valid: number; duplicate: number; invalid: number }>>({});
  const [vouchers, setVouchers] = useState<VoucherOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);
  const [originalHeroConfig, setOriginalHeroConfig] = useState<Record<string, unknown>>({});

  const [entriesCampaign, setEntriesCampaign] = useState<GiveawayCampaignRow | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [draws, setDraws] = useState<DrawRow[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const [whatsappTemplates, setWhatsappTemplates] = useState<WhatsAppTemplateOption[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [optInCount, setOptInCount] = useState<number | null>(null);
  const [broadcastTemplateName, setBroadcastTemplateName] = useState('');
  const [broadcastVariables, setBroadcastVariables] = useState('');
  const [broadcastAudience, setBroadcastAudience] = useState<BroadcastAudience>('opted_in_list');
  const [nonWinnerCount, setNonWinnerCount] = useState<number | null>(null);
  const [entrantsCount, setEntrantsCount] = useState<number | null>(null);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [redrawFormOpen, setRedrawFormOpen] = useState(false);
  const [redrawReason, setRedrawReason] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [reviewActioningId, setReviewActioningId] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('campaigns')
      .select(
        'id, slug, internal_name, public_title, campaign_objective, status, start_date, end_date, secret_code, entry_limit, early_bird_limit, early_bird_voucher_id, grand_prize_voucher_id, grand_prize_description, grand_prize_product_url, consolation_voucher_id, hero_config, created_at'
      )
      .eq('campaign_kind', 'giveaway')
      .order('created_at', { ascending: false });

    if (error) {
      notification.error('Failed to load giveaways', error.message);
      setLoading(false);
      return;
    }

    const rows = (data || []) as GiveawayCampaignRow[];
    setCampaigns(rows);

    if (rows.length > 0) {
      const { data: entryRows } = await supabase
        .from('giveaway_entries')
        .select('campaign_id, status')
        .in('campaign_id', rows.map((r) => r.id));

      const counts: Record<string, { valid: number; duplicate: number; invalid: number }> = {};
      for (const row of entryRows || []) {
        counts[row.campaign_id] ||= { valid: 0, duplicate: 0, invalid: 0 };
        counts[row.campaign_id][row.status as 'valid' | 'duplicate' | 'invalid'] += 1;
      }
      setEntryCounts(counts);
    }

    setLoading(false);
  };

  const loadVoucherOptions = async () => {
    const { data } = await supabase
      .from('campaign_vouchers')
      .select('id, code, campaign_name, discount_type, discount_value')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    setVouchers((data || []) as VoucherOption[]);
  };

  useEffect(() => {
    load();
    loadVoucherOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (entriesCampaign) refreshAudiencePreview(entriesCampaign, broadcastAudience);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesCampaign, broadcastAudience]);

  function openCreate() {
    setEditingId(null);
    setFormData(emptyForm);
    setOriginalHeroConfig({});
    setSlugTouched(false);
    setFormOpen(true);
  }

  function openEdit(campaign: GiveawayCampaignRow) {
    setEditingId(campaign.id);
    setSlugTouched(true);
    setOriginalHeroConfig(campaign.hero_config || {});
    setFormData({
      internal_name: campaign.internal_name,
      public_title: campaign.public_title,
      slug: campaign.slug,
      campaign_objective: campaign.campaign_objective || '',
      status: campaign.status,
      start_date: toDatetimeLocalValue(campaign.start_date),
      end_date: toDatetimeLocalValue(campaign.end_date),
      hero_headline: campaign.hero_config?.headline || '',
      hero_subtitle: campaign.hero_config?.subtitle || '',
      hero_cta_label: campaign.hero_config?.ctaLabel || 'Enter Now',
      hero_image_desktop: campaign.hero_config?.heroImageDesktop || '',
      hero_image_mobile: campaign.hero_config?.heroImageMobile || '',
      secret_code: campaign.secret_code || '',
      entry_limit: campaign.entry_limit ?? '',
      early_bird_limit: campaign.early_bird_limit ?? '',
      early_bird_voucher_id: campaign.early_bird_voucher_id || '',
      grand_prize_voucher_id: campaign.grand_prize_voucher_id || '',
      grand_prize_description: campaign.grand_prize_description || '',
      grand_prize_product_url: campaign.grand_prize_product_url || '',
      consolation_voucher_id: campaign.consolation_voucher_id || '',
    });
    setFormOpen(true);
  }

  async function handleSave() {
    if (!formData.internal_name.trim() || !formData.public_title.trim() || !formData.slug.trim()) {
      notification.error('Missing fields', 'Internal name, public title, and slug are required.');
      return;
    }
    if (!formData.secret_code.trim()) {
      notification.error('Missing secret code', 'A secret code is required for a giveaway campaign.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        internal_name: formData.internal_name.trim(),
        public_title: formData.public_title.trim(),
        slug: formData.slug.trim(),
        campaign_objective: formData.campaign_objective.trim() || null,
        status: formData.status,
        start_date: formData.start_date ? new Date(formData.start_date).toISOString() : null,
        end_date: formData.end_date ? new Date(formData.end_date).toISOString() : null,
        campaign_kind: 'giveaway' as const,
        target_type: 'general' as const,
        hero_config: {
          ...originalHeroConfig,
          headline: formData.hero_headline.trim(),
          subtitle: formData.hero_subtitle.trim(),
          ctaLabel: formData.hero_cta_label.trim() || 'Enter Now',
          heroImageDesktop: formData.hero_image_desktop.trim() || formData.hero_image_mobile.trim() || undefined,
          heroImageMobile: formData.hero_image_mobile.trim() || formData.hero_image_desktop.trim() || undefined,
        },
        product_selection_rules: {},
        review_rules: {},
        secret_code: formData.secret_code.trim(),
        entry_limit: formData.entry_limit === '' ? null : Number(formData.entry_limit),
        early_bird_limit: formData.early_bird_limit === '' ? null : Number(formData.early_bird_limit),
        early_bird_voucher_id: formData.early_bird_voucher_id || null,
        grand_prize_voucher_id: formData.grand_prize_voucher_id || null,
        grand_prize_description: formData.grand_prize_description.trim() || null,
        grand_prize_product_url: formData.grand_prize_product_url.trim() || null,
        consolation_voucher_id: formData.consolation_voucher_id || null,
      };

      if (editingId) {
        const { error } = await supabase.from('campaigns').update(payload).eq('id', editingId);
        if (error) throw error;
        await logActivity({ action: 'GIVEAWAY_UPDATE', resource_type: 'campaign', resource_id: editingId, details: { slug: payload.slug } });
        if (payload.status === 'active') notifySkola('campaign.launched', editingId);
        notification.success('Giveaway updated', payload.public_title);
      } else {
        const { data: created, error } = await supabase.from('campaigns').insert(payload).select('id').single();
        if (error) throw error;

        const sections = [
          { campaign_id: created.id, section_type: 'hero', order_index: 0, is_visible: true, config: {} },
          { campaign_id: created.id, section_type: 'giveaway_entry', order_index: 1, is_visible: true, config: {} },
          { campaign_id: created.id, section_type: 'cta_footer', order_index: 2, is_visible: true, config: {} },
        ];
        const { error: sectionError } = await supabase.from('campaign_sections').insert(sections);
        if (sectionError) throw sectionError;

        await logActivity({ action: 'GIVEAWAY_CREATE', resource_type: 'campaign', resource_id: created.id, details: { slug: payload.slug } });
        if (payload.status === 'active') notifySkola('campaign.launched', created.id);
        notification.success('Giveaway created', payload.public_title);
      }

      setFormOpen(false);
      await load();
    } catch (error: any) {
      notification.error('Failed to save giveaway', error?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function openEntries(campaign: GiveawayCampaignRow) {
    setEntriesCampaign(campaign);
    setEntriesLoading(true);
    setBroadcastTemplateName('');
    setBroadcastVariables('');
    setBroadcastAudience('opted_in_list');
    setNonWinnerCount(null);
    setEntrantsCount(null);
    setRedrawFormOpen(false);
    setRedrawReason('');

    const [
      { data: entryRows, error: entryError },
      { data: drawRows, error: drawError },
      { data: templateRows, error: templateError },
      { data: broadcastRows, error: broadcastError },
      { count: optInTotal, error: optInError },
      { data: reviewRows, error: reviewError },
    ] = await Promise.all([
      supabase
        .from('giveaway_entries')
        .select('id, full_name, whatsapp_number, email, location, status, entry_position, reward_tier, winner_status, created_at')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('giveaway_draws')
        .select('id, winning_entry_id, eligible_entry_count, drawn_at, status, forfeit_reason, redraw_of')
        .eq('campaign_id', campaign.id)
        .order('drawn_at', { ascending: false }),
      supabase
        .from('internal_whatsapp_templates')
        .select('name, category, meta_template_status')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('giveaway_broadcasts')
        .select('id, template_name, audience, status, recipient_count, sent_count, failed_count, started_at, completed_at')
        .eq('campaign_id', campaign.id)
        .order('started_at', { ascending: false }),
      supabase
        .from('whatsapp_marketing_consent')
        .select('id', { count: 'exact', head: true })
        .eq('opted_in', true),
      supabase
        .from('campaign_reviews')
        .select('id, reviewer_name, rating, body, status, created_at')
        .eq('campaign_id', campaign.id)
        .order('created_at', { ascending: false }),
    ]);

    if (entryError) notification.error('Failed to load entries', entryError.message);
    if (drawError) notification.error('Failed to load draw history', drawError.message);
    if (templateError) notification.error('Failed to load WhatsApp templates', templateError.message);
    if (broadcastError) notification.error('Failed to load broadcast history', broadcastError.message);
    if (optInError) notification.error('Failed to load opt-in count', optInError.message);
    if (reviewError) notification.error('Failed to load reviews', reviewError.message);

    setEntries((entryRows || []) as EntryRow[]);
    setDraws((drawRows || []) as DrawRow[]);
    setWhatsappTemplates((templateRows || []) as WhatsAppTemplateOption[]);
    setBroadcasts((broadcastRows || []) as BroadcastRow[]);
    setOptInCount(optInTotal ?? 0);
    setReviews((reviewRows || []) as ReviewRow[]);
    setEntriesLoading(false);
  }

  async function setReviewStatus(reviewId: string, status: 'approved' | 'rejected') {
    setReviewActioningId(reviewId);
    try {
      const { error } = await supabase.from('campaign_reviews').update({ status, updated_at: new Date().toISOString() }).eq('id', reviewId);
      if (error) throw error;
      setReviews((prev) => prev.map((r) => (r.id === reviewId ? { ...r, status } : r)));
      await logActivity({ action: 'GIVEAWAY_REVIEW_MODERATE', resource_type: 'campaign_review', resource_id: reviewId, details: { status } });
    } catch (error: any) {
      notification.error('Failed to update review', error?.message || 'Unknown error');
    } finally {
      setReviewActioningId(null);
    }
  }

  async function callAdminFunction(name: string, payload: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not signed in');
    const res = await fetch(`/.netlify/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || `Request failed (${res.status})`);
    return data.data;
  }

  function notifySkola(eventType: 'campaign.launched' | 'giveaway.winner_drawn' | 'giveaway.winner_redrawn', campaignId: string) {
    callAdminFunction('notify-skola-giveaway-event', { event_type: eventType, campaign_id: campaignId }).catch((error) => {
      console.warn('Skola notification failed (non-blocking):', error);
    });
  }

  async function handleSyncTemplates() {
    setSyncingTemplates(true);
    try {
      const result = await callAdminFunction('admin-sync-whatsapp-templates', {});
      const seededNote = result.seeded ? `, ${result.seeded} new template(s) added` : '';
      notification.success('Templates synced', `${result.updated} of ${result.checked} updated from Meta${seededNote}.`);
      const { data: templateRows, error } = await supabase
        .from('internal_whatsapp_templates')
        .select('name, category, meta_template_status')
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      setWhatsappTemplates((templateRows || []) as WhatsAppTemplateOption[]);
    } catch (error: any) {
      notification.error('Sync failed', error?.message || 'Unknown error');
    } finally {
      setSyncingTemplates(false);
    }
  }

  function computeDefaultVariables(templateName: string): string {
    if (!entriesCampaign) return '';
    if (templateName === 'giveaway_code_drop') {
      const url = `https://julinemart.com/campaigns/${entriesCampaign.slug}`;
      return `there, ${entriesCampaign.secret_code || ''}, ${url}`;
    }
    if (templateName === 'giveaway_consolation') {
      const voucher = vouchers.find((v) => v.id === entriesCampaign.consolation_voucher_id);
      if (!voucher) return '';
      return `there, ${formatRewardPhrase(voucher)}, ${voucher.code}`;
    }
    return '';
  }

  async function refreshAudiencePreview(campaign: GiveawayCampaignRow, audience: BroadcastAudience) {
    if (audience === 'opted_in_list') return;
    try {
      const result = await callAdminFunction('admin-giveaway-broadcast', {
        campaign_id: campaign.id,
        audience,
        preview_only: true,
      });
      if (audience === 'campaign_non_winners') setNonWinnerCount(result.recipientCount);
      else setEntrantsCount(result.recipientCount);
    } catch {
      if (audience === 'campaign_non_winners') setNonWinnerCount(null);
      else setEntrantsCount(null);
    }
  }

  async function handleSendBroadcast() {
    if (!entriesCampaign) return;
    if (!broadcastTemplateName) {
      notification.error('Choose a template', 'Pick the approved WhatsApp template to send.');
      return;
    }
    const targetCount =
      broadcastAudience === 'campaign_non_winners' ? nonWinnerCount
      : broadcastAudience === 'campaign_entrants' ? entrantsCount
      : optInCount;
    if (!targetCount) {
      notification.error('No recipients', 'There is nobody to send this to right now.');
      return;
    }
    const audienceLabel =
      broadcastAudience === 'campaign_non_winners' ? "this campaign's non-winning entrants"
      : broadcastAudience === 'campaign_entrants' ? "this campaign's entrants (each gets their own review link)"
      : 'the opted-in contact list';
    if (!window.confirm(`Send "${broadcastTemplateName}" to ${targetCount} recipient(s) in ${audienceLabel} now? This cannot be undone.`)) {
      return;
    }

    setBroadcasting(true);
    try {
      const variables = broadcastVariables
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const result = await callAdminFunction('admin-giveaway-broadcast', {
        campaign_id: entriesCampaign.id,
        template_name: broadcastTemplateName,
        audience: broadcastAudience,
        variables,
      });
      notification.success(
        'Broadcast sent',
        `${result.sentCount}/${result.recipientCount} delivered, ${result.failedCount} failed.`
      );
      await openEntries(entriesCampaign);
    } catch (error: any) {
      notification.error('Broadcast failed', error?.message || 'Unknown error');
    } finally {
      setBroadcasting(false);
    }
  }

  const eligibleCount = useMemo(
    () => entries.filter((e) => e.status === 'valid' && e.winner_status === 'none').length,
    [entries]
  );
  const hasCompletedDraw = draws.some((d) => d.status === 'completed');
  const currentWinner = hasCompletedDraw
    ? entries.find((e) => e.id === draws.find((d) => d.status === 'completed')?.winning_entry_id)
    : null;

  async function handleDraw() {
    if (!entriesCampaign) return;
    setDrawing(true);
    try {
      const { error } = await supabase.rpc('draw_giveaway_winner', { p_campaign_id: entriesCampaign.id });
      if (error) throw error;
      await logActivity({ action: 'GIVEAWAY_DRAW', resource_type: 'campaign', resource_id: entriesCampaign.id });
      notifySkola('giveaway.winner_drawn', entriesCampaign.id);
      notification.success('Winner drawn', 'The draw is recorded — see the draw history below.');
      await openEntries(entriesCampaign);
    } catch (error: any) {
      notification.error('Draw failed', error?.message || 'Unknown error');
    } finally {
      setDrawing(false);
    }
  }

  async function submitForfeitAndRedraw() {
    if (!entriesCampaign) return;
    if (!redrawReason.trim()) {
      notification.error('Reason required', 'Explain why the current winner is being forfeited.');
      return;
    }
    const reason = redrawReason.trim();

    setDrawing(true);
    try {
      const { error } = await supabase.rpc('forfeit_and_redraw_giveaway_winner', {
        p_campaign_id: entriesCampaign.id,
        p_reason: reason,
      });
      if (error) throw error;
      await logActivity({ action: 'GIVEAWAY_REDRAW', resource_type: 'campaign', resource_id: entriesCampaign.id, details: { reason } });
      notifySkola('giveaway.winner_redrawn', entriesCampaign.id);
      notification.success('Redrawn', 'A new winner has been selected; the prior draw is kept on record as forfeited.');
      setRedrawFormOpen(false);
      setRedrawReason('');
      await openEntries(entriesCampaign);
    } catch (error: any) {
      notification.error('Redraw failed', error?.message || 'Unknown error');
    } finally {
      setDrawing(false);
    }
  }

  async function advanceWinnerStatus(entry: EntryRow) {
    const currentIndex = WINNER_STEPS.indexOf(entry.winner_status as (typeof WINNER_STEPS)[number]);
    const next = WINNER_STEPS[currentIndex + 1];
    if (!next) return;

    const { error } = await supabase.from('giveaway_entries').update({ winner_status: next }).eq('id', entry.id);
    if (error) {
      notification.error('Failed to update winner status', error.message);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, winner_status: next } : e)));
    await logActivity({ action: 'GIVEAWAY_WINNER_STATUS', resource_type: 'giveaway_entry', resource_id: entry.id, details: { winner_status: next } });
  }

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-gray-600">
        You don't have permission to view giveaway entries and draw results.
      </div>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Giveaways</h1>
              <p className="text-xs text-gray-500">Secret-code drops & draws</p>
            </div>
            <button type="button" onClick={openCreate} className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-xl bg-white py-10 text-center text-sm text-gray-500 ring-1 ring-gray-100">
              No giveaway campaigns yet. Tap "New" to set up a secret-code drop.
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((campaign) => {
                const counts = entryCounts[campaign.id] || { valid: 0, duplicate: 0, invalid: 0 };
                return (
                  <div key={campaign.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                    <button type="button" onClick={() => void openEntries(campaign)} className="flex w-full items-start gap-3 text-left">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                        <Gift className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">{campaign.public_title}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[campaign.status]}`}>{campaign.status}</span>
                          <span className="text-[10px] text-gray-400">code {campaign.secret_code || '—'}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">
                          {counts.valid} valid · {counts.duplicate} duplicate · {counts.invalid} invalid
                        </p>
                      </div>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(campaign)}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-700"
                    >
                      <Edit className="h-3.5 w-3.5" /> Edit giveaway
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PullToRefresh>

      {/* Create / edit form */}
      <Sheet open={formOpen} onClose={() => setFormOpen(false)} ariaLabel="Giveaway form">
        <h3 className="text-base font-bold">{editingId ? 'Edit giveaway' : 'New giveaway'}</h3>
        <div className="space-y-3">
          <input
            value={formData.public_title}
            onChange={(e) => {
              const value = e.target.value;
              setFormData((prev) => ({ ...prev, public_title: value, slug: slugTouched ? prev.slug : slugify(value) }));
            }}
            placeholder="Public title * (e.g. Mirror Glow Secret Drop)"
            className={inputCls}
            style={{ fontSize: '16px' }}
          />
          <input
            value={formData.internal_name}
            onChange={(e) => setFormData((prev) => ({ ...prev, internal_name: e.target.value }))}
            placeholder="Internal name *"
            className={inputCls}
            style={{ fontSize: '16px' }}
          />
          <input
            value={formData.slug}
            onChange={(e) => { setSlugTouched(true); setFormData((prev) => ({ ...prev, slug: slugify(e.target.value) })); }}
            placeholder="Slug (julinemart.com/campaigns/…) *"
            className={`${inputCls} font-mono`}
            style={{ fontSize: '16px' }}
          />
          <select
            value={formData.status}
            onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value as CampaignStatus }))}
            className={inputCls}
            style={{ fontSize: '16px' }}
          >
            {(['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'] as CampaignStatus[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            value={formData.secret_code}
            onChange={(e) => setFormData((prev) => ({ ...prev, secret_code: e.target.value }))}
            placeholder="Secret code * (e.g. MIRRORGLOW)"
            className={`${inputCls} uppercase`}
            style={{ fontSize: '16px' }}
          />

          <div>
            <label className="mb-1 block text-xs text-gray-500">Start date</label>
            <input type="datetime-local" value={formData.start_date} onChange={(e) => setFormData((prev) => ({ ...prev, start_date: e.target.value }))} className={inputCls} style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">End date (entries close)</label>
            <input type="datetime-local" value={formData.end_date} onChange={(e) => setFormData((prev) => ({ ...prev, end_date: e.target.value }))} className={inputCls} style={{ fontSize: '16px' }} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="number" min={1} value={formData.entry_limit}
              onChange={(e) => setFormData((prev) => ({ ...prev, entry_limit: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="Entry limit" className={inputCls} style={{ fontSize: '16px' }}
            />
            <input
              type="number" min={1} value={formData.early_bird_limit}
              onChange={(e) => setFormData((prev) => ({ ...prev, early_bird_limit: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="Early-bird limit" className={inputCls} style={{ fontSize: '16px' }}
            />
          </div>
          <p className="-mt-2 text-[11px] text-gray-400">Entry limit blank = unlimited. Early-bird = first N entrants.</p>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Early-bird reward voucher</label>
            <select value={formData.early_bird_voucher_id} onChange={(e) => setFormData((prev) => ({ ...prev, early_bird_voucher_id: e.target.value }))} className={inputCls} style={{ fontSize: '16px' }}>
              <option value="">— none —</option>
              {vouchers.map((v) => <option key={v.id} value={v.id}>{v.code} ({v.campaign_name})</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Grand prize voucher (optional)</label>
            <select value={formData.grand_prize_voucher_id} onChange={(e) => setFormData((prev) => ({ ...prev, grand_prize_voucher_id: e.target.value }))} className={inputCls} style={{ fontSize: '16px' }}>
              <option value="">— none —</option>
              {vouchers.map((v) => <option key={v.id} value={v.id}>{v.code} ({v.campaign_name})</option>)}
            </select>
          </div>
          <input
            value={formData.grand_prize_description}
            onChange={(e) => setFormData((prev) => ({ ...prev, grand_prize_description: e.target.value }))}
            placeholder="Grand prize description (e.g. LED Makeup Mirror)"
            className={inputCls} style={{ fontSize: '16px' }}
          />
          <div>
            <input
              type="url" value={formData.grand_prize_product_url}
              onChange={(e) => setFormData((prev) => ({ ...prev, grand_prize_product_url: e.target.value }))}
              placeholder="Grand prize product link" className={inputCls} style={{ fontSize: '16px' }}
            />
            <p className="mt-1 text-[11px] text-gray-400">Sent to the winner in their prize email.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Consolation voucher for non-winners (optional)</label>
            <select value={formData.consolation_voucher_id} onChange={(e) => setFormData((prev) => ({ ...prev, consolation_voucher_id: e.target.value }))} className={inputCls} style={{ fontSize: '16px' }}>
              <option value="">— none —</option>
              {vouchers.map((v) => <option key={v.id} value={v.id}>{v.code} ({v.campaign_name})</option>)}
            </select>
          </div>

          <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Landing page hero</p>
          <input
            value={formData.hero_headline}
            onChange={(e) => setFormData((prev) => ({ ...prev, hero_headline: e.target.value }))}
            placeholder="Hero headline (e.g. Win an LED Makeup Mirror)"
            className={inputCls} style={{ fontSize: '16px' }}
          />
          <input
            value={formData.hero_subtitle}
            onChange={(e) => setFormData((prev) => ({ ...prev, hero_subtitle: e.target.value }))}
            placeholder="Hero subtitle"
            className={inputCls} style={{ fontSize: '16px' }}
          />
          <input
            type="url" value={formData.hero_image_desktop}
            onChange={(e) => setFormData((prev) => ({ ...prev, hero_image_desktop: e.target.value }))}
            placeholder="Hero image URL (desktop)" className={`${inputCls} font-mono`} style={{ fontSize: '16px' }}
          />
          <input
            type="url" value={formData.hero_image_mobile}
            onChange={(e) => setFormData((prev) => ({ ...prev, hero_image_mobile: e.target.value }))}
            placeholder="Hero image URL (mobile, optional)" className={`${inputCls} font-mono`} style={{ fontSize: '16px' }}
          />
        </div>
        <button type="button" disabled={saving} onClick={() => void handleSave()} className="mt-1 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : 'Save giveaway'}
        </button>
      </Sheet>

      {/* Entries & draw */}
      <Sheet open={!!entriesCampaign} onClose={() => setEntriesCampaign(null)} ariaLabel="Giveaway entries and draw">
        {entriesCampaign && (
          <>
            <h3 className="text-base font-bold">{entriesCampaign.public_title}</h3>
            <p className="text-xs text-gray-500">Entries & draw</p>

            {entriesLoading ? (
              <div className="flex justify-center py-10">
                <Loader className="h-6 w-6 animate-spin text-primary-600" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-gray-50 p-3 text-center">
                    <p className="text-base font-semibold text-gray-900">{entries.length}</p>
                    <p className="text-[10px] text-gray-500">Total submissions</p>
                  </div>
                  <div className="rounded-lg bg-green-50 p-3 text-center">
                    <p className="text-base font-semibold text-green-700">{entries.filter((e) => e.status === 'valid').length}</p>
                    <p className="text-[10px] text-gray-500">Valid</p>
                  </div>
                  <div className="rounded-lg bg-yellow-50 p-3 text-center">
                    <p className="text-base font-semibold text-yellow-700">{entries.filter((e) => e.status === 'duplicate').length}</p>
                    <p className="text-[10px] text-gray-500">Duplicate</p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-3 text-center">
                    <p className="text-base font-semibold text-red-700">{entries.filter((e) => e.status === 'invalid').length}</p>
                    <p className="text-[10px] text-gray-500">Invalid</p>
                  </div>
                </div>

                <div className="rounded-lg bg-purple-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-purple-900">
                    <Trophy className="h-4 w-4" /> Draw
                  </div>
                  <p className="mt-1 text-xs text-purple-700">
                    {hasCompletedDraw
                      ? currentWinner
                        ? `Winner: ${currentWinner.full_name} (entry #${currentWinner.entry_position})`
                        : 'Winner drawn (details loading)'
                      : `${eligibleCount} eligible entr${eligibleCount === 1 ? 'y' : 'ies'} to draw from`}
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    <a
                      href={`/draw-live/${entriesCampaign.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-purple-300 py-2 text-xs font-semibold text-purple-700"
                    >
                      <Radio className="h-3.5 w-3.5" /> Open Draw Live page
                    </a>
                    {!hasCompletedDraw ? (
                      <button
                        type="button"
                        onClick={() => void handleDraw()}
                        disabled={drawing || eligibleCount === 0}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {drawing && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Draw winner
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRedrawFormOpen((v) => !v)}
                        disabled={drawing}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-purple-300 py-2 text-xs font-semibold text-purple-700 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Forfeit & redraw
                      </button>
                    )}
                  </div>

                  {redrawFormOpen && (
                    <div className="mt-2 space-y-2 rounded-lg border border-purple-200 bg-white p-2.5">
                      <textarea
                        value={redrawReason}
                        onChange={(e) => setRedrawReason(e.target.value)}
                        placeholder="Reason (required) — e.g. Winner unreachable after 48 hours"
                        rows={2}
                        className={inputCls}
                        style={{ fontSize: '16px' }}
                      />
                      <button
                        type="button"
                        onClick={() => void submitForfeitAndRedraw()}
                        disabled={drawing || !redrawReason.trim()}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-purple-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {drawing && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Confirm redraw
                      </button>
                    </div>
                  )}
                </div>

                {draws.length > 0 && (
                  <div className="space-y-1 text-[11px] text-gray-500">
                    <p className="font-medium text-gray-700">Draw history</p>
                    {draws.map((d) => {
                      const winnerEntry = entries.find((e) => e.id === d.winning_entry_id);
                      return (
                        <div key={d.id}>
                          {new Date(d.drawn_at).toLocaleString()} — {d.status}
                          {d.status === 'forfeited' && d.forfeit_reason ? ` (${d.forfeit_reason})` : ''}
                          {' '}· {d.eligible_entry_count} eligible
                          {winnerEntry ? ` · ${winnerEntry.full_name} (#${winnerEntry.entry_position})` : ''}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2.5 rounded-lg bg-green-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-green-900">
                      <Send className="h-4 w-4" /> WhatsApp broadcast
                    </div>
                    <span className="text-xs text-green-700">
                      {(broadcastAudience === 'campaign_non_winners' ? nonWinnerCount : broadcastAudience === 'campaign_entrants' ? entrantsCount : optInCount) ?? '—'} recipient(s)
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    Requires a WhatsApp template already approved by Meta as Marketing category.
                  </p>
                  <select
                    value={broadcastAudience}
                    onChange={(e) => setBroadcastAudience(e.target.value as BroadcastAudience)}
                    className={inputCls} style={{ fontSize: '16px' }}
                  >
                    <option value="opted_in_list">All opted-in contacts</option>
                    <option value="campaign_non_winners">Non-winning entrants</option>
                    <option value="campaign_entrants">Entrants — feedback request</option>
                  </select>
                  {broadcastAudience === 'campaign_non_winners' && entriesCampaign.consolation_voucher_id && (
                    <p className="text-[11px] text-gray-500">
                      Consolation voucher: <strong>{vouchers.find((v) => v.id === entriesCampaign.consolation_voucher_id)?.code || entriesCampaign.consolation_voucher_id}</strong>
                    </p>
                  )}
                  {broadcastAudience === 'campaign_non_winners' && !entriesCampaign.consolation_voucher_id && (
                    <p className="text-[11px] text-amber-600">
                      No consolation voucher linked — edit the giveaway to add one.
                    </p>
                  )}

                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-600">Template</label>
                    <button type="button" onClick={() => void handleSyncTemplates()} disabled={syncingTemplates} className="flex items-center gap-1 text-xs text-green-700 disabled:opacity-50">
                      <RefreshCw className={`h-3 w-3 ${syncingTemplates ? 'animate-spin' : ''}`} /> Sync
                    </button>
                  </div>
                  <select
                    value={broadcastTemplateName}
                    onChange={(e) => {
                      const nextTemplate = e.target.value;
                      setBroadcastTemplateName(nextTemplate);
                      if (!broadcastVariables.trim()) setBroadcastVariables(computeDefaultVariables(nextTemplate));
                    }}
                    className={inputCls} style={{ fontSize: '16px' }}
                  >
                    <option value="">— choose a template —</option>
                    {whatsappTemplates.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.meta_template_status})</option>)}
                  </select>

                  {broadcastAudience === 'campaign_entrants' ? (
                    <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      Variables built automatically per recipient — name, campaign title, their own review link.
                    </p>
                  ) : (
                    <input
                      value={broadcastVariables}
                      onChange={(e) => setBroadcastVariables(e.target.value)}
                      placeholder="Template variables (comma-separated, in order)"
                      className={inputCls} style={{ fontSize: '16px' }}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => void handleSendBroadcast()}
                    disabled={broadcasting || !broadcastTemplateName}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {broadcasting && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send now
                  </button>

                  {broadcasts.length > 0 && (
                    <div className="space-y-1 border-t border-green-100 pt-2 text-[11px] text-gray-500">
                      <p className="font-medium text-gray-700">Broadcast history</p>
                      {broadcasts.map((b) => (
                        <div key={b.id}>
                          {new Date(b.started_at).toLocaleString()} — {b.template_name} — {b.status}
                          {' '}· {b.audience === 'campaign_non_winners' ? 'non-winners' : b.audience === 'campaign_entrants' ? 'entrants' : 'opt-in'}
                          {' '}· {b.sent_count}/{b.recipient_count} sent, {b.failed_count} failed
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 rounded-lg bg-amber-50 p-3">
                  <p className="text-sm font-medium text-amber-900">
                    Feedback ({reviews.filter((r) => r.status === 'pending').length} pending)
                  </p>
                  {reviews.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No reviews yet. Send an "entrants" broadcast above with a feedback-request template to invite them.
                    </p>
                  ) : (
                    reviews.map((r) => (
                      <div key={r.id} className="rounded-lg border border-amber-100 bg-white p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-gray-900">
                            {r.reviewer_name} <span className="text-amber-600">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                            r.status === 'approved' ? 'bg-green-100 text-green-800' : r.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {r.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">{r.body}</p>
                        {r.status === 'pending' && (
                          <div className="mt-2 flex gap-2">
                            <button type="button" onClick={() => void setReviewStatus(r.id, 'approved')} disabled={reviewActioningId === r.id} className="flex-1 rounded-lg bg-green-600 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                              Approve
                            </button>
                            <button type="button" onClick={() => void setReviewStatus(r.id, 'rejected')} disabled={reviewActioningId === r.id} className="flex-1 rounded-lg border border-gray-300 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    <Users className="h-3.5 w-3.5" /> Entries ({entries.length})
                  </p>
                  {entries.map((entry) => (
                    <div key={entry.id} className="rounded-lg bg-gray-50 p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-gray-900">
                          #{entry.entry_position ?? '—'} {entry.full_name}
                        </p>
                        <span className="capitalize text-gray-500">{entry.status}</span>
                      </div>
                      <p className="mt-0.5 text-gray-500">{entry.whatsapp_number}{entry.location ? ` · ${entry.location}` : ''}</p>
                      {entry.winner_status !== 'none' && (
                        <p className="mt-1">
                          {entry.winner_status === 'forfeited' ? (
                            <span className="text-red-600">forfeited</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void advanceWinnerStatus(entry)}
                              disabled={entry.winner_status === 'delivered'}
                              className="capitalize text-purple-700 disabled:text-gray-500"
                            >
                              {entry.winner_status}{entry.winner_status !== 'delivered' ? ' — tap to advance' : ''}
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <a
                  href={`https://julinemart.com/campaigns/${entriesCampaign.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 py-2.5 text-xs font-semibold text-primary-600"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Open giveaway page
                </a>
              </>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
