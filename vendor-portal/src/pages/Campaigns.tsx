import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, Megaphone, Plus, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

type VendorCampaign = {
  id: string;
  slug: string;
  public_title: string;
  status: string;
  approval_status: string | null;
  review_notes?: string | null;
  storefront_url?: string;
  submitted_at?: string | null;
};

const APPROVAL_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending: 'Under review',
  approved: 'Approved',
  rejected: 'Needs changes',
};

const APPROVAL_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
};

const emptyForm = {
  public_title: '',
  hero_headline: '',
  hero_subtitle: '',
  hero_image_url: '',
  product_ids: '',
  offer_display_text: '',
};

export default function Campaigns() {
  const { vendor } = useAuth();
  const [rows, setRows] = useState<VendorCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getCampaigns();
      setRows(data || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      hero_headline: vendor?.store_name ? `Shop ${vendor.store_name}` : '',
    });
    setShowForm(true);
    setError(null);
  };

  const openEdit = (row: VendorCampaign) => {
    setEditingId(row.id);
    setForm({ ...emptyForm, public_title: row.public_title });
    setShowForm(true);
    setError(null);
  };

  const save = async (submit: boolean) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const body = {
        ...form,
        action: submit ? 'submit' : 'save',
        ...(editingId ? { id: editingId } : {}),
      };
      const result = editingId
        ? await api.updateCampaign(body)
        : await api.createCampaign(body);
      setSuccess(result.message || (submit ? 'Submitted for review' : 'Saved'));
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setSuccess('Link copied');
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      setError('Could not copy link');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary-600" />
            Promotions
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Create a landing page for your store. JulineMart reviews before it goes live.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />
          New
        </button>
      </div>

      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{success}</div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm space-y-4">
          <h2 className="font-semibold text-gray-900">{editingId ? 'Edit promotion' : 'New promotion'}</h2>
          <Field label="Public title *">
            <input
              value={form.public_title}
              onChange={(e) => setForm((f) => ({ ...f, public_title: e.target.value }))}
              placeholder="Weekend kitchen sale"
              className={inputCls}
            />
          </Field>
          <Field label="Headline">
            <input
              value={form.hero_headline}
              onChange={(e) => setForm((f) => ({ ...f, hero_headline: e.target.value }))}
              className={inputCls}
            />
          </Field>
          <Field label="Subtitle">
            <textarea
              value={form.hero_subtitle}
              onChange={(e) => setForm((f) => ({ ...f, hero_subtitle: e.target.value }))}
              rows={2}
              className={inputCls}
            />
          </Field>
          <Field label="Hero image URL">
            <input
              value={form.hero_image_url}
              onChange={(e) => setForm((f) => ({ ...f, hero_image_url: e.target.value }))}
              placeholder="https://..."
              className={inputCls}
            />
          </Field>
          <Field label="Product IDs (optional, comma-separated)">
            <input
              value={form.product_ids}
              onChange={(e) => setForm((f) => ({ ...f, product_ids: e.target.value }))}
              placeholder="Leave blank to show your latest products"
              className={inputCls}
            />
          </Field>
          <Field label="Offer text (optional)">
            <input
              value={form.offer_display_text}
              onChange={(e) => setForm((f) => ({ ...f, offer_display_text: e.target.value }))}
              placeholder="10% off this weekend"
              className={inputCls}
            />
          </Field>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => save(false)}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-800"
            >
              Save draft
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => save(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              Submit for review
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setEditingId(null); }}
              className="px-3 py-2.5 text-sm text-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
          <Megaphone className="mx-auto h-10 w-10 text-gray-300 mb-3" />
          <p className="text-gray-600 mb-4">No promotions yet. Create one to share on WhatsApp or in-store.</p>
          <button type="button" onClick={openCreate} className="text-sm font-semibold text-primary-600">
            Create your first promotion
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const approval = row.approval_status || 'draft';
            const canEdit = approval === 'draft' || approval === 'rejected';
            return (
              <li key={row.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{row.public_title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">/campaigns/{row.slug}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${APPROVAL_CLS[approval] || APPROVAL_CLS.draft}`}>
                    {APPROVAL_LABEL[approval] || approval}
                  </span>
                </div>
                {row.review_notes && approval === 'rejected' && (
                  <p className="mt-2 text-xs text-red-600">{row.review_notes}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.storefront_url && approval === 'approved' && (
                    <>
                      <a
                        href={row.storefront_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-primary-600"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> View live
                      </a>
                      <button
                        type="button"
                        onClick={() => copyLink(`${row.storefront_url}?utm_source=vendor&utm_medium=share`)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700"
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy share link
                      </button>
                    </>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700"
                    >
                      Edit
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
