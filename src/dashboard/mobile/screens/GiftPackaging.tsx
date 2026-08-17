import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Ban, ChevronRight, Loader, Package, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';

type PackagingTier = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: number;
  max_items: number;
  sort_order: number;
  active: boolean;
};

const emptyForm = { name: '', description: '', price: '', max_items: '5', sort_order: '0' };

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-900 outline-none focus:border-primary-500 focus:bg-white';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

export default function MobileGiftPackaging() {
  const { session } = useAuth();
  const notification = useNotification();
  const [tiers, setTiers] = useState<PackagingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<PackagingTier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PackagingTier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const authHeaders = useCallback(() => {
    if (!session?.access_token) return null;
    return {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    };
  }, [session?.access_token]);

  const load = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) return;
    setLoading(true);
    try {
      const res = await fetch(`${functionsBase}/admin-gift-packaging`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load packaging tiers');
      setTiers(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load packaging tiers');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, notification]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditingTier(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (tier: PackagingTier) => {
    setEditingTier(tier);
    setForm({
      name: tier.name,
      description: tier.description || '',
      price: String(tier.price),
      max_items: String(tier.max_items),
      sort_order: String(tier.sort_order),
    });
    setFormOpen(true);
    setSelectedTier(null);
  };

  const saveTier = async () => {
    const headers = authHeaders();
    if (!headers) return;
    if (!form.name.trim()) {
      notification.error('Name is required');
      return;
    }
    const price = Number(form.price);
    const maxItems = Number(form.max_items);
    if (!Number.isFinite(price) || price < 0) {
      notification.error('Enter a valid price');
      return;
    }
    if (!Number.isFinite(maxItems) || maxItems < 1) {
      notification.error('Max items must be at least 1');
      return;
    }
    setSaving(true);
    try {
      const url = editingTier
        ? `${functionsBase}/admin-gift-packaging?id=${editingTier.id}`
        : `${functionsBase}/admin-gift-packaging`;
      const res = await fetch(url, {
        method: editingTier ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          price,
          max_items: Math.round(maxItems),
          sort_order: Number(form.sort_order) || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      notification.success(editingTier ? 'Tier updated' : 'Tier created');
      setFormOpen(false);
      setEditingTier(null);
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (tier: PackagingTier) => {
    const headers = authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-packaging?id=${tier.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ active: !tier.active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success(json.data.active ? 'Tier reactivated' : 'Tier deactivated');
      setSelectedTier(null);
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const deleteTier = async (tier: PackagingTier) => {
    const headers = authHeaders();
    if (!headers) return;
    if (!confirm(`Permanently delete "${tier.name}"? This cannot be undone. Only works if no orders used it.`)) {
      return;
    }
    try {
      const res = await fetch(`${functionsBase}/admin-gift-packaging?id=${tier.id}`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      notification.success('Tier deleted');
      setSelectedTier(null);
      await load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary-600" />
                  <h1 className="text-lg font-bold text-gray-900">Packaging Tiers</h1>
                </div>
                <p className="text-xs text-gray-500">Build Your Own box size/price options</p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="flex shrink-0 items-center gap-1 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : tiers.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <Package className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No packaging tiers yet</p>
                <button type="button" onClick={openCreate} className="mt-3 text-sm font-semibold text-primary-600">
                  Create first tier
                </button>
              </div>
            ) : (
              tiers.map((tier) => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => setSelectedTier(tier)}
                  className={`flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50 ${!tier.active ? 'opacity-60' : ''}`}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold text-gray-900">{tier.name}</p>
                      {!tier.active && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {formatNaira(Number(tier.price))} · up to {tier.max_items} items
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!selectedTier} onClose={() => setSelectedTier(null)} ariaLabel="Packaging tier details">
        {selectedTier && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedTier.name}</h2>
                {selectedTier.description && (
                  <p className="text-sm text-gray-500">{selectedTier.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => openEdit(selectedTier)}
                className="rounded-lg p-2 text-gray-500 active:bg-gray-100"
                aria-label="Edit tier"
              >
                <Package className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-2xl bg-gray-50 p-3.5 ring-1 ring-gray-100">
              <p className="text-sm text-gray-900">
                Price <span className="font-semibold">{formatNaira(Number(selectedTier.price))}</span>
              </p>
              <p className="text-sm text-gray-900">
                Max items <span className="font-semibold">{selectedTier.max_items}</span>
              </p>
            </div>

            <button
              type="button"
              onClick={() => openEdit(selectedTier)}
              className="w-full rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white"
            >
              Edit price / details
            </button>

            <div className="flex gap-2">
              {selectedTier.active ? (
                <button
                  type="button"
                  onClick={() => toggleActive(selectedTier)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-red-50 py-3 text-sm font-semibold text-red-700"
                >
                  <Ban className="h-4 w-4" />
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleActive(selectedTier)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reactivate
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteTier(selectedTier)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-red-200 py-3 text-sm font-semibold text-red-800"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingTier(null);
        }}
        ariaLabel="Packaging tier form"
      >
        <h2 className="text-lg font-bold text-gray-900">{editingTier ? 'Edit tier' : 'New packaging tier'}</h2>
        <p className="text-xs text-gray-500">
          {editingTier ? 'Update name, price, and item cap.' : 'Shown to customers at Build Your Own checkout.'}
        </p>
        <div className="space-y-3">
          <Field label="Name *">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Standard Box"
              className={inputCls}
            />
          </Field>
          <Field label="Price ₦ *">
            <input
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className={inputCls}
              inputMode="numeric"
            />
          </Field>
          <Field label="Max items *">
            <input
              value={form.max_items}
              onChange={(e) => setForm({ ...form, max_items: e.target.value })}
              className={inputCls}
              inputMode="numeric"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className={inputCls}
              placeholder="What the packing team should use for this tier"
            />
          </Field>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={saveTier}
          className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save tier'}
        </button>
      </Sheet>
    </>
  );
}
