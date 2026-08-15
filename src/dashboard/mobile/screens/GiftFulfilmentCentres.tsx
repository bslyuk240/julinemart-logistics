import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Gift, Loader, MapPin, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';

type GiftHub = {
  id: string;
  name: string;
  code: string;
  country: string;
  state: string;
  city: string;
  address?: string | null;
  active: boolean;
  is_default: boolean;
  same_day_supported: boolean;
  next_day_supported: boolean;
};

type PoolRow = {
  id: string;
  product_id: string;
  available_qty: number;
  gift_program_cost: number | null;
  lead_time_days: number;
  active: boolean;
  products?: {
    id: string;
    name: string;
    sku?: string;
    gift_eligible?: boolean;
  } | null;
};

type SearchProduct = {
  id: string;
  name: string;
  sku?: string;
  gift_eligible?: boolean;
  in_pool?: boolean;
};

const emptyHubForm = {
  name: '',
  code: '',
  state: '',
  city: '',
  address: '',
  is_default: false,
  active: true,
  same_day_supported: false,
  next_day_supported: true,
};

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

export default function MobileGiftFulfilmentCentres() {
  const { session } = useAuth();
  const notification = useNotification();
  const [view, setView] = useState<'hubs' | 'pool'>('hubs');
  const [hubs, setHubs] = useState<GiftHub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState('');
  const [pool, setPool] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolLoading, setPoolLoading] = useState(false);
  const [selectedHub, setSelectedHub] = useState<GiftHub | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingHub, setEditingHub] = useState<GiftHub | null>(null);
  const [hubForm, setHubForm] = useState(emptyHubForm);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchProduct[]>([]);
  const [assignQty, setAssignQty] = useState('10');
  const [assignCost, setAssignCost] = useState('');
  const [assignLead, setAssignLead] = useState('0');
  const [searchOpen, setSearchOpen] = useState(false);

  const authHeaders = useCallback(() => {
    if (!session?.access_token) return null;
    return {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    };
  }, [session?.access_token]);

  const loadHubs = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) return;
    setLoading(true);
    try {
      const res = await fetch(`${functionsBase}/admin-gift-fulfilment-centres`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load hubs');
      const list: GiftHub[] = json.data || [];
      setHubs(list);
      if (!selectedHubId && list.length) {
        const def = list.find((h) => h.is_default) || list[0];
        setSelectedHubId(def.id);
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load hubs');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, notification, selectedHubId]);

  const loadPool = useCallback(async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    setPoolLoading(true);
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-pool?gfc_id=${encodeURIComponent(selectedHubId)}`,
        { headers },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load pool');
      setPool(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load pool');
    } finally {
      setPoolLoading(false);
    }
  }, [authHeaders, notification, selectedHubId]);

  useEffect(() => {
    loadHubs();
  }, [loadHubs]);

  useEffect(() => {
    if (view === 'pool' && selectedHubId) loadPool();
  }, [view, selectedHubId, loadPool]);

  const refresh = async () => {
    await loadHubs();
    if (view === 'pool') await loadPool();
  };

  const openCreate = () => {
    setEditingHub(null);
    setHubForm(emptyHubForm);
    setFormOpen(true);
    setSelectedHub(null);
  };

  const openEdit = (hub: GiftHub) => {
    setEditingHub(hub);
    setHubForm({
      name: hub.name,
      code: hub.code,
      state: hub.state,
      city: hub.city,
      address: hub.address || '',
      is_default: hub.is_default,
      active: hub.active,
      same_day_supported: hub.same_day_supported,
      next_day_supported: hub.next_day_supported,
    });
    setFormOpen(true);
    setSelectedHub(null);
  };

  const saveHub = async () => {
    const headers = authHeaders();
    if (!headers) return;
    if (!hubForm.name.trim() || !hubForm.code.trim()) {
      notification.error('Name and code are required');
      return;
    }
    setSaving(true);
    try {
      const url = editingHub
        ? `${functionsBase}/admin-gift-fulfilment-centres?id=${editingHub.id}`
        : `${functionsBase}/admin-gift-fulfilment-centres`;
      const res = await fetch(url, {
        method: editingHub ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(hubForm),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      notification.success(editingHub ? 'Hub updated' : 'Hub created');
      setFormOpen(false);
      setEditingHub(null);
      setHubForm(emptyHubForm);
      await loadHubs();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deactivateHub = async (hub: GiftHub) => {
    if (hub.is_default) {
      notification.error('Set another default hub first');
      return;
    }
    const headers = authHeaders();
    if (!headers) return;
    if (!confirm(`Deactivate ${hub.name}?`)) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-fulfilment-centres?id=${hub.id}`, {
        method: 'PATCH',
        headers,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success('Hub deactivated');
      setSelectedHub(null);
      await loadHubs();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const runSearch = async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId || !search.trim()) return;
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-pool?gfc_id=${encodeURIComponent(selectedHubId)}&search=${encodeURIComponent(search.trim())}`,
        { headers },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setSearchResults(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const assignProduct = async (productId: string) => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-pool`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'assign',
          gfc_id: selectedHubId,
          product_id: productId,
          available_qty: Number(assignQty) || 0,
          gift_program_cost: assignCost ? Number(assignCost) : null,
          lead_time_days: Number(assignLead) || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Assign failed');
      notification.success('Added to pool');
      await loadPool();
      await runSearch();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Assign failed');
    }
  };

  const removeFromPool = async (poolId: string) => {
    const headers = authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-pool`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'remove', id: poolId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Remove failed');
      notification.success('Removed from pool');
      await loadPool();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const activeHub = hubs.find((h) => h.id === selectedHubId);

  return (
    <>
      <PullToRefresh onRefresh={refresh}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Gift className="h-5 w-5 text-primary-600" />
                  <h1 className="text-lg font-bold text-gray-900">Gift Hubs & Pool</h1>
                </div>
                <p className="text-xs text-gray-500">Consolidation centres & builder inventory</p>
              </div>
              {view === 'hubs' && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              )}
              {view === 'pool' && (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
                >
                  <Search className="h-3.5 w-3.5" />
                  Add SKU
                </button>
              )}
            </div>

            <div className="flex gap-1.5">
              {(['hubs', 'pool'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`flex-1 rounded-xl py-2 text-xs font-semibold ${
                    view === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                  }`}
                >
                  {key === 'hubs' ? 'Gift hubs' : 'Inventory pool'}
                </button>
              ))}
            </div>
          </div>

          {view === 'hubs' && (
            <div className="space-y-2 px-4 pt-1">
              {loading ? (
                <div className="flex justify-center py-16">
                  <Loader className="h-7 w-7 animate-spin text-primary-600" />
                </div>
              ) : hubs.length === 0 ? (
                <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                  <MapPin className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                  <p className="font-semibold text-gray-900">No gift hubs yet</p>
                  <button type="button" onClick={openCreate} className="mt-3 text-sm font-semibold text-primary-600">
                    Add your first hub
                  </button>
                </div>
              ) : (
                hubs.map((hub) => (
                  <button
                    key={hub.id}
                    type="button"
                    onClick={() => setSelectedHub(hub)}
                    className={`flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50 ${!hub.active ? 'opacity-60' : ''}`}
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate font-semibold text-gray-900">{hub.name}</p>
                        {hub.is_default && (
                          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-700">
                            Default
                          </span>
                        )}
                        {!hub.active && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {hub.code} · {hub.city}, {hub.state}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {view === 'pool' && (
            <div className="space-y-3 px-4 pt-1">
              <Field label="Gift hub">
                <select
                  value={selectedHubId}
                  onChange={(e) => setSelectedHubId(e.target.value)}
                  className={inputCls}
                >
                  {hubs.filter((h) => h.active).map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.code})
                    </option>
                  ))}
                </select>
              </Field>

              {activeHub && (
                <p className="text-xs text-gray-500">
                  Pool at <strong>{activeHub.city}</strong> — gift-eligible products only
                </p>
              )}

              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-gray-400" />
                <p className="text-sm font-semibold text-gray-900">Pool ({pool.length})</p>
              </div>

              {poolLoading ? (
                <div className="flex justify-center py-12">
                  <Loader className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : pool.length === 0 ? (
                <div className="rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-gray-100">
                  <p className="text-sm text-gray-500">No products in this hub pool yet.</p>
                  <button
                    type="button"
                    onClick={() => setSearchOpen(true)}
                    className="mt-3 text-sm font-semibold text-primary-600"
                  >
                    Add a product
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {pool.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-start justify-between gap-3 rounded-2xl bg-white p-3.5 ring-1 ring-gray-100"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">
                          {row.products?.name || row.product_id}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Qty {row.available_qty}
                          {row.gift_program_cost != null ? ` · ${formatNaira(Number(row.gift_program_cost))}` : ''}
                          {row.lead_time_days ? ` · ${row.lead_time_days}d lead` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromPool(row.id)}
                        className="shrink-0 rounded-lg p-2 text-red-600 active:bg-red-50"
                        aria-label="Remove from pool"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!selectedHub} onClose={() => setSelectedHub(null)} ariaLabel="Gift hub details">
        {selectedHub && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">{selectedHub.name}</h2>
              <p className="text-sm text-gray-500">{selectedHub.code}</p>
            </div>
            <div className="space-y-2 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100 text-sm">
              <p>
                <span className="text-gray-500">Location:</span> {selectedHub.city}, {selectedHub.state}
              </p>
              {selectedHub.address && (
                <p>
                  <span className="text-gray-500">Address:</span> {selectedHub.address}
                </p>
              )}
              {selectedHub.is_default && (
                <p className="text-primary-700 font-medium text-xs">Default hub for new gift sessions</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => openEdit(selectedHub)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
            >
              <Pencil className="h-4 w-4" />
              Edit hub
            </button>
            {selectedHub.active && !selectedHub.is_default && (
              <button
                type="button"
                onClick={() => deactivateHub(selectedHub)}
                className="w-full rounded-2xl bg-red-50 py-3 text-sm font-semibold text-red-700"
              >
                Deactivate hub
              </button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingHub(null);
        }}
        ariaLabel="Gift hub form"
      >
        <h2 className="text-lg font-bold text-gray-900">{editingHub ? 'Edit hub' : 'New gift hub'}</h2>
        <div className="max-h-[62vh] space-y-3 overflow-y-auto">
          <Field label="Name *">
            <input
              value={hubForm.name}
              onChange={(e) => setHubForm({ ...hubForm, name: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Code *">
            <input
              value={hubForm.code}
              onChange={(e) => setHubForm({ ...hubForm, code: e.target.value })}
              className={inputCls}
              placeholder="e.g. warri"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="State">
              <input
                value={hubForm.state}
                onChange={(e) => setHubForm({ ...hubForm, state: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="City">
              <input
                value={hubForm.city}
                onChange={(e) => setHubForm({ ...hubForm, city: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={hubForm.address}
              onChange={(e) => setHubForm({ ...hubForm, address: e.target.value })}
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={hubForm.is_default}
              onChange={(e) => setHubForm({ ...hubForm, is_default: e.target.checked })}
            />
            Default hub for new gift sessions
          </label>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={saveHub}
          className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save hub'}
        </button>
      </Sheet>

      <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} ariaLabel="Add product to pool">
        <h2 className="text-lg font-bold text-gray-900">Add to pool</h2>
        <div className="space-y-3">
          <Field label="Search product">
            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="Name or SKU"
                className={inputCls}
              />
              <button
                type="button"
                onClick={runSearch}
                className="shrink-0 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white"
              >
                Go
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Qty">
              <input value={assignQty} onChange={(e) => setAssignQty(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Program ₦">
              <input value={assignCost} onChange={(e) => setAssignCost(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Lead days">
              <input value={assignLead} onChange={(e) => setAssignLead(e.target.value)} className={inputCls} />
            </Field>
          </div>
          {searchResults.length > 0 && (
            <ul className="max-h-48 space-y-2 overflow-y-auto">
              {searchResults.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm ring-1 ring-gray-100"
                >
                  <span className="min-w-0 truncate">
                    {p.name}
                    {p.sku && <span className="text-gray-400"> ({p.sku})</span>}
                  </span>
                  {p.in_pool ? (
                    <span className="shrink-0 text-xs text-green-600 font-medium">In pool</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => assignProduct(p.id)}
                      className="shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  );
}
