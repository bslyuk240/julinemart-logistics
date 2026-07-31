import { useEffect, useMemo, useState } from 'react';
import { Loader, Plus, Trash2 } from 'lucide-react';
import { supabase, useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';

type DiscountType = 'free' | 'flat' | 'percent';

interface ShippingDiscount {
  id: string;
  name: string;
  type: DiscountType;
  discount_value: number | null;
  min_order_value: number | null;
  states: string[] | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

interface FormState {
  name: string;
  type: DiscountType;
  discount_value: number | '';
  min_order_value: number | '';
  states: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: '',
  type: 'free',
  discount_value: '',
  min_order_value: '',
  states: '',
  start_date: '',
  end_date: '',
  is_active: true,
};

const TYPE_LABEL: Record<DiscountType, string> = {
  free: 'Free shipping',
  flat: 'Flat off',
  percent: 'Percent off',
};

const TYPE_CLS: Record<DiscountType, string> = {
  free: 'bg-green-100 text-green-700',
  flat: 'bg-blue-100 text-blue-700',
  percent: 'bg-purple-100 text-purple-700',
};

function formatDateInput(value: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 16);
}

export default function MobileShippingDiscounts() {
  const { user } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<ShippingDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('shipping_discounts').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Could not fetch discounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseStates = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const openEdit = (d: ShippingDiscount) => {
    setEditingId(d.id);
    setForm({
      name: d.name,
      type: d.type,
      discount_value: d.discount_value ?? '',
      min_order_value: d.min_order_value ?? '',
      states: (d.states || []).join(', '),
      start_date: formatDateInput(d.start_date),
      end_date: formatDateInput(d.end_date),
      is_active: d.is_active,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can manage discounts');
      return;
    }
    if (!form.name.trim()) {
      notification.error('Validation', 'Name is required');
      return;
    }
    if (form.type !== 'free' && (!form.discount_value || Number(form.discount_value) <= 0)) {
      notification.error('Validation', 'Discount value must be greater than 0');
      return;
    }
    const payload = {
      name: form.name.trim(),
      type: form.type,
      discount_value: form.type === 'free' ? 0 : Number(form.discount_value),
      min_order_value: form.min_order_value === '' ? 0 : Number(form.min_order_value),
      states: parseStates(form.states),
      start_date: form.start_date ? new Date(form.start_date).toISOString() : null,
      end_date: form.end_date ? new Date(form.end_date).toISOString() : null,
      is_active: form.is_active,
    };
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from('shipping_discounts').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('shipping_discounts').insert(payload);
        if (error) throw error;
      }
      notification.success('Saved', editingId ? 'Discount updated' : 'Discount created');
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

  const toggleActive = async (d: ShippingDiscount) => {
    if (!isAdmin) return;
    const { error } = await supabase.from('shipping_discounts').update({ is_active: !d.is_active }).eq('id', d.id);
    if (error) notification.error('Update failed', error.message);
    else load();
  };

  const remove = async (id: string) => {
    if (!isAdmin || !window.confirm('Delete this discount?')) return;
    const { error } = await supabase.from('shipping_discounts').delete().eq('id', id);
    if (error) notification.error('Delete failed', error.message);
    else load();
  };

  const activeCount = useMemo(() => rows.filter((r) => r.is_active).length, [rows]);

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Shipping Discounts</h1>
              <p className="text-xs text-gray-500">{activeCount} active rule{activeCount !== 1 ? 's' : ''}</p>
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
                Add
              </button>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No shipping discounts yet.</div>
          ) : (
            <div className="space-y-2">
              {rows.map((d) => (
                <div key={d.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => isAdmin && openEdit(d)} className="min-w-0 flex-1 text-left">
                      <p className="font-semibold text-gray-900">{d.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_CLS[d.type]}`}>
                          {TYPE_LABEL[d.type]}
                          {d.type !== 'free' && d.discount_value != null ? ` · ${d.discount_value}` : ''}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            d.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {d.states?.length ? (
                        <p className="mt-1 text-xs text-gray-500">{d.states.join(', ')}</p>
                      ) : (
                        <p className="mt-1 text-xs text-gray-400">All states</p>
                      )}
                    </button>
                    {isAdmin && (
                      <div className="flex shrink-0 flex-col gap-1">
                        <button type="button" onClick={() => void toggleActive(d)} className="text-[10px] font-semibold text-primary-600">
                          {d.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" onClick={() => void remove(d.id)} className="text-red-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} ariaLabel="Shipping discount">
        <h3 className="text-base font-bold">{editingId ? 'Edit discount' : 'New discount'}</h3>
        <div className="space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Rule name *"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as DiscountType }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          >
            <option value="free">Free shipping</option>
            <option value="flat">Flat amount (NGN)</option>
            <option value="percent">Percentage</option>
          </select>
          {form.type !== 'free' && (
            <input
              type="number"
              value={form.discount_value}
              onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value === '' ? '' : Number(e.target.value) }))}
              placeholder="Discount value"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            />
          )}
          <input
            type="number"
            value={form.min_order_value}
            onChange={(e) => setForm((f) => ({ ...f, min_order_value: e.target.value === '' ? '' : Number(e.target.value) }))}
            placeholder="Min order value (NGN)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <input
            value={form.states}
            onChange={(e) => setForm((f) => ({ ...f, states: e.target.value }))}
            placeholder="States (comma-separated, empty = all)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="mt-3 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save discount'}
        </button>
      </Sheet>
    </>
  );
}
