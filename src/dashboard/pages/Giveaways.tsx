import { useEffect, useMemo, useState } from 'react';
import {
  Gift, Plus, Edit, Loader2, Users, Trophy, X, CheckCircle,
  Clock, PauseCircle, Archive as ArchiveIcon, FileEdit, RotateCcw, Send, RefreshCw,
} from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { logActivity } from '../lib/logActivity';

// Giveaway / Secret-Code Drop engine (Campaign Engine Phase 1). Deliberately a
// separate, lighter page rather than folding into Campaigns.tsx's 1900-line
// merchandising builder — a giveaway campaign needs a much smaller field set
// (no product/review rules, no vendor story) plus two things merchandising
// campaigns don't have at all: an entries table and a winner draw. Writes
// directly to Supabase from the browser (RLS-gated to role='admin'), matching
// this repo's established convention for Campaigns/Vouchers rather than
// routing admin actions through a Netlify function.

type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired' | 'archived';
type WinnerStatus = 'none' | 'selected' | 'contacted' | 'verified' | 'processing' | 'delivered' | 'forfeited';

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
  consolation_voucher_id: string | null;
  hero_config: { headline?: string; subtitle?: string; ctaLabel?: string } | null;
  created_at: string;
}

interface VoucherOption {
  id: string;
  code: string;
  campaign_name: string;
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
  audience: 'opted_in_list' | 'campaign_non_winners';
  status: 'pending' | 'running' | 'completed' | 'failed';
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
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
  secret_code: string;
  entry_limit: number | '';
  early_bird_limit: number | '';
  early_bird_voucher_id: string;
  grand_prize_voucher_id: string;
  grand_prize_description: string;
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
  secret_code: '',
  entry_limit: '',
  early_bird_limit: '',
  early_bird_voucher_id: '',
  grand_prize_voucher_id: '',
  grand_prize_description: '',
  consolation_voucher_id: '',
};

const statusStyles: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  expired: 'bg-red-100 text-red-800',
  archived: 'bg-gray-100 text-gray-500',
};

const statusIcons: Record<CampaignStatus, typeof Clock> = {
  draft: FileEdit,
  scheduled: Clock,
  active: CheckCircle,
  paused: PauseCircle,
  expired: Clock,
  archived: ArchiveIcon,
};

const WINNER_STEPS: WinnerStatus[] = ['selected', 'contacted', 'verified', 'processing', 'delivered'];

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function GiveawaysPage() {
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
  const [broadcastAudience, setBroadcastAudience] = useState<'opted_in_list' | 'campaign_non_winners'>('opted_in_list');
  const [nonWinnerCount, setNonWinnerCount] = useState<number | null>(null);
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const [redrawModalOpen, setRedrawModalOpen] = useState(false);
  const [redrawReason, setRedrawReason] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);

  useEffect(() => {
    loadCampaigns();
    loadVoucherOptions();
  }, []);

  useEffect(() => {
    if (entriesCampaign) refreshAudiencePreview(entriesCampaign, broadcastAudience);
  }, [entriesCampaign, broadcastAudience]);

  async function loadCampaigns() {
    setLoading(true);
    const { data, error } = await supabase
      .from('campaigns')
      .select(
        'id, slug, internal_name, public_title, campaign_objective, status, start_date, end_date, secret_code, entry_limit, early_bird_limit, early_bird_voucher_id, grand_prize_voucher_id, grand_prize_description, consolation_voucher_id, hero_config, created_at'
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
  }

  async function loadVoucherOptions() {
    const { data } = await supabase
      .from('campaign_vouchers')
      .select('id, code, campaign_name')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    setVouchers((data || []) as VoucherOption[]);
  }

  function openCreate() {
    setEditingId(null);
    setFormData(emptyForm);
    setSlugTouched(false);
    setFormOpen(true);
  }

  function openEdit(campaign: GiveawayCampaignRow) {
    setEditingId(campaign.id);
    setSlugTouched(true);
    setFormData({
      internal_name: campaign.internal_name,
      public_title: campaign.public_title,
      slug: campaign.slug,
      campaign_objective: campaign.campaign_objective || '',
      status: campaign.status,
      start_date: campaign.start_date ? campaign.start_date.slice(0, 16) : '',
      end_date: campaign.end_date ? campaign.end_date.slice(0, 16) : '',
      hero_headline: campaign.hero_config?.headline || '',
      hero_subtitle: campaign.hero_config?.subtitle || '',
      hero_cta_label: campaign.hero_config?.ctaLabel || 'Enter Now',
      secret_code: campaign.secret_code || '',
      entry_limit: campaign.entry_limit ?? '',
      early_bird_limit: campaign.early_bird_limit ?? '',
      early_bird_voucher_id: campaign.early_bird_voucher_id || '',
      grand_prize_voucher_id: campaign.grand_prize_voucher_id || '',
      grand_prize_description: campaign.grand_prize_description || '',
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
          headline: formData.hero_headline.trim(),
          subtitle: formData.hero_subtitle.trim(),
          ctaLabel: formData.hero_cta_label.trim() || 'Enter Now',
        },
        product_selection_rules: {},
        review_rules: {},
        secret_code: formData.secret_code.trim(),
        entry_limit: formData.entry_limit === '' ? null : Number(formData.entry_limit),
        early_bird_limit: formData.early_bird_limit === '' ? null : Number(formData.early_bird_limit),
        early_bird_voucher_id: formData.early_bird_voucher_id || null,
        grand_prize_voucher_id: formData.grand_prize_voucher_id || null,
        grand_prize_description: formData.grand_prize_description.trim() || null,
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

        // Fixed, minimal section layout for a giveaway landing page — hero +
        // the giveaway entry widget + footer. Not reorderable in v1 (unlike
        // merchandising campaigns' drag-free-but-numbered section list in
        // Campaigns.tsx) since a giveaway page's structure doesn't vary.
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
      await loadCampaigns();
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

    const [
      { data: entryRows, error: entryError },
      { data: drawRows, error: drawError },
      { data: templateRows, error: templateError },
      { data: broadcastRows, error: broadcastError },
      { count: optInTotal, error: optInError },
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
    ]);

    if (entryError) notification.error('Failed to load entries', entryError.message);
    if (drawError) notification.error('Failed to load draw history', drawError.message);
    if (templateError) notification.error('Failed to load WhatsApp templates', templateError.message);
    if (broadcastError) notification.error('Failed to load broadcast history', broadcastError.message);
    if (optInError) notification.error('Failed to load opt-in count', optInError.message);

    setEntries((entryRows || []) as EntryRow[]);
    setDraws((drawRows || []) as DrawRow[]);
    setWhatsappTemplates((templateRows || []) as WhatsAppTemplateOption[]);
    setBroadcasts((broadcastRows || []) as BroadcastRow[]);
    setOptInCount(optInTotal ?? 0);
    setEntriesLoading(false);
  }

  /** Bearer-token call to a JLO Netlify function — same pattern as logActivity.ts. */
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

  /**
   * Fire-and-forget, same spirit as logActivity() — a Skola outage or missing
   * SKOLA_WEBHOOK_URL/SECRET config must never block a giveaway save/draw.
   * Phase 3 is JLO-side only: this just delivers the event into Skola's
   * existing generic webhook receiver; nothing there routes it to an agent
   * yet (deliberately out of scope — see project memory).
   */
  function notifySkola(eventType: 'campaign.launched' | 'giveaway.winner_drawn' | 'giveaway.winner_redrawn', campaignId: string) {
    callAdminFunction('notify-skola-giveaway-event', { event_type: eventType, campaign_id: campaignId }).catch((error) => {
      console.warn('Skola notification failed (non-blocking):', error);
    });
  }

  /** Pulls real approval status/category from Meta so the dropdown below stops showing a stale local cache. */
  async function handleSyncTemplates() {
    setSyncingTemplates(true);
    try {
      const result = await callAdminFunction('admin-sync-whatsapp-templates', {});
      notification.success('Templates synced', `${result.updated} of ${result.checked} updated from Meta.`);
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

  async function refreshAudiencePreview(campaign: GiveawayCampaignRow, audience: 'opted_in_list' | 'campaign_non_winners') {
    if (audience !== 'campaign_non_winners') return;
    try {
      const result = await callAdminFunction('admin-giveaway-broadcast', {
        campaign_id: campaign.id,
        audience,
        preview_only: true,
      });
      setNonWinnerCount(result.recipientCount);
    } catch {
      setNonWinnerCount(null);
    }
  }

  async function handleSendBroadcast() {
    if (!entriesCampaign) return;
    if (!broadcastTemplateName) {
      notification.error('Choose a template', 'Pick the approved WhatsApp template to send.');
      return;
    }
    const targetCount = broadcastAudience === 'campaign_non_winners' ? nonWinnerCount : optInCount;
    if (!targetCount) {
      notification.error('No recipients', 'There is nobody to send this to right now.');
      return;
    }
    const audienceLabel = broadcastAudience === 'campaign_non_winners' ? "this campaign's non-winning entrants" : 'the opted-in contact list';
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
      notification.success('Winner drawn', 'The draw is recorded — see the Draw History below.');
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
      setRedrawModalOpen(false);
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

  if (!['admin', 'manager'].includes(user?.role || '')) {
    return (
      <div className="p-6 text-sm text-gray-600">
        You don't have permission to view giveaway entries and draw results.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gift className="w-6 h-6 text-purple-600" />
          <h1 className="text-xl font-semibold text-gray-900">Giveaways</h1>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> New Giveaway
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No giveaway campaigns yet. Click "New Giveaway" to set up a secret-code drop.
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => {
            const StatusIcon = statusIcons[campaign.status];
            const counts = entryCounts[campaign.id] || { valid: 0, duplicate: 0, invalid: 0 };
            return (
              <div key={campaign.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">{campaign.public_title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${statusStyles[campaign.status]}`}>
                      <StatusIcon className="w-3 h-3" /> {campaign.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    /campaigns/{campaign.slug} · code {campaign.secret_code || '—'} · {counts.valid} valid, {counts.duplicate} duplicate, {counts.invalid} invalid
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEntries(campaign)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    <Users className="w-4 h-4" /> Entries & Draw
                  </button>
                  <button
                    onClick={() => openEdit(campaign)}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">{editingId ? 'Edit Giveaway' : 'New Giveaway'}</h2>
              <button onClick={() => setFormOpen(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">Public title</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.public_title}
                    onChange={(e) => {
                      const value = e.target.value;
                      setFormData((prev) => ({
                        ...prev,
                        public_title: value,
                        slug: slugTouched ? prev.slug : slugify(value),
                      }));
                    }}
                    placeholder="Mirror Glow Secret Drop"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Internal name</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.internal_name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, internal_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Slug (julinemart.com/campaigns/…)</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setFormData((prev) => ({ ...prev, slug: slugify(e.target.value) }));
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Status</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.status}
                    onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value as CampaignStatus }))}
                  >
                    {(['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'] as CampaignStatus[]).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Secret code</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm uppercase"
                    value={formData.secret_code}
                    onChange={(e) => setFormData((prev) => ({ ...prev, secret_code: e.target.value }))}
                    placeholder="MIRRORGLOW"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Start date</label>
                  <input
                    type="datetime-local"
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.start_date}
                    onChange={(e) => setFormData((prev) => ({ ...prev, start_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">End date (entries close)</label>
                  <input
                    type="datetime-local"
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.end_date}
                    onChange={(e) => setFormData((prev) => ({ ...prev, end_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Entry limit (blank = unlimited)</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.entry_limit}
                    onChange={(e) => setFormData((prev) => ({ ...prev, entry_limit: e.target.value === '' ? '' : Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Early-bird limit (first N entrants)</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.early_bird_limit}
                    onChange={(e) => setFormData((prev) => ({ ...prev, early_bird_limit: e.target.value === '' ? '' : Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Early-bird reward voucher</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.early_bird_voucher_id}
                    onChange={(e) => setFormData((prev) => ({ ...prev, early_bird_voucher_id: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {vouchers.map((v) => (
                      <option key={v.id} value={v.id}>{v.code} ({v.campaign_name})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Grand prize voucher (optional)</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.grand_prize_voucher_id}
                    onChange={(e) => setFormData((prev) => ({ ...prev, grand_prize_voucher_id: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {vouchers.map((v) => (
                      <option key={v.id} value={v.id}>{v.code} ({v.campaign_name})</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">Grand prize description</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.grand_prize_description}
                    onChange={(e) => setFormData((prev) => ({ ...prev, grand_prize_description: e.target.value }))}
                    placeholder="LED Makeup Mirror"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">Consolation voucher for non-winners (optional)</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.consolation_voucher_id}
                    onChange={(e) => setFormData((prev) => ({ ...prev, consolation_voucher_id: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {vouchers.map((v) => (
                      <option key={v.id} value={v.id}>{v.code} ({v.campaign_name})</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Offered to non-winning entrants after the draw via the "Entries &amp; Draw" panel's remarketing broadcast.
                  </p>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">Hero headline</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.hero_headline}
                    onChange={(e) => setFormData((prev) => ({ ...prev, hero_headline: e.target.value }))}
                    placeholder="Win an LED Makeup Mirror"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">Hero subtitle</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    value={formData.hero_subtitle}
                    onChange={(e) => setFormData((prev) => ({ ...prev, hero_subtitle: e.target.value }))}
                    placeholder="The secret code drops Friday at 6PM"
                  />
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
              <button onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {entriesCampaign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="font-semibold text-gray-900">{entriesCampaign.public_title} — Entries & Draw</h2>
              <button onClick={() => setEntriesCampaign(null)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-4">
              {entriesLoading ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-lg font-semibold text-gray-900">{entries.length}</div>
                      <div className="text-xs text-gray-500">Total submissions</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3">
                      <div className="text-lg font-semibold text-green-700">{entries.filter((e) => e.status === 'valid').length}</div>
                      <div className="text-xs text-gray-500">Valid</div>
                    </div>
                    <div className="bg-yellow-50 rounded-lg p-3">
                      <div className="text-lg font-semibold text-yellow-700">{entries.filter((e) => e.status === 'duplicate').length}</div>
                      <div className="text-xs text-gray-500">Duplicate</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3">
                      <div className="text-lg font-semibold text-red-700">{entries.filter((e) => e.status === 'invalid').length}</div>
                      <div className="text-xs text-gray-500">Invalid</div>
                    </div>
                  </div>

                  <div className="bg-purple-50 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-purple-900 flex items-center gap-2">
                        <Trophy className="w-4 h-4" /> Draw
                      </div>
                      <div className="text-xs text-purple-700 mt-1">
                        {hasCompletedDraw
                          ? currentWinner
                            ? `Winner: ${currentWinner.full_name} (entry #${currentWinner.entry_position})`
                            : 'Winner drawn (details loading)'
                          : `${eligibleCount} eligible entr${eligibleCount === 1 ? 'y' : 'ies'} to draw from`}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!hasCompletedDraw ? (
                        <button
                          onClick={handleDraw}
                          disabled={drawing || eligibleCount === 0}
                          className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
                        >
                          {drawing && <Loader2 className="w-4 h-4 animate-spin" />} Draw Winner
                        </button>
                      ) : (
                        <button
                          onClick={() => setRedrawModalOpen(true)}
                          disabled={drawing}
                          className="px-4 py-2 text-sm border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-100 disabled:opacity-50 flex items-center gap-2"
                        >
                          {drawing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Forfeit & Redraw
                        </button>
                      )}
                    </div>
                  </div>

                  {draws.length > 0 && (
                    <div className="text-xs text-gray-500 space-y-1">
                      <div className="font-medium text-gray-700">Draw history</div>
                      {draws.map((d) => {
                        const winnerEntry = entries.find((e) => e.id === d.winning_entry_id);
                        return (
                          <div key={d.id}>
                            {new Date(d.drawn_at).toLocaleString()} — {d.status}
                            {d.status === 'forfeited' && d.forfeit_reason ? ` (${d.forfeit_reason})` : ''}
                            {' '}· {d.eligible_entry_count} eligible entries
                            {winnerEntry ? ` · winner: ${winnerEntry.full_name} (#${winnerEntry.entry_position})` : ''}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="bg-green-50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-green-900 flex items-center gap-2">
                        <Send className="w-4 h-4" /> Send WhatsApp broadcast
                      </div>
                      <div className="text-xs text-green-700">
                        {(broadcastAudience === 'campaign_non_winners' ? nonWinnerCount : optInCount) ?? '—'} recipient(s)
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">
                      Requires a WhatsApp template already <strong>approved by Meta</strong> as Marketing category —
                      approval happens in Meta Business Manager, not here.
                    </p>
                    <div>
                      <label className="text-xs font-medium text-gray-600">Audience</label>
                      <select
                        className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        value={broadcastAudience}
                        onChange={(e) => setBroadcastAudience(e.target.value as typeof broadcastAudience)}
                      >
                        <option value="opted_in_list">All opted-in contacts (e.g. "the code just dropped")</option>
                        <option value="campaign_non_winners">This campaign's non-winning entrants (e.g. "didn't win? here's a reward")</option>
                      </select>
                      {broadcastAudience === 'campaign_non_winners' && entriesCampaign.consolation_voucher_id && (
                        <p className="mt-1 text-xs text-gray-500">
                          Consolation voucher linked: <strong>{vouchers.find((v) => v.id === entriesCampaign.consolation_voucher_id)?.code || entriesCampaign.consolation_voucher_id}</strong> — include its code in your template variables below.
                        </p>
                      )}
                      {broadcastAudience === 'campaign_non_winners' && !entriesCampaign.consolation_voucher_id && (
                        <p className="mt-1 text-xs text-amber-600">
                          No consolation voucher linked to this campaign — edit the giveaway to add one, or reference an existing code manually in your template variables.
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium text-gray-600">Template</label>
                          <button
                            type="button"
                            onClick={handleSyncTemplates}
                            disabled={syncingTemplates}
                            title="Refresh approval status from Meta"
                            className="flex items-center gap-1 text-xs text-green-700 hover:underline disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${syncingTemplates ? 'animate-spin' : ''}`} /> Sync
                          </button>
                        </div>
                        <select
                          className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          value={broadcastTemplateName}
                          onChange={(e) => setBroadcastTemplateName(e.target.value)}
                        >
                          <option value="">— choose a template —</option>
                          {whatsappTemplates.map((t) => (
                            <option key={t.name} value={t.name}>
                              {t.name} ({t.meta_template_status})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600">Template variables (comma-separated, in order)</label>
                        <input
                          className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          value={broadcastVariables}
                          onChange={(e) => setBroadcastVariables(e.target.value)}
                          placeholder={`${entriesCampaign.public_title}, ${entriesCampaign.secret_code || ''}`}
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleSendBroadcast}
                      disabled={broadcasting || !broadcastTemplateName}
                      className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {broadcasting && <Loader2 className="w-4 h-4 animate-spin" />} Send Now
                    </button>

                    {broadcasts.length > 0 && (
                      <div className="text-xs text-gray-500 space-y-1 pt-1 border-t border-green-100">
                        <div className="font-medium text-gray-700">Broadcast history</div>
                        {broadcasts.map((b) => (
                          <div key={b.id}>
                            {new Date(b.started_at).toLocaleString()} — {b.template_name} — {b.status}
                            {' '}· {b.audience === 'campaign_non_winners' ? 'non-winners' : 'opt-in list'}
                            {' '}· {b.sent_count}/{b.recipient_count} sent, {b.failed_count} failed
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                          <th className="py-2 pr-3">#</th>
                          <th className="py-2 pr-3">Name</th>
                          <th className="py-2 pr-3">WhatsApp</th>
                          <th className="py-2 pr-3">Location</th>
                          <th className="py-2 pr-3">Status</th>
                          <th className="py-2 pr-3">Reward</th>
                          <th className="py-2 pr-3">Winner status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry) => (
                          <tr key={entry.id} className="border-b border-gray-100">
                            <td className="py-2 pr-3">{entry.entry_position ?? '—'}</td>
                            <td className="py-2 pr-3">{entry.full_name}</td>
                            <td className="py-2 pr-3">{entry.whatsapp_number}</td>
                            <td className="py-2 pr-3">{entry.location || '—'}</td>
                            <td className="py-2 pr-3 capitalize">{entry.status}</td>
                            <td className="py-2 pr-3">{entry.reward_tier || '—'}</td>
                            <td className="py-2 pr-3">
                              {entry.winner_status === 'none' ? (
                                '—'
                              ) : entry.winner_status === 'forfeited' ? (
                                <span className="text-red-600">forfeited</span>
                              ) : (
                                <button
                                  onClick={() => advanceWinnerStatus(entry)}
                                  disabled={entry.winner_status === 'delivered'}
                                  className="text-purple-700 hover:underline disabled:no-underline disabled:text-gray-500 capitalize"
                                  title={entry.winner_status === 'delivered' ? undefined : 'Click to advance to the next stage'}
                                >
                                  {entry.winner_status}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {redrawModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl max-w-sm w-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Forfeit &amp; Redraw</h2>
              <button onClick={() => { setRedrawModalOpen(false); setRedrawReason(''); }}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-gray-600">
                The current winner will be marked forfeited (kept on record) and a new winner drawn from the remaining eligible entries.
              </p>
              <div>
                <label className="text-xs font-medium text-gray-600">Reason (required)</label>
                <textarea
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  rows={3}
                  value={redrawReason}
                  onChange={(e) => setRedrawReason(e.target.value)}
                  placeholder="e.g. Winner unreachable after 48 hours"
                  autoFocus
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => { setRedrawModalOpen(false); setRedrawReason(''); }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={submitForfeitAndRedraw}
                disabled={drawing || !redrawReason.trim()}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
              >
                {drawing && <Loader2 className="w-4 h-4 animate-spin" />} Confirm Redraw
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
