/**
 * Admin: Build Your Own packaging tiers (Standard/Premium/Luxury box price + item cap).
 */
import { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Ban, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

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
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

export default function GiftPackagingPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [tiers, setTiers] = useState<PackagingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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

  const commitField = async (tier: PackagingTier, patch: Partial<PackagingTier>) => {
    const headers = authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-packaging?id=${tier.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      setTiers((prev) => prev.map((t) => (t.id === tier.id ? json.data : t)));
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Update failed');
      load();
    }
  };

  const commitPrice = (tier: PackagingTier, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n === tier.price) return;
    commitField(tier, { price: n });
  };

  const commitMaxItems = (tier: PackagingTier, raw: string) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n === tier.max_items) return;
    commitField(tier, { max_items: n });
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
      setTiers((prev) => prev.map((t) => (t.id === tier.id ? json.data : t)));
      notification.success(json.data.active ? 'Tier reactivated' : 'Tier deactivated');
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
      notification.success('Packaging tier deleted');
      setTiers((prev) => prev.filter((t) => t.id !== tier.id));
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const createTier = async () => {
    const headers = authHeaders();
    if (!headers) return;
    if (!form.name.trim()) {
      notification.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${functionsBase}/admin-gift-packaging`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          price: Number(form.price || 0),
          max_items: Number(form.max_items || 1),
          sort_order: Number(form.sort_order || 0),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create tier');
      notification.success('Packaging tier created');
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to create tier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Package className="w-8 h-8 text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Gift packaging tiers</h1>
            <p className="text-sm text-gray-600">
              Box size/price options shown at Build Your Own checkout. Edit price or item cap inline.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-primary btn-sm inline-flex items-center gap-1.5"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus className="w-4 h-4" />
          Add tier
        </button>
      </div>

      {showForm && (
        <div className="card mb-6 space-y-3 max-w-2xl">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Name *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Standard Box"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Price ₦</label>
              <input
                className={inputCls}
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Max items</label>
              <input
                className={inputCls}
                type="number"
                min={1}
                value={form.max_items}
                onChange={(e) => setForm({ ...form, max_items: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Sort order</label>
              <input
                className={inputCls}
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Description</label>
            <input
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What the packing team should use for this tier"
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={createTier}>
              {saving ? 'Creating…' : 'Create tier'}
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setShowForm(false);
                setForm(emptyForm);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
      ) : tiers.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center border border-dashed rounded-lg">
          No packaging tiers yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {tiers.map((tier) => (
            <div
              key={tier.id}
              className={`card space-y-2 ${!tier.active ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">
                    {tier.name}
                    {!tier.active && (
                      <span className="ml-2 text-xs font-medium text-red-600">Inactive</span>
                    )}
                  </p>
                  {tier.description && <p className="text-xs text-gray-500 mt-0.5">{tier.description}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${
                    tier.active
                      ? 'border border-red-200 text-red-700 hover:bg-red-50'
                      : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                  }`}
                  onClick={() => toggleActive(tier)}
                >
                  {tier.active ? (
                    <>
                      <Ban className="w-3.5 h-3.5" /> Deactivate
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3.5 h-3.5" /> Reactivate
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
                  onClick={() => deleteTier(tier)}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Price ₦</label>
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    defaultValue={tier.price}
                    key={`${tier.id}-price-${tier.price}`}
                    onBlur={(e) => commitPrice(tier, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Max items</label>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    defaultValue={tier.max_items}
                    key={`${tier.id}-maxitems-${tier.max_items}`}
                    onBlur={(e) => commitMaxItems(tier, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
