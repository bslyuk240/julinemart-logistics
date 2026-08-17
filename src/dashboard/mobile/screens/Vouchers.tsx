import { useEffect, useMemo, useState } from 'react';
import { Copy, Eye, Loader, Plus, Ticket, Trash2 } from 'lucide-react';
import { supabase, useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { logActivity } from '../../lib/logActivity';
import { GIFT_OCCASION_TAGS, GIFT_RECIPIENT_TAGS } from '../../lib/giftDiscoveryTags';

interface CampaignVoucher {
  id: string;
  code: string;
  campaign_name: string;
  description: string | null;
  discount_type: 'free' | 'percentage' | 'fixed_amount';
  discount_value: number | null;
  product_ids: string[] | null;
  product_skus: string[] | null;
  vendor_ids: string[] | null;
  category_ids: string[] | null;
  gift_box_skus: string[] | null;
  gift_occasion_slugs: string[] | null;
  gift_recipient_slugs: string[] | null;
  max_uses: number;
  current_uses: number;
  max_uses_per_customer: number;
  valid_from: string;
  valid_until: string | null;
  status: 'active' | 'used' | 'expired' | 'cancelled';
  total_cost_absorbed: number;
  notes: string | null;
}

interface VoucherRedemption {
  id: string;
  customer_email: string;
  customer_name: string;
  discount_applied: number;
  customer_paid: number;
  redeemed_at: string;
}

interface FormState {
  code: string;
  campaign_name: string;
  description: string;
  discount_type: 'free' | 'percentage' | 'fixed_amount';
  discount_value: number | '';
  product_ids: string;
  product_skus: string;
  vendor_ids: string;
  category_ids: string;
  gift_box_skus: string;
  gift_occasion_slugs: string;
  gift_recipient_slugs: string;
  max_uses: number;
  max_uses_per_customer: number;
  valid_from: string;
  valid_until: string;
  notes: string;
}

const emptyForm: FormState = {
  code: '',
  campaign_name: '',
  description: '',
  discount_type: 'free',
  discount_value: '',
  product_ids: '',
  product_skus: '',
  vendor_ids: '',
  category_ids: '',
  gift_box_skus: '',
  gift_occasion_slugs: '',
  gift_recipient_slugs: '',
  max_uses: 1,
  max_uses_per_customer: 1,
  valid_from: new Date().toISOString().slice(0, 16),
  valid_until: '',
  notes: '',
};

const parseArray = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const STATUS_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  used: 'bg-gray-100 text-gray-600',
  expired: 'bg-red-100 text-red-700',
  cancelled: 'bg-orange-100 text-orange-700',
};

function discountLabel(v: CampaignVoucher) {
  if (v.discount_type === 'free') return 'Free product';
  if (v.discount_type === 'percentage') return `${v.discount_value}% off`;
  return formatNaira(v.discount_value || 0);
}

export default function MobileVouchers() {
  const { user } = useAuth();
  const notification = useNotification();
  const [vouchers, setVouchers] = useState<CampaignVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<CampaignVoucher | null>(null);
  const [redemptions, setRedemptions] = useState<VoucherRedemption[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [filter, setFilter] = useState('');
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('campaign_vouchers').select('*').order('created_at', { ascending: false });
    if (error) notification.error('Load failed', error.message);
    else setVouchers(data || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return vouchers;
    const q = filter.toLowerCase();
    return vouchers.filter((v) => v.code.toLowerCase().includes(q) || v.campaign_name.toLowerCase().includes(q));
  }, [vouchers, filter]);

  const openDetail = async (v: CampaignVoucher) => {
    setSelected(v);
    setDetailOpen(true);
    const { data } = await supabase
      .from('voucher_redemptions')
      .select('*')
      .eq('voucher_id', v.id)
      .order('redeemed_at', { ascending: false });
    setRedemptions(data || []);
  };

  const openEdit = (v: CampaignVoucher) => {
    setEditingId(v.id);
    setForm({
      code: v.code,
      campaign_name: v.campaign_name,
      description: v.description || '',
      discount_type: v.discount_type,
      discount_value: v.discount_value ?? '',
      product_ids: (v.product_ids || []).join(', '),
      product_skus: (v.product_skus || []).join(', '),
      vendor_ids: (v.vendor_ids || []).join(', '),
      category_ids: (v.category_ids || []).join(', '),
      gift_box_skus: (v.gift_box_skus || []).join(', '),
      gift_occasion_slugs: (v.gift_occasion_slugs || []).join(', '),
      gift_recipient_slugs: (v.gift_recipient_slugs || []).join(', '),
      max_uses: v.max_uses,
      max_uses_per_customer: v.max_uses_per_customer,
      valid_from: new Date(v.valid_from).toISOString().slice(0, 16),
      valid_until: v.valid_until ? new Date(v.valid_until).toISOString().slice(0, 16) : '',
      notes: v.notes || '',
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!isAdmin) return;
    if (!form.code.trim() || !form.campaign_name.trim()) {
      notification.error('Validation', 'Code and campaign name are required');
      return;
    }
    const payload = {
      code: form.code.trim().toUpperCase(),
      campaign_name: form.campaign_name.trim(),
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: form.discount_type === 'free' ? 0 : Number(form.discount_value),
      product_ids: parseArray(form.product_ids),
      product_skus: parseArray(form.product_skus).map((sku) => sku.toUpperCase()),
      vendor_ids: parseArray(form.vendor_ids),
      category_ids: parseArray(form.category_ids),
      gift_box_skus: parseArray(form.gift_box_skus).map((sku) => sku.toUpperCase()),
      gift_occasion_slugs: parseArray(form.gift_occasion_slugs).map((slug) => slug.toLowerCase()),
      gift_recipient_slugs: parseArray(form.gift_recipient_slugs).map((slug) => slug.toLowerCase()),
      max_uses: Number(form.max_uses),
      max_uses_per_customer: Number(form.max_uses_per_customer),
      valid_from: new Date(form.valid_from).toISOString(),
      valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null,
      notes: form.notes.trim() || null,
      created_by: user?.email || 'system',
    };
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from('campaign_vouchers').update(payload).eq('id', editingId);
        if (error) throw error;
        void logActivity({
          action: 'VOUCHER_UPDATED',
          resource_type: 'campaign_vouchers',
          resource_id: editingId,
          details: {
            code: payload.code,
            gift_box_skus: payload.gift_box_skus,
            gift_occasion_slugs: payload.gift_occasion_slugs,
            gift_recipient_slugs: payload.gift_recipient_slugs,
          },
        });
      } else {
        const { data: created, error } = await supabase.from('campaign_vouchers').insert(payload).select('id').single();
        if (error) throw error;
        void logActivity({
          action: 'VOUCHER_CREATED',
          resource_type: 'campaign_vouchers',
          resource_id: created?.id,
          details: {
            code: payload.code,
            gift_box_skus: payload.gift_box_skus,
            gift_occasion_slugs: payload.gift_occasion_slugs,
            gift_recipient_slugs: payload.gift_recipient_slugs,
          },
        });
      }
      notification.success('Saved', 'Voucher saved');
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      load();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSaving(false);
    }
  };

  const cancelVoucher = async (id: string) => {
    if (!isAdmin || !window.confirm('Cancel this voucher?')) return;
    await supabase.from('campaign_vouchers').update({ status: 'cancelled' }).eq('id', id);
    void logActivity({
      action: 'VOUCHER_CANCELLED',
      resource_type: 'campaign_vouchers',
      resource_id: id,
    });
    load();
  };

  const remove = async (id: string) => {
    if (!isAdmin || !window.confirm('Delete voucher and redemptions?')) return;
    await supabase.from('campaign_vouchers').delete().eq('id', id);
    void logActivity({
      action: 'VOUCHER_DELETED',
      resource_type: 'campaign_vouchers',
      resource_id: id,
    });
    setDetailOpen(false);
    load();
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Vouchers</h1>
              <p className="text-xs text-gray-500">Campaign promo codes</p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm);
                  setFormOpen(true);
                }}
                className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            )}
          </div>

          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search code or campaign…"
            className="w-full rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-gray-100"
            style={{ fontSize: '16px' }}
          />

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => void openDetail(v)}
                  className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-gray-100"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                    <Ticket className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold text-gray-900">{v.code}</p>
                    <p className="truncate text-xs text-gray-500">{v.campaign_name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[v.status]}`}>
                        {v.status}
                      </span>
                      <span className="text-[10px] text-gray-400">{discountLabel(v)}</span>
                      <span className="text-[10px] text-gray-400">
                        {v.current_uses}/{v.max_uses} uses
                      </span>
                    </div>
                  </div>
                  <Eye className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} ariaLabel="Voucher form">
        <h3 className="text-base font-bold">{editingId ? 'Edit voucher' : 'New voucher'}</h3>
        <div className="space-y-3">
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="Code *" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono uppercase" style={{ fontSize: '16px' }} />
          <input value={form.campaign_name} onChange={(e) => setForm((f) => ({ ...f, campaign_name: e.target.value }))} placeholder="Campaign name *" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" rows={2} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />

          <select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value as FormState['discount_type'] }))} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }}>
            <option value="free">Free product</option>
            <option value="percentage">Percentage</option>
            <option value="fixed_amount">Fixed amount (NGN)</option>
          </select>
          {form.discount_type !== 'free' && (
            <input type="number" value={form.discount_value} onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value === '' ? '' : Number(e.target.value) }))} placeholder="Discount value" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          )}

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Marketplace restrictions (optional)
            </p>
            <div className="space-y-2">
              <input value={form.product_ids} onChange={(e) => setForm((f) => ({ ...f, product_ids: e.target.value }))} placeholder="Product IDs (comma-separated)" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono" style={{ fontSize: '16px' }} />
              <input value={form.product_skus} onChange={(e) => setForm((f) => ({ ...f, product_skus: e.target.value }))} placeholder="Product SKUs (comma-separated)" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono uppercase" style={{ fontSize: '16px' }} />
              <input value={form.vendor_ids} onChange={(e) => setForm((f) => ({ ...f, vendor_ids: e.target.value }))} placeholder="Vendor IDs (comma-separated)" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono" style={{ fontSize: '16px' }} />
              <input value={form.category_ids} onChange={(e) => setForm((f) => ({ ...f, category_ids: e.target.value }))} placeholder="Category IDs (comma-separated)" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono" style={{ fontSize: '16px' }} />
            </div>
          </div>

          <div className="rounded-xl border border-purple-100 bg-purple-50/60 p-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-800">
              Gift restrictions (optional)
            </p>
            <p className="mb-2 text-xs text-purple-800">
              Gift vouchers discount the box price only. Leave empty for any gift order (when marketplace fields above are also empty).
            </p>
            <div className="space-y-2">
              <input value={form.gift_box_skus} onChange={(e) => setForm((f) => ({ ...f, gift_box_skus: e.target.value.toUpperCase() }))} placeholder="Gift box SKUs (comma-separated)" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono uppercase" style={{ fontSize: '16px' }} />
              <input value={form.gift_occasion_slugs} onChange={(e) => setForm((f) => ({ ...f, gift_occasion_slugs: e.target.value }))} placeholder={`Occasions: ${GIFT_OCCASION_TAGS.map((t) => t.slug).join(', ')}`} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono" style={{ fontSize: '16px' }} />
              <input value={form.gift_recipient_slugs} onChange={(e) => setForm((f) => ({ ...f, gift_recipient_slugs: e.target.value }))} placeholder={`Recipients: ${GIFT_RECIPIENT_TAGS.map((t) => t.slug).join(', ')}`} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm font-mono" style={{ fontSize: '16px' }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={1} value={form.max_uses} onChange={(e) => setForm((f) => ({ ...f, max_uses: Number(e.target.value) }))} placeholder="Max total uses" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
            <input type="number" min={1} value={form.max_uses_per_customer} onChange={(e) => setForm((f) => ({ ...f, max_uses_per_customer: Number(e.target.value) }))} placeholder="Max per customer" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Valid from</label>
            <input type="datetime-local" value={form.valid_from} onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Valid until (optional)</label>
            <input type="datetime-local" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
          </div>

          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes (not shown to customers)" rows={2} className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        </div>
        <button type="button" disabled={saving} onClick={() => void save()} className="mt-3 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : 'Save voucher'}
        </button>
      </Sheet>

      <Sheet open={detailOpen} onClose={() => setDetailOpen(false)} ariaLabel="Voucher details">
        {selected && (
          <>
            <h3 className="font-mono text-base font-bold">{selected.code}</h3>
            <p className="text-sm text-gray-600">{selected.campaign_name}</p>
            <p className="text-xs text-gray-500">{discountLabel(selected)} · {selected.current_uses}/{selected.max_uses} uses</p>
            {selected.description && <p className="text-sm text-gray-700">{selected.description}</p>}
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(selected.code);
                notification.success('Copied', 'Voucher code copied');
              }}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-sm font-semibold"
            >
              <Copy className="h-4 w-4" /> Copy code
            </button>
            {isAdmin && (
              <div className="flex gap-2">
                <button type="button" onClick={() => { setDetailOpen(false); openEdit(selected); }} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-semibold">
                  Edit
                </button>
                {selected.status === 'active' && (
                  <button type="button" onClick={() => void cancelVoucher(selected.id)} className="flex-1 rounded-lg border border-orange-200 py-2 text-sm font-semibold text-orange-700">
                    Cancel
                  </button>
                )}
                <button type="button" onClick={() => void remove(selected.id)} className="rounded-lg border border-red-200 p-2 text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
            <p className="text-[11px] font-medium uppercase text-gray-400">Redemptions ({redemptions.length})</p>
            {redemptions.length === 0 ? (
              <p className="text-sm text-gray-500">No redemptions yet.</p>
            ) : (
              redemptions.slice(0, 10).map((r) => (
                <div key={r.id} className="rounded-lg bg-gray-50 p-2 text-xs">
                  <p className="font-medium">{r.customer_name || r.customer_email}</p>
                  <p className="text-gray-500">{formatNaira(r.discount_applied)} off · paid {formatNaira(r.customer_paid)}</p>
                </div>
              ))
            )}
          </>
        )}
      </Sheet>
    </>
  );
}
