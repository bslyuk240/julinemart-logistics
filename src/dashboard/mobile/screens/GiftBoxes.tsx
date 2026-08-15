import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronRight, Gift, Loader, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { GIFT_OCCASION_TAGS, GIFT_RECIPIENT_TAGS } from '../../lib/giftDiscoveryTags';
import {
  filterPoolPickerItems,
  giftBoxSlugPreview,
  normalizePoolPickerItems,
  type PoolPickerProduct,
} from '../../lib/giftBoxHelpers';
import GiftBoxImageFields from '../../components/GiftBoxImageFields';

type GiftHub = { id: string; name: string; code: string; is_default: boolean };

type GiftBox = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  gallery_urls?: string[];
  list_price: number;
  active: boolean;
  sort_order: number;
  gift_fulfilment_centre_id: string;
  recipient_types?: string[];
  occasion_types?: string[];
};

type BoxItem = {
  id: string;
  product_id: string;
  quantity: number;
  component_cost: number | null;
  products?: { id: string; name: string; sku?: string } | null;
};

type PoolProduct = PoolPickerProduct;

const emptyBoxForm = {
  name: '',
  slug: '',
  description: '',
  image_url: '',
  gallery_urls: [] as string[],
  list_price: '',
  sort_order: '0',
  active: true,
  occasion_types: [] as string[],
  recipient_types: [] as string[],
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

export default function MobileGiftBoxes() {
  const { session } = useAuth();
  const notification = useNotification();
  const [hubs, setHubs] = useState<GiftHub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState('');
  const [boxes, setBoxes] = useState<GiftBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBox, setSelectedBox] = useState<GiftBox | null>(null);
  const [boxItems, setBoxItems] = useState<BoxItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingBox, setEditingBox] = useState<GiftBox | null>(null);
  const [boxForm, setBoxForm] = useState(emptyBoxForm);
  const [saving, setSaving] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [poolSearch, setPoolSearch] = useState('');
  const [poolCatalog, setPoolCatalog] = useState<PoolProduct[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
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
        { headers },
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

  const loadBoxDetail = useCallback(
    async (boxId: string) => {
      const headers = authHeaders();
      if (!headers) return;
      setItemsLoading(true);
      try {
        const res = await fetch(`${functionsBase}/admin-gift-boxes?id=${encodeURIComponent(boxId)}`, { headers });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load box');
        setBoxItems(json.data?.items || []);
      } catch (err) {
        notification.error(err instanceof Error ? err.message : 'Failed to load items');
      } finally {
        setItemsLoading(false);
      }
    },
    [authHeaders, notification],
  );

  useEffect(() => {
    loadHubs().catch((err) => notification.error(err.message));
  }, [loadHubs, notification]);

  useEffect(() => {
    if (selectedHubId) loadBoxes();
  }, [selectedHubId, loadBoxes]);

  useEffect(() => {
    if (selectedBox) loadBoxDetail(selectedBox.id);
    else setBoxItems([]);
  }, [selectedBox, loadBoxDetail]);

  const loadPoolCatalog = useCallback(async () => {
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
      setPoolCatalog(normalizePoolPickerItems(json.data || []));
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load pool');
      setPoolCatalog([]);
    } finally {
      setPoolLoading(false);
    }
  }, [authHeaders, notification, selectedHubId]);

  useEffect(() => {
    if (selectedHubId) loadPoolCatalog();
  }, [selectedHubId, loadPoolCatalog]);

  useEffect(() => {
    if (addItemOpen) loadPoolCatalog();
  }, [addItemOpen, loadPoolCatalog]);

  const boxProductIds = useMemo(() => boxItems.map((i) => i.product_id), [boxItems]);

  const poolResults = useMemo(
    () => filterPoolPickerItems(poolCatalog, poolSearch, boxProductIds),
    [poolCatalog, poolSearch, boxProductIds],
  );

  const slugPreview = giftBoxSlugPreview(boxForm.name);

  const refresh = async () => {
    await loadHubs();
    await loadBoxes();
    if (selectedBox) await loadBoxDetail(selectedBox.id);
  };

  const openCreate = () => {
    setEditingBox(null);
    setBoxForm(emptyBoxForm);
    setShowOptionalFields(false);
    setFormOpen(true);
  };

  const openEdit = (box: GiftBox) => {
    setEditingBox(box);
    setBoxForm({
      name: box.name,
      slug: box.slug,
      description: box.description || '',
      image_url: box.image_url || '',
      gallery_urls: box.gallery_urls || [],
      list_price: String(box.list_price),
      sort_order: String(box.sort_order),
      active: box.active,
      occasion_types: box.occasion_types || [],
      recipient_types: box.recipient_types || [],
    });
    setFormOpen(true);
    setSelectedBox(null);
  };

  const saveBox = async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    if (!boxForm.name.trim()) {
      notification.error('Box name is required');
      return;
    }
    if (!boxForm.list_price || Number(boxForm.list_price) < 0) {
      notification.error('List price is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...boxForm,
        slug: editingBox ? boxForm.slug : slugPreview,
        list_price: Number(boxForm.list_price),
        sort_order: Number(boxForm.sort_order) || 0,
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
      setFormOpen(false);
      setEditingBox(null);
      await loadBoxes();
      if (json.data?.id) {
        const created = (json.data as GiftBox) || boxes.find((b) => b.id === json.data.id);
        if (created) setSelectedBox(created);
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const addItem = async (product: PoolProduct) => {
    const headers = authHeaders();
    if (!headers || !selectedBox) return;
    const qty = Math.max(1, Number(addQty) || 1);
    const cost =
      addCost !== ''
        ? Number(addCost)
        : product.gift_program_cost != null
          ? Number(product.gift_program_cost)
          : null;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'add_item',
          gift_box_id: selectedBox.id,
          product_id: product.id,
          quantity: qty,
          component_cost: cost,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Add failed');
      notification.success(`Added ${product.name}`);
      await loadBoxDetail(selectedBox.id);
      setAddItemOpen(false);
      setPoolSearch('');
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Add failed');
    }
  };

  const removeItem = async (itemId: string) => {
    const headers = authHeaders();
    if (!headers || !selectedBox) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'remove_item', item_id: itemId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Remove failed');
      notification.success('Item removed');
      await loadBoxDetail(selectedBox.id);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Remove failed');
    }
  };

  const deactivateBox = async (box: GiftBox) => {
    const headers = authHeaders();
    if (!headers) return;
    if (!confirm(`Deactivate "${box.name}"? It will be hidden from the gift shop.`)) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes?id=${encodeURIComponent(box.id)}`, {
        method: 'PATCH',
        headers,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success('Box deactivated');
      setSelectedBox(null);
      await loadBoxes();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const reactivateBox = async (box: GiftBox) => {
    const headers = authHeaders();
    if (!headers) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes?id=${encodeURIComponent(box.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ active: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success('Box reactivated');
      setSelectedBox({ ...box, active: true });
      await loadBoxes();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  const deleteBox = async (box: GiftBox) => {
    const headers = authHeaders();
    if (!headers) return;
    if (
      !confirm(
        `Permanently delete "${box.name}"? This cannot be undone. Only for test boxes with no orders.`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes?id=${encodeURIComponent(box.id)}`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      notification.success('Box deleted');
      setSelectedBox(null);
      await loadBoxes();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const componentTotal = boxItems.reduce(
    (s, i) => s + Number(i.component_cost || 0) * i.quantity,
    0,
  );

  return (
    <>
      <PullToRefresh onRefresh={refresh}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Gift className="h-5 w-5 text-primary-600" />
                  <h1 className="text-lg font-bold text-gray-900">Gift Boxes</h1>
                </div>
                <p className="text-xs text-gray-500">Ready-made Mode A boxes per hub</p>
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

            <Field label="Hub">
              <select
                value={selectedHubId}
                onChange={(e) => {
                  setSelectedHubId(e.target.value);
                  setSelectedBox(null);
                }}
                className={inputCls}
              >
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : boxes.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <Package className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No boxes for this hub</p>
                <button type="button" onClick={openCreate} className="mt-3 text-sm font-semibold text-primary-600">
                  Create first box
                </button>
              </div>
            ) : (
              boxes.map((box) => (
                <button
                  key={box.id}
                  type="button"
                  onClick={() => setSelectedBox(box)}
                  className={`flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50 ${!box.active ? 'opacity-60' : ''}`}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold text-gray-900">{box.name}</p>
                      {!box.active && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      /{box.slug} · {formatNaira(Number(box.list_price))}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!selectedBox} onClose={() => setSelectedBox(null)} ariaLabel="Gift box details">
        {selectedBox && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedBox.name}</h2>
                <p className="text-sm text-gray-500">/{selectedBox.slug}</p>
              </div>
              <button
                type="button"
                onClick={() => openEdit(selectedBox)}
                className="rounded-lg p-2 text-gray-500 active:bg-gray-100"
                aria-label="Edit box"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-gray-600">
              List {formatNaira(Number(selectedBox.list_price))} · components{' '}
              {formatNaira(componentTotal)} · margin{' '}
              {formatNaira(Number(selectedBox.list_price) - componentTotal)}
            </p>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Contents ({boxItems.length})</p>
                <button
                  type="button"
                  onClick={() => setAddItemOpen(true)}
                  className="text-xs font-semibold text-primary-600"
                >
                  + Add from pool
                </button>
              </div>
              {itemsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader className="h-5 w-5 animate-spin text-primary-600" />
                </div>
              ) : boxItems.length === 0 ? (
                <p className="text-sm text-gray-500">No items yet.</p>
              ) : (
                <ul className="space-y-2">
                  {boxItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.products?.name || item.product_id}</p>
                        <p className="text-xs text-gray-500">
                          Qty {item.quantity}
                          {item.component_cost != null ? ` · ${formatNaira(Number(item.component_cost))}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="shrink-0 p-1.5 text-red-600"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {selectedBox.active ? (
              <button
                type="button"
                onClick={() => deactivateBox(selectedBox)}
                className="w-full rounded-2xl bg-red-50 py-3 text-sm font-semibold text-red-700"
              >
                Deactivate box
              </button>
            ) : (
              <button
                type="button"
                onClick={() => reactivateBox(selectedBox)}
                className="w-full rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white"
              >
                Reactivate box
              </button>
            )}
            <button
              type="button"
              onClick={() => deleteBox(selectedBox)}
              className="w-full rounded-2xl border border-red-200 py-3 text-sm font-semibold text-red-800"
            >
              Delete permanently
            </button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingBox(null);
        }}
        ariaLabel="Gift box form"
      >
        <h2 className="text-lg font-bold text-gray-900">{editingBox ? 'Edit box' : 'New gift box'}</h2>
        <p className="text-xs text-gray-500">
          {editingBox ? 'Update name, price, and tags.' : 'We auto-create the shop URL from the name.'}
        </p>
        <div className="max-h-[62vh] space-y-3 overflow-y-auto">
          <Field label="Box name *">
            <input
              value={boxForm.name}
              onChange={(e) => setBoxForm({ ...boxForm, name: e.target.value })}
              placeholder="Birthday Surprise Box"
              className={inputCls}
            />
            {!editingBox && boxForm.name.trim() ? (
              <p className="mt-1 text-[11px] text-gray-500 font-mono">/gifts/boxes/{slugPreview}</p>
            ) : null}
            {editingBox ? (
              <p className="mt-1 text-[11px] text-gray-500 font-mono">/{boxForm.slug}</p>
            ) : null}
          </Field>
          <Field label="Customer price ₦ *">
            <input
              value={boxForm.list_price}
              onChange={(e) => setBoxForm({ ...boxForm, list_price: e.target.value })}
              className={inputCls}
              inputMode="numeric"
              placeholder="15000"
            />
          </Field>
          <Field label="Short description">
            <textarea
              value={boxForm.description}
              onChange={(e) => setBoxForm({ ...boxForm, description: e.target.value })}
              rows={2}
              className={inputCls}
              placeholder="What makes this box special?"
            />
          </Field>
          <GiftBoxImageFields
            coverUrl={boxForm.image_url}
            galleryUrls={boxForm.gallery_urls}
            onCoverChange={(url) => setBoxForm({ ...boxForm, image_url: url })}
            onGalleryChange={(urls) => setBoxForm({ ...boxForm, gallery_urls: urls })}
            onError={(msg) => notification.error('Image upload failed', msg)}
          />
          <button
            type="button"
            className="text-xs text-gray-500 underline"
            onClick={() => setShowOptionalFields((v) => !v)}
          >
            {showOptionalFields ? 'Hide sort order' : 'Sort order (optional)'}
          </button>
          {showOptionalFields && (
            <Field label="Sort order">
              <input
                value={boxForm.sort_order}
                onChange={(e) => setBoxForm({ ...boxForm, sort_order: e.target.value })}
                className={inputCls}
                inputMode="numeric"
              />
            </Field>
          )}
          <Field label="Occasions">
            <div className="flex flex-wrap gap-2">
              {GIFT_OCCASION_TAGS.map((t) => {
                const checked = boxForm.occasion_types.includes(t.slug);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => {
                      const next = checked
                        ? boxForm.occasion_types.filter((s) => s !== t.slug)
                        : [...boxForm.occasion_types, t.slug];
                      setBoxForm({ ...boxForm, occasion_types: next });
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      checked ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Recipients">
            <div className="flex flex-wrap gap-2">
              {GIFT_RECIPIENT_TAGS.map((t) => {
                const checked = boxForm.recipient_types.includes(t.slug);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => {
                      const next = checked
                        ? boxForm.recipient_types.filter((s) => s !== t.slug)
                        : [...boxForm.recipient_types, t.slug];
                      setBoxForm({ ...boxForm, recipient_types: next });
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                      checked ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={saveBox}
          className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save box'}
        </button>
      </Sheet>

      <Sheet
        open={addItemOpen}
        onClose={() => {
          setAddItemOpen(false);
          setPoolSearch('');
        }}
        ariaLabel="Add box item"
      >
        <h2 className="text-lg font-bold text-gray-900">Add from gift pool</h2>
        <p className="text-xs text-gray-500">{poolCatalog.length} SKU(s) available at this hub</p>
        <div className="space-y-3">
          <Field label="Filter by name or SKU">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={poolSearch}
                onChange={(e) => setPoolSearch(e.target.value)}
                placeholder="Start typing to filter…"
                className={`${inputCls} pl-9`}
              />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Qty">
              <input value={addQty} onChange={(e) => setAddQty(e.target.value)} className={inputCls} inputMode="numeric" />
            </Field>
            <Field label="Cost ₦ (opt.)">
              <input
                value={addCost}
                onChange={(e) => setAddCost(e.target.value)}
                className={inputCls}
                inputMode="numeric"
                placeholder="Pool cost"
              />
            </Field>
          </div>
          {poolLoading ? (
            <div className="flex justify-center py-8">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : poolCatalog.length === 0 ? (
            <p className="rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-800 ring-1 ring-amber-100">
              No pool SKUs yet. Add products under Gift Hubs &amp; Pool first.
            </p>
          ) : poolResults.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              {poolSearch.trim()
                ? 'No matches — try another name or SKU.'
                : 'All pool items are already in this box.'}
            </p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {poolResults.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm ring-1 ring-gray-100"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-gray-500">
                      {p.sku ? p.sku : 'No SKU'}
                      {p.available_qty != null ? ` · ${p.available_qty} avail.` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addItem(p)}
                    className="shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>
    </>
  );
}
