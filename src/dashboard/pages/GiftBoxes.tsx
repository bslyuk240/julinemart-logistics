import { useCallback, useEffect, useState } from 'react';
import { Gift, Plus, Package, Trash2, Pencil, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type GiftHub = { id: string; name: string; code: string; is_default: boolean };

type GiftBox = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  list_price: number;
  active: boolean;
  sort_order: number;
  gift_fulfilment_centre_id: string;
};

type BoxItem = {
  id: string;
  product_id: string;
  quantity: number;
  component_cost: number | null;
  products?: { id: string; name: string; sku?: string; gift_eligible?: boolean } | null;
};

type PoolProduct = {
  id: string;
  name: string;
  sku?: string;
  in_pool?: boolean;
  gift_program_cost?: number | null;
};

const emptyBoxForm = {
  name: '',
  slug: '',
  description: '',
  image_url: '',
  list_price: '',
  sort_order: '0',
  active: true,
};

export default function GiftBoxesPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [hubs, setHubs] = useState<GiftHub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState('');
  const [boxes, setBoxes] = useState<GiftBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [boxItems, setBoxItems] = useState<BoxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [showBoxForm, setShowBoxForm] = useState(false);
  const [editingBox, setEditingBox] = useState<GiftBox | null>(null);
  const [boxForm, setBoxForm] = useState(emptyBoxForm);
  const [poolSearch, setPoolSearch] = useState('');
  const [poolResults, setPoolResults] = useState<PoolProduct[]>([]);
  const [addQty, setAddQty] = useState('1');
  const [addCost, setAddCost] = useState('');

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
    const res = await fetch(`${functionsBase}/admin-gift-fulfilment-centres`, { headers });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to load hubs');
    const list: GiftHub[] = json.data || [];
    setHubs(list);
    if (!selectedHubId && list.length) {
      const def = list.find((h) => h.is_default) || list[0];
      setSelectedHubId(def.id);
    }
  }, [authHeaders, selectedHubId]);

  const loadBoxes = useCallback(async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-boxes?gfc_id=${encodeURIComponent(selectedHubId)}`,
        { headers }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load boxes');
      setBoxes(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load boxes');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, notification, selectedHubId]);

  const loadBoxDetail = useCallback(async (boxId: string) => {
    const headers = authHeaders();
    if (!headers) return;
    setItemsLoading(true);
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes?id=${encodeURIComponent(boxId)}`, {
        headers,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load box');
      setBoxItems(json.data?.items || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load box items');
    } finally {
      setItemsLoading(false);
    }
  }, [authHeaders, notification]);

  useEffect(() => {
    loadHubs().catch((err) => notification.error(err.message));
  }, [loadHubs, notification]);

  useEffect(() => {
    if (selectedHubId) loadBoxes();
  }, [selectedHubId, loadBoxes]);

  useEffect(() => {
    if (selectedBoxId) loadBoxDetail(selectedBoxId);
    else setBoxItems([]);
  }, [selectedBoxId, loadBoxDetail]);

  const saveBox = async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    try {
      const payload = {
        ...boxForm,
        list_price: Number(boxForm.list_price),
        sort_order: Number(boxForm.sort_order),
        gift_fulfilment_centre_id: selectedHubId,
      };
      const url = editingBox
        ? `${functionsBase}/admin-gift-boxes?id=${editingBox.id}`
        : `${functionsBase}/admin-gift-boxes`;
      const res = await fetch(url, {
        method: editingBox ? 'PUT' : 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Save failed');
      notification.success(editingBox ? 'Box updated' : 'Box created');
      setShowBoxForm(false);
      setEditingBox(null);
      setBoxForm(emptyBoxForm);
      await loadBoxes();
      if (json.data?.id) setSelectedBoxId(json.data.id);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const searchPool = async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId || !poolSearch.trim()) return;
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-pool?gfc_id=${encodeURIComponent(selectedHubId)}&search=${encodeURIComponent(poolSearch.trim())}`,
        { headers }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setPoolResults((json.data || []).filter((p: PoolProduct) => p.in_pool));
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const addItem = async (productId: string) => {
    const headers = authHeaders();
    if (!headers || !selectedBoxId) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'add_item',
          gift_box_id: selectedBoxId,
          product_id: productId,
          quantity: Math.max(1, Number(addQty) || 1),
          component_cost: addCost ? Number(addCost) : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Add failed');
      notification.success('Item added to box');
      await loadBoxDetail(selectedBoxId);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Add failed');
    }
  };

  const removeItem = async (itemId: string) => {
    const headers = authHeaders();
    if (!headers || !selectedBoxId) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'remove_item', item_id: itemId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Remove failed');
      notification.success('Item removed');
      await loadBoxDetail(selectedBoxId);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const selectedBox = boxes.find((b) => b.id === selectedBoxId) || null;
  const componentTotal = boxItems.reduce(
    (s, i) => s + (Number(i.component_cost || 0) * i.quantity),
    0
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Gift className="w-8 h-8 text-primary-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ready-made gift boxes</h1>
          <p className="text-sm text-gray-600">Curate Mode A boxes per consolidation hub</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <label className="text-sm text-gray-600">Hub</label>
        <div className="relative">
          <select
            className="appearance-none border rounded-lg pl-3 pr-8 py-2 text-sm bg-white"
            value={selectedHubId}
            onChange={(e) => {
              setSelectedHubId(e.target.value);
              setSelectedBoxId(null);
            }}
          >
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.code})
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm"
          onClick={() => {
            setEditingBox(null);
            setBoxForm(emptyBoxForm);
            setShowBoxForm(true);
          }}
        >
          <Plus className="w-4 h-4" /> New box
        </button>
      </div>

      {showBoxForm && (
        <div className="bg-white border rounded-xl p-4 mb-6 space-y-3">
          <h2 className="font-semibold">{editingBox ? 'Edit box' : 'Create box'}</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {(['name', 'slug', 'list_price', 'sort_order', 'image_url'] as const).map((field) => (
              <input
                key={field}
                className="border rounded-lg px-3 py-2 text-sm"
                placeholder={field.replace('_', ' ')}
                value={boxForm[field]}
                onChange={(e) => setBoxForm({ ...boxForm, [field]: e.target.value })}
              />
            ))}
          </div>
          <textarea
            className="border rounded-lg px-3 py-2 text-sm w-full"
            placeholder="Description"
            rows={3}
            value={boxForm.description}
            onChange={(e) => setBoxForm({ ...boxForm, description: e.target.value })}
          />
          <div className="flex gap-2">
            <button type="button" className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm" onClick={saveBox}>
              Save
            </button>
            <button
              type="button"
              className="border px-4 py-2 rounded-lg text-sm"
              onClick={() => {
                setShowBoxForm(false);
                setEditingBox(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-medium">Boxes</div>
          {loading ? (
            <p className="p-4 text-sm text-gray-500">Loading…</p>
          ) : boxes.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No boxes yet for this hub.</p>
          ) : (
            <ul className="divide-y">
              {boxes.map((box) => (
                <li key={box.id}>
                  <button
                    type="button"
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-2 ${selectedBoxId === box.id ? 'bg-primary-50' : ''}`}
                    onClick={() => setSelectedBoxId(box.id)}
                  >
                    <div>
                      <p className="font-medium text-sm">{box.name}</p>
                      <p className="text-xs text-gray-500">/{box.slug} · ₦{Number(box.list_price).toLocaleString()}</p>
                    </div>
                    <button
                      type="button"
                      className="p-1 text-gray-400 hover:text-primary-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingBox(box);
                        setBoxForm({
                          name: box.name,
                          slug: box.slug,
                          description: box.description || '',
                          image_url: box.image_url || '',
                          list_price: String(box.list_price),
                          sort_order: String(box.sort_order),
                          active: box.active,
                        });
                        setShowBoxForm(true);
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-medium flex items-center gap-2">
            <Package className="w-4 h-4" />
            {selectedBox ? selectedBox.name : 'Select a box'}
          </div>
          {!selectedBox ? (
            <p className="p-4 text-sm text-gray-500">Choose a box to manage contents.</p>
          ) : (
            <div className="p-4 space-y-4">
              {selectedBox && (
                <p className="text-xs text-gray-600">
                  List ₦{Number(selectedBox.list_price).toLocaleString()} · component cost ₦{componentTotal.toLocaleString()} · margin ₦
                  {(Number(selectedBox.list_price) - componentTotal).toLocaleString()}
                </p>
              )}
              {itemsLoading ? (
                <p className="text-sm text-gray-500">Loading items…</p>
              ) : boxItems.length === 0 ? (
                <p className="text-sm text-gray-500">No items in this box yet.</p>
              ) : (
                <ul className="space-y-2">
                  {boxItems.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{item.products?.name || item.product_id}</p>
                        <p className="text-xs text-gray-500">
                          Qty {item.quantity}
                          {item.component_cost != null ? ` · cost ₦${Number(item.component_cost).toLocaleString()}` : ''}
                        </p>
                      </div>
                      <button type="button" className="text-red-500" onClick={() => removeItem(item.id)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t pt-4 space-y-2">
                <p className="text-sm font-medium">Add from pool</p>
                <div className="flex gap-2">
                  <input
                    className="border rounded-lg px-3 py-2 text-sm flex-1"
                    placeholder="Search pool products…"
                    value={poolSearch}
                    onChange={(e) => setPoolSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchPool()}
                  />
                  <button type="button" className="border px-3 py-2 rounded-lg text-sm" onClick={searchPool}>
                    Search
                  </button>
                </div>
                <div className="flex gap-2">
                  <input className="border rounded-lg px-3 py-2 text-sm w-20" placeholder="Qty" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                  <input className="border rounded-lg px-3 py-2 text-sm flex-1" placeholder="Component cost (optional)" value={addCost} onChange={(e) => setAddCost(e.target.value)} />
                </div>
                <ul className="max-h-48 overflow-y-auto divide-y border rounded-lg">
                  {poolResults.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>{p.name}</span>
                      <button type="button" className="text-primary-600 text-xs font-medium" onClick={() => addItem(p.id)}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
