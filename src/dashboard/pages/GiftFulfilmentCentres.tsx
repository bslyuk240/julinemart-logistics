import { useCallback, useEffect, useState } from 'react';
import { Gift, MapPin, Plus, Package, Search, Trash2, Pencil } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

const inlineNumCls =
  'w-[5.75rem] border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-900 focus:border-primary-500 focus:outline-none';

function commitNonNeg(raw: string, previous: number, onCommit: (n: number) => void) {
  const n = Number(raw);
  const next = Number.isFinite(n) ? Math.max(0, n) : previous;
  if (next !== previous) onCommit(next);
}

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
  vendor_pre_settled?: boolean;
  products?: {
    id: string;
    name: string;
    sku?: string;
    gift_eligible?: boolean;
    gift_category?: string | null;
    regular_price?: number | null;
    sale_price?: number | null;
  } | null;
};

type SearchProduct = {
  id: string;
  name: string;
  sku?: string;
  gift_eligible?: boolean;
  in_pool?: boolean;
  regular_price?: number | null;
  sale_price?: number | null;
};

type SourcedItem = {
  id: string;
  name: string;
  sku?: string | null;
  gift_category?: string | null;
  gift_program_cost: number;
  available_qty: number;
  lead_time_days: number;
  active: boolean;
};

type CommercialSettings = {
  packaging_markup: number;
  profit_margin_percent: number;
  profit_margin_fixed: number;
};

const emptySourcedForm = {
  name: '',
  sku: '',
  gift_category: '',
  gift_program_cost: '',
  available_qty: '10',
  lead_time_days: '0',
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

export default function GiftFulfilmentCentresPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [tab, setTab] = useState<'hubs' | 'pool'>('hubs');
  const [hubs, setHubs] = useState<GiftHub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState<string>('');
  const [pool, setPool] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolLoading, setPoolLoading] = useState(false);
  const [showHubForm, setShowHubForm] = useState(false);
  const [editingHub, setEditingHub] = useState<GiftHub | null>(null);
  const [hubForm, setHubForm] = useState(emptyHubForm);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchProduct[]>([]);
  const [assignQty, setAssignQty] = useState('10');
  const [assignCost, setAssignCost] = useState('');
  const [assignLead, setAssignLead] = useState('0');
  const [assignPreSettled, setAssignPreSettled] = useState(false);
  const [sourcedItems, setSourcedItems] = useState<SourcedItem[]>([]);
  const [sourcedLoading, setSourcedLoading] = useState(false);
  const [sourcedForm, setSourcedForm] = useState(emptySourcedForm);
  const [showSourcedForm, setShowSourcedForm] = useState(false);
  const [commercial, setCommercial] = useState<CommercialSettings>({
    packaging_markup: 500,
    profit_margin_percent: 15,
    profit_margin_fixed: 0,
  });
  const [commercialSaving, setCommercialSaving] = useState(false);

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
        { headers }
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

  const loadSourced = useCallback(async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    setSourcedLoading(true);
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-pool-sourced?gfc_id=${encodeURIComponent(selectedHubId)}`,
        { headers }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load sourced items');
      setSourcedItems(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load sourced items');
    } finally {
      setSourcedLoading(false);
    }
  }, [authHeaders, notification, selectedHubId]);

  const loadCommercial = useCallback(async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-commercial-settings?gfc_id=${encodeURIComponent(selectedHubId)}`,
        { headers }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load commercial settings');
      if (json.data) {
        setCommercial({
          packaging_markup: Number(json.data.packaging_markup ?? 500),
          profit_margin_percent: Number(json.data.profit_margin_percent ?? 15),
          profit_margin_fixed: Number(json.data.profit_margin_fixed ?? 0),
        });
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load commercial settings');
    }
  }, [authHeaders, notification, selectedHubId]);

  useEffect(() => {
    loadHubs();
  }, [loadHubs]);

  useEffect(() => {
    if (tab === 'pool' && selectedHubId) {
      loadPool();
      loadSourced();
      loadCommercial();
    }
  }, [tab, selectedHubId, loadPool, loadSourced, loadCommercial]);

  const saveHub = async () => {
    const headers = authHeaders();
    if (!headers) return;
    if (!hubForm.name.trim() || !hubForm.code.trim() || !hubForm.state.trim() || !hubForm.city.trim()) {
      notification.error('Name, code, state, and city are required');
      return;
    }
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
      setShowHubForm(false);
      setEditingHub(null);
      setHubForm(emptyHubForm);
      loadHubs();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const deactivateHub = async (hub: GiftHub) => {
    if (hub.is_default) {
      notification.error('Cannot deactivate the default hub — set another default first');
      return;
    }
    const headers = authHeaders();
    if (!headers) return;
    if (!confirm(`Deactivate ${hub.name}?`)) return;
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-fulfilment-centres?id=${hub.id}`,
        { method: 'PATCH', headers }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success('Hub deactivated');
      loadHubs();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const reactivateHub = async (hub: GiftHub) => {
    const headers = authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-fulfilment-centres?id=${hub.id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ active: true }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success('Hub reactivated');
      loadHubs();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const deleteHub = async (hub: GiftHub) => {
    if (hub.is_default) {
      notification.error('Cannot delete the default hub — set another hub as default first');
      return;
    }
    const headers = authHeaders();
    if (!headers) return;
    if (
      !confirm(
        `Permanently delete "${hub.name}"? This cannot be undone. Only for hubs with no boxes, orders, or build-your-own sessions.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${functionsBase}/admin-gift-fulfilment-centres?id=${hub.id}`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      notification.success('Hub deleted');
      if (selectedHubId === hub.id) setSelectedHubId('');
      loadHubs();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const runSearch = async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId || !search.trim()) return;
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-pool?gfc_id=${encodeURIComponent(selectedHubId)}&search=${encodeURIComponent(search.trim())}`,
        { headers }
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
          vendor_pre_settled: assignPreSettled,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Assign failed');
      notification.success('Product added to gift pool');
      loadPool();
      runSearch();
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
      loadPool();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const saveCommercial = async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    setCommercialSaving(true);
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-commercial-settings?gfc_id=${encodeURIComponent(selectedHubId)}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(commercial),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      notification.success('Commercial settings saved');
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setCommercialSaving(false);
    }
  };

  const saveSourcedItem = async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId || !sourcedForm.name.trim()) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-pool-sourced`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          gift_fulfilment_centre_id: selectedHubId,
          name: sourcedForm.name.trim(),
          sku: sourcedForm.sku.trim() || null,
          gift_category: sourcedForm.gift_category.trim() || null,
          gift_program_cost: Number(sourcedForm.gift_program_cost) || 0,
          available_qty: Number(sourcedForm.available_qty) || 0,
          lead_time_days: Number(sourcedForm.lead_time_days) || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      notification.success('Sourced item added');
      setSourcedForm(emptySourcedForm);
      setShowSourcedForm(false);
      loadSourced();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const deleteSourcedItem = async (id: string) => {
    const headers = authHeaders();
    if (!headers) return;
    if (!confirm('Remove this sourced item?')) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-pool-sourced?id=${id}`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      notification.success('Sourced item removed');
      loadSourced();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const togglePoolPreSettled = async (row: PoolRow) => {
    const headers = authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-pool?id=${row.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ vendor_pre_settled: !row.vendor_pre_settled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      loadPool();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const patchPoolRow = async (
    row: PoolRow,
    patch: { available_qty?: number; gift_program_cost?: number | null; lead_time_days?: number },
  ) => {
    const headers = authHeaders();
    if (!headers) return;
    setPool((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    try {
      const res = await fetch(`${functionsBase}/admin-gift-pool?id=${encodeURIComponent(row.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      if (json.data) {
        setPool((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...json.data } : r)));
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Update failed');
      loadPool();
    }
  };

  const patchSourcedRow = async (
    row: SourcedItem,
    patch: { available_qty?: number; gift_program_cost?: number; lead_time_days?: number },
  ) => {
    const headers = authHeaders();
    if (!headers) return;
    setSourcedItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    try {
      const res = await fetch(`${functionsBase}/admin-gift-pool-sourced?id=${encodeURIComponent(row.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      if (json.data) {
        setSourcedItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...json.data } : r)));
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Update failed');
      loadSourced();
    }
  };

  const selectedHub = hubs.find((h) => h.id === selectedHubId);

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Gift className="w-7 h-7 text-primary-600" />
            JulineMart Gifts — Hubs & Pool
          </h1>
          <p className="text-gray-600 mt-1 text-sm">
            Consolidation centres for gift fulfilment. Pilot hub: <strong>Warri</strong>.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={tab === 'hubs' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setTab('hubs')}
          >
            Gift hubs
          </button>
          <button
            type="button"
            className={tab === 'pool' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            onClick={() => setTab('pool')}
          >
            Inventory pool
          </button>
        </div>
      </div>

      {tab === 'hubs' && (
        <>
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              onClick={() => {
                setEditingHub(null);
                setHubForm(emptyHubForm);
                setShowHubForm(true);
              }}
            >
              <Plus className="w-4 h-4" /> Add hub
            </button>
          </div>

          {showHubForm && (
            <div className="card mb-6 space-y-3">
              <h2 className="font-semibold">{editingHub ? 'Edit hub' : 'New gift hub'}</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <input className="input" placeholder="Name" value={hubForm.name} onChange={(e) => setHubForm({ ...hubForm, name: e.target.value })} />
                <input className="input" placeholder="Code (e.g. warri)" value={hubForm.code} onChange={(e) => setHubForm({ ...hubForm, code: e.target.value })} />
                <input className="input" placeholder="State" value={hubForm.state} onChange={(e) => setHubForm({ ...hubForm, state: e.target.value })} />
                <input className="input" placeholder="City" value={hubForm.city} onChange={(e) => setHubForm({ ...hubForm, city: e.target.value })} />
                <input className="input sm:col-span-2" placeholder="Address" value={hubForm.address} onChange={(e) => setHubForm({ ...hubForm, address: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hubForm.is_default} onChange={(e) => setHubForm({ ...hubForm, is_default: e.target.checked })} />
                Default hub for new gift sessions
              </label>
              <div className="flex gap-2">
                <button type="button" className="btn-primary" onClick={saveHub}>Save</button>
                <button type="button" className="btn-secondary" onClick={() => setShowHubForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading hubs…</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {hubs.map((hub) => (
                <div key={hub.id} className={`card ${!hub.active ? 'opacity-60' : ''}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-primary-600" />
                        <h3 className="font-semibold text-gray-900">{hub.name}</h3>
                        {hub.is_default && (
                          <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full">Default</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{hub.city}, {hub.state} · <code>{hub.code}</code></p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="p-2 text-gray-500 hover:text-primary-600"
                        onClick={() => {
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
                          setShowHubForm(true);
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {!hub.active && <p className="text-xs text-red-600 mt-2">Inactive</p>}
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    {hub.active && !hub.is_default && (
                      <button type="button" className="text-xs text-red-600 underline" onClick={() => deactivateHub(hub)}>
                        Deactivate
                      </button>
                    )}
                    {!hub.active && (
                      <button type="button" className="text-xs text-emerald-700 underline" onClick={() => reactivateHub(hub)}>
                        Reactivate
                      </button>
                    )}
                    {!hub.is_default && (
                      <button type="button" className="text-xs text-red-800 underline" onClick={() => deleteHub(hub)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'pool' && (
        <>
          <div className="card mb-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Gift hub</label>
              <select
                className="input min-w-[200px]"
                value={selectedHubId}
                onChange={(e) => setSelectedHubId(e.target.value)}
              >
                {hubs.filter((h) => h.active).map((h) => (
                  <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                ))}
              </select>
            </div>
            {selectedHub && (
              <p className="text-sm text-gray-600">
                Pool at <strong>{selectedHub.city}</strong> — products must be gift-eligible and in pool to appear in builder (G3).
              </p>
            )}
          </div>

          <div className="card mb-6 space-y-3">
            <h2 className="font-semibold">Customer pricing (BYO margin stack)</h2>
            <p className="text-sm text-gray-600">
              Applied when customers build their own box, and as the suggested stack for ready-made boxes (item prices + this markup). Ready-made still saves a customer list price you can set from the box page.
            </p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Packaging markup ₦</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={commercial.packaging_markup}
                  onChange={(e) =>
                    setCommercial({ ...commercial, packaging_markup: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Profit margin %</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={0.1}
                  value={commercial.profit_margin_percent}
                  onChange={(e) =>
                    setCommercial({
                      ...commercial,
                      profit_margin_percent: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Fixed margin ₦</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={commercial.profit_margin_fixed}
                  onChange={(e) =>
                    setCommercial({
                      ...commercial,
                      profit_margin_fixed: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={commercialSaving}
              onClick={saveCommercial}
            >
              {commercialSaving ? 'Saving…' : 'Save commercial settings'}
            </button>
          </div>

          <div className="card mb-6 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Search className="w-4 h-4" /> Add vendor catalog product to pool
            </h2>
            <div className="flex flex-wrap gap-2">
              <input
                className="input flex-1 min-w-[200px]"
                placeholder="Search product name or SKU"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              />
              <input className="input w-24" placeholder="Qty" value={assignQty} onChange={(e) => setAssignQty(e.target.value)} />
              <input className="input w-32" placeholder="Catalog price if blank" value={assignCost} onChange={(e) => setAssignCost(e.target.value)} />
              <input className="input w-24" placeholder="Lead days" value={assignLead} onChange={(e) => setAssignLead(e.target.value)} />
              <label className="flex items-center gap-2 text-sm whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={assignPreSettled}
                  onChange={(e) => setAssignPreSettled(e.target.checked)}
                />
                Pre-paid stock
              </label>
              <button type="button" className="btn-primary" onClick={runSearch}>Search</button>
            </div>
            <p className="text-xs text-gray-500">
              Leave Program ₦ blank to use the vendor catalog price (sale price if set, otherwise regular). Override only if the gift programme cost differs.
            </p>
            {searchResults.length > 0 && (
              <ul className="divide-y border rounded-lg max-h-64 overflow-y-auto">
                {searchResults.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {p.name} {p.sku && <span className="text-gray-400">({p.sku})</span>}
                      {(p.sale_price || p.regular_price) != null && (
                        <span className="ml-2 text-gray-500">
                          ₦{Number(p.sale_price || p.regular_price).toLocaleString()}
                        </span>
                      )}
                      {p.in_pool && <span className="ml-2 text-green-600 text-xs">In pool</span>}
                    </span>
                    {!p.in_pool && (
                      <button type="button" className="btn-primary btn-sm" onClick={() => assignProduct(p.id)}>
                        Add
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card mb-6 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">JLO-sourced pool items</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowSourcedForm((v) => !v)}
              >
                {showSourcedForm ? 'Cancel' : 'Add sourced item'}
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Products sourced outside vendor catalog — no marketplace listing or vendor settlement.
            </p>
            {showSourcedForm && (
              <div className="grid sm:grid-cols-2 gap-3 border rounded-lg p-3 bg-gray-50">
                <input
                  className="input"
                  placeholder="Name *"
                  value={sourcedForm.name}
                  onChange={(e) => setSourcedForm({ ...sourcedForm, name: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="SKU"
                  value={sourcedForm.sku}
                  onChange={(e) => setSourcedForm({ ...sourcedForm, sku: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Category"
                  value={sourcedForm.gift_category}
                  onChange={(e) => setSourcedForm({ ...sourcedForm, gift_category: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Program cost ₦"
                  value={sourcedForm.gift_program_cost}
                  onChange={(e) => setSourcedForm({ ...sourcedForm, gift_program_cost: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Qty"
                  value={sourcedForm.available_qty}
                  onChange={(e) => setSourcedForm({ ...sourcedForm, available_qty: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Lead days"
                  value={sourcedForm.lead_time_days}
                  onChange={(e) => setSourcedForm({ ...sourcedForm, lead_time_days: e.target.value })}
                />
                <button type="button" className="btn-primary sm:col-span-2" onClick={saveSourcedItem}>
                  Save sourced item
                </button>
              </div>
            )}
            {sourcedLoading ? (
              <p className="text-gray-500 text-sm">Loading…</p>
            ) : sourcedItems.length === 0 ? (
              <p className="text-gray-500 text-sm">No JLO-sourced items at this hub yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Program cost</th>
                      <th className="py-2 pr-4">Lead days</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sourcedItems.map((row) => (
                      <tr key={row.id} className="border-b border-gray-100">
                        <td className="py-2 pr-4">
                          {row.name}
                          {row.sku && <span className="ml-1 text-gray-400">({row.sku})</span>}
                        </td>
                        <td className="py-2 pr-4">{row.available_qty}</td>
                        <td className="py-2 pr-4">
                          ₦{Number(row.gift_program_cost).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">{row.lead_time_days}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            className="text-red-600 p-1"
                            onClick={() => deleteSourcedItem(row.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="font-semibold flex items-center gap-2 mb-1">
              <Package className="w-4 h-4" /> Pool inventory ({pool.length})
            </h2>
            <p className="text-xs text-gray-500 mb-4">
              Edit qty, program cost, and lead days in the row — changes save when you leave the field.
            </p>
            {poolLoading ? (
              <p className="text-gray-500 text-sm">Loading…</p>
            ) : pool.length === 0 ? (
              <p className="text-gray-500 text-sm">No products in this hub pool yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-4">Product</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Program cost</th>
                      <th className="py-2 pr-4">Lead days</th>
                      <th className="py-2 pr-4">Pre-paid</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pool.map((row) => (
                      <tr key={row.id} className="border-b border-gray-100">
                        <td className="py-2 pr-4">
                          {row.products?.name || row.product_id}
                          {row.products?.gift_eligible && (
                            <span className="ml-1 text-xs text-primary-600">eligible</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            className={inlineNumCls}
                            type="number"
                            min={0}
                            defaultValue={row.available_qty}
                            key={`${row.id}-qty-${row.available_qty}`}
                            onBlur={(e) =>
                              commitNonNeg(e.target.value, row.available_qty, (n) =>
                                patchPoolRow(row, { available_qty: n }),
                              )
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            className={inlineNumCls}
                            type="number"
                            min={0}
                            placeholder={
                              row.products?.sale_price || row.products?.regular_price
                                ? String(Number(row.products.sale_price || row.products.regular_price))
                                : 'Catalog'
                            }
                            defaultValue={row.gift_program_cost ?? ''}
                            key={`${row.id}-cost-${row.gift_program_cost ?? 'blank'}`}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const next = raw === '' ? null : Number(raw);
                              const current = row.gift_program_cost;
                              if (next === current) return;
                              if (next != null && !Number.isFinite(next)) return;
                              void patchPoolRow(row, {
                                gift_program_cost: next == null ? null : Math.max(0, next),
                              });
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <input
                            className={`${inlineNumCls} w-16`}
                            type="number"
                            min={0}
                            defaultValue={row.lead_time_days}
                            key={`${row.id}-lead-${row.lead_time_days}`}
                            onBlur={(e) =>
                              commitNonNeg(e.target.value, row.lead_time_days, (n) =>
                                patchPoolRow(row, { lead_time_days: n }),
                              )
                            }
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <label className="inline-flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={Boolean(row.vendor_pre_settled)}
                              onChange={() => togglePoolPreSettled(row)}
                            />
                            {row.vendor_pre_settled ? 'Pre-settled' : 'Pending'}
                          </label>
                        </td>
                        <td className="py-2 text-right">
                          <button type="button" className="text-red-600 p-1" onClick={() => removeFromPool(row.id)}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
