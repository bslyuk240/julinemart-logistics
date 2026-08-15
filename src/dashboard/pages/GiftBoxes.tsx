import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gift,
  Plus,
  Package,
  Trash2,
  Pencil,
  ChevronDown,
  Search,
  Loader2,
  CheckCircle2,
  Circle,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { GIFT_OCCASION_TAGS, GIFT_RECIPIENT_TAGS } from '../lib/giftDiscoveryTags';
import {
  filterPoolPickerItems,
  giftBoxSlugPreview,
  buildGiftBoxSkuPrefix,
  normalizePoolPickerItems,
  normalizeSourcedPickerItems,
  computeGiftCustomerPrice,
  catalogDisplayPrice,
  type PoolPickerProduct,
  type GiftCommercialSettings,
} from '../lib/giftBoxHelpers';
import GiftBoxImageFields from '../components/GiftBoxImageFields';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

function resolveShopPreviewBase(): string {
  const env = (import.meta.env.VITE_PWA_BASE_URL as string | undefined)?.replace(/\/$/, '');
  if (env) return env;
  if (typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    return 'http://localhost:3000';
  }
  return 'https://julinemart.com';
}

function isLocalAdminHost(): boolean {
  return typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname);
}

type GiftHub = { id: string; name: string; code: string; is_default: boolean };

type GiftBox = {
  id: string;
  slug: string;
  sku?: string;
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
  product_id: string | null;
  pool_sourced_item_id?: string | null;
  line_source?: string;
  quantity: number;
  component_cost: number | null;
  vendor_payout_status?: string;
  products?: {
    id: string;
    name: string;
    sku?: string;
    gift_eligible?: boolean;
    regular_price?: number | null;
    sale_price?: number | null;
  } | null;
  gift_pool_sourced_items?: { id: string; name: string; sku?: string | null; gift_program_cost?: number } | null;
};

type PoolProduct = PoolPickerProduct;

const emptyBoxForm = {
  name: '',
  slug: '',
  sku: '',
  description: '',
  image_url: '',
  gallery_urls: [] as string[],
  list_price: '',
  sort_order: '0',
  active: true,
  occasion_types: [] as string[],
  recipient_types: [] as string[],
};

function boxItemUnitCost(item: BoxItem): number {
  if (item.component_cost != null && Number.isFinite(Number(item.component_cost))) {
    return Number(item.component_cost);
  }
  if (item.gift_pool_sourced_items?.gift_program_cost != null) {
    return Number(item.gift_pool_sourced_items.gift_program_cost);
  }
  return catalogDisplayPrice(item.products) || 0;
}

function boxItemName(item: BoxItem): string {
  return item.gift_pool_sourced_items?.name || item.products?.name || item.product_id || 'Item';
}

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
  const [poolCatalog, setPoolCatalog] = useState<PoolProduct[]>([]);
  const [poolLoading, setPoolLoading] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [addQty, setAddQty] = useState('1');
  const [addCost, setAddCost] = useState('');
  const [skuGenBusy, setSkuGenBusy] = useState(false);
  const [addPreSettled, setAddPreSettled] = useState(false);
  const [commercial, setCommercial] = useState<GiftCommercialSettings>({
    packaging_markup: 500,
    profit_margin_percent: 15,
    profit_margin_fixed: 0,
  });
  const [priceApplyBusy, setPriceApplyBusy] = useState(false);

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

  const loadPoolCatalog = useCallback(async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    setPoolLoading(true);
    try {
      const [poolRes, sourcedRes, commercialRes] = await Promise.all([
        fetch(`${functionsBase}/admin-gift-pool?gfc_id=${encodeURIComponent(selectedHubId)}`, { headers }),
        fetch(`${functionsBase}/admin-gift-pool-sourced?gfc_id=${encodeURIComponent(selectedHubId)}`, { headers }),
        fetch(`${functionsBase}/admin-gift-commercial-settings?gfc_id=${encodeURIComponent(selectedHubId)}`, { headers }),
      ]);
      const poolJson = await poolRes.json();
      if (!poolRes.ok) throw new Error(poolJson.error || 'Failed to load pool');
      const sourcedJson = sourcedRes.ok ? await sourcedRes.json() : { data: [] };
      const commercialJson = commercialRes.ok ? await commercialRes.json() : { data: null };
      setPoolCatalog([
        ...normalizePoolPickerItems(poolJson.data || []),
        ...normalizeSourcedPickerItems(sourcedJson.data || []),
      ]);
      if (commercialJson.data) {
        setCommercial({
          packaging_markup: Number(commercialJson.data.packaging_markup ?? 500),
          profit_margin_percent: Number(commercialJson.data.profit_margin_percent ?? 15),
          profit_margin_fixed: Number(commercialJson.data.profit_margin_fixed ?? 0),
        });
      }
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

  const boxPickerKeys = useMemo(
    () =>
      boxItems
        .map((i) => i.pool_sourced_item_id || i.product_id)
        .filter((id): id is string => Boolean(id)),
    [boxItems],
  );

  const poolResults = useMemo(
    () => filterPoolPickerItems(poolCatalog, poolSearch, boxPickerKeys),
    [poolCatalog, poolSearch, boxPickerKeys],
  );

  const slugPreview = giftBoxSlugPreview(boxForm.name);
  const skuPrefixPreview = buildGiftBoxSkuPrefix(boxForm.occasion_types, boxForm.recipient_types);

  const handleGenerateBoxSku = async () => {
    const headers = authHeaders();
    if (!headers) return;
    setSkuGenBusy(true);
    try {
      const prefix = buildGiftBoxSkuPrefix(boxForm.occasion_types, boxForm.recipient_types);
      const extra = boxForm.sku.trim() ? [boxForm.sku.trim()] : [];
      const res = await fetch(`${functionsBase}/product-sku-next`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prefix, extra_skus: extra }),
      });
      const raw = await res.text();
      let json: { success?: boolean; error?: string; data?: { next_sku?: string } };
      try {
        json = JSON.parse(raw);
      } catch {
        throw new Error(raw.slice(0, 120) || 'Could not generate SKU');
      }
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not generate SKU');
      const nextSku = json.data?.next_sku;
      if (!nextSku) throw new Error('Server did not return a SKU');
      setBoxForm({ ...boxForm, sku: nextSku });
    } catch (err) {
      notification.error('Generate SKU', err instanceof Error ? err.message : 'Failed');
    } finally {
      setSkuGenBusy(false);
    }
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
    try {
      const payload = {
        ...boxForm,
        slug: editingBox ? boxForm.slug : slugPreview,
        sku: boxForm.sku.trim() ? boxForm.sku.trim().toUpperCase() : undefined,
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
      setShowBoxForm(false);
      setEditingBox(null);
      setBoxForm(emptyBoxForm);
      await loadBoxes();
      if (json.data?.id) setSelectedBoxId(json.data.id);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const addItem = async (product: PoolProduct) => {
    const headers = authHeaders();
    if (!headers || !selectedBoxId) return;
    const qty = Math.max(1, Number(addQty) || 1);
    const cost =
      addCost !== ''
        ? Number(addCost)
        : product.gift_program_cost != null
          ? Number(product.gift_program_cost)
          : null;
    const isSourced = product.line_source === 'jlo_sourced';
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'add_item',
          gift_box_id: selectedBoxId,
          product_id: isSourced ? undefined : product.id,
          pool_sourced_item_id: isSourced ? product.id : undefined,
          quantity: qty,
          component_cost: cost,
          vendor_payout_status: addPreSettled ? 'pre_settled' : 'pending',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Add failed');
      notification.success(`Added ${product.name}`);
      await loadBoxDetail(selectedBoxId);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Add failed');
    }
  };

  const toggleItemPayout = async (item: BoxItem) => {
    const headers = authHeaders();
    if (!headers || !selectedBoxId) return;
    const next = item.vendor_payout_status === 'pre_settled' ? 'pending' : 'pre_settled';
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'update_item',
          item_id: item.id,
          vendor_payout_status: next,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');
      await loadBoxDetail(selectedBoxId);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Update failed');
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
      if (selectedBoxId === box.id) setSelectedBoxId(null);
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
        `Permanently delete "${box.name}"? This cannot be undone. Only use for test boxes with no orders.`,
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
      if (selectedBoxId === box.id) setSelectedBoxId(null);
      await loadBoxes();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const selectedBox = boxes.find((b) => b.id === selectedBoxId) || null;
  const componentTotal = boxItems.reduce((s, i) => s + boxItemUnitCost(i) * i.quantity, 0);
  const suggestedListPrice = computeGiftCustomerPrice(componentTotal, commercial);

  const applySuggestedPrice = async () => {
    const headers = authHeaders();
    if (!headers || !selectedBox) return;
    setPriceApplyBusy(true);
    try {
      const res = await fetch(`${functionsBase}/admin-gift-boxes?id=${encodeURIComponent(selectedBox.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ list_price: suggestedListPrice }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not set customer price');
      notification.success('Customer price set', `₦${suggestedListPrice.toLocaleString()} from items + hub markup`);
      await loadBoxes();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Could not set customer price');
    } finally {
      setPriceApplyBusy(false);
    }
  };

  const hasItems = boxItems.length > 0;
  const hasTags =
    (selectedBox?.occasion_types?.length ?? 0) > 0 ||
    (selectedBox?.recipient_types?.length ?? 0) > 0;
  const isShopLive = Boolean(selectedBox?.active && hasItems);
  const shopPreviewBase = useMemo(() => resolveShopPreviewBase(), []);
  const localAdmin = useMemo(() => isLocalAdminHost(), []);
  const productionGiftsDeployed = shopPreviewBase.includes('julinemart.com') && !localAdmin;

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
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
            setShowOptionalFields(false);
            setShowBoxForm(true);
          }}
        >
          <Plus className="w-4 h-4" /> New box
        </button>
      </div>

      {showBoxForm && (
        <div className="bg-white border rounded-xl p-4 mb-6 space-y-4">
          <div>
            <h2 className="font-semibold">{editingBox ? 'Edit box' : 'Create gift box'}</h2>
            <p className="text-xs text-gray-500 mt-1">
              {editingBox
                ? 'Update details and discovery tags. URL slug stays fixed after publish.'
                : 'Name your box and set the customer price — we handle the shop URL.'}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="text-xs font-medium text-gray-600">Box name *</span>
              <input
                className="mt-1 border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="e.g. Birthday Surprise Box"
                value={boxForm.name}
                onChange={(e) => setBoxForm({ ...boxForm, name: e.target.value })}
              />
              {!editingBox && boxForm.name.trim() && (
                <p className="mt-1 text-xs text-gray-500">
                  Shop link: <span className="font-mono text-primary-700">/gifts/boxes/{slugPreview}</span>
                </p>
              )}
              {editingBox && (
                <p className="mt-1 text-xs text-gray-500 font-mono">/{boxForm.slug}</p>
              )}
            </label>

            <label className="block md:col-span-2">
              <span className="text-xs font-medium text-gray-600">SKU</span>
              <div className="mt-1 flex gap-2">
                <input
                  className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-sm font-mono uppercase"
                  placeholder={`${skuPrefixPreview}001`}
                  value={boxForm.sku}
                  onChange={(e) => setBoxForm({ ...boxForm, sku: e.target.value.toUpperCase() })}
                />
                <button
                  type="button"
                  onClick={() => void handleGenerateBoxSku()}
                  disabled={skuGenBusy}
                  className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                  {skuGenBusy ? 'Working…' : 'Generate SKU'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Unique gift box ID (format GBX-occasion-recipient-###). Pick occasion/recipient tags first, then generate. Vouchers use this to match promos.
              </p>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-gray-600">Customer price (₦) *</span>
              <input
                className="mt-1 border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="After items + markup"
                inputMode="numeric"
                value={boxForm.list_price}
                onChange={(e) => setBoxForm({ ...boxForm, list_price: e.target.value })}
              />
              <p className="mt-1 text-xs text-gray-500">
                What the customer pays. After you add items, use “Set customer price from items + markup” on the box — same hub packaging markup and profit % as BYO.
              </p>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Short description</span>
            <textarea
              className="mt-1 border rounded-lg px-3 py-2 text-sm w-full"
              placeholder="What makes this box special?"
              rows={2}
              value={boxForm.description}
              onChange={(e) => setBoxForm({ ...boxForm, description: e.target.value })}
            />
          </label>

          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Occasions</p>
            <div className="flex flex-wrap gap-2">
              {GIFT_OCCASION_TAGS.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => {
                    const checked = boxForm.occasion_types.includes(t.slug);
                    const next = checked
                      ? boxForm.occasion_types.filter((s) => s !== t.slug)
                      : [...boxForm.occasion_types, t.slug];
                    setBoxForm({ ...boxForm, occasion_types: next });
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    boxForm.occasion_types.includes(t.slug)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Recipients</p>
            <div className="flex flex-wrap gap-2">
              {GIFT_RECIPIENT_TAGS.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => {
                    const checked = boxForm.recipient_types.includes(t.slug);
                    const next = checked
                      ? boxForm.recipient_types.filter((s) => s !== t.slug)
                      : [...boxForm.recipient_types, t.slug];
                    setBoxForm({ ...boxForm, recipient_types: next });
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    boxForm.recipient_types.includes(t.slug)
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

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
            <label className="block max-w-xs">
              <span className="text-xs font-medium text-gray-600">Sort order</span>
              <input
                className="mt-1 border rounded-lg px-3 py-2 text-sm w-full"
                placeholder="0"
                value={boxForm.sort_order}
                onChange={(e) => setBoxForm({ ...boxForm, sort_order: e.target.value })}
              />
            </label>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm" onClick={saveBox}>
              {editingBox ? 'Save changes' : 'Create box'}
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

      <div className="grid xl:grid-cols-[minmax(280px,360px)_1fr] gap-6">
        <div className="bg-white border rounded-xl overflow-hidden h-fit">
          <div className="px-4 py-3 border-b font-medium">Boxes</div>
          {loading ? (
            <p className="p-4 text-sm text-gray-500">Loading…</p>
          ) : boxes.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No boxes yet for this hub.</p>
          ) : (
            <ul className="divide-y">
              {boxes.map((box) => (
                <li key={box.id} className={!box.active ? 'opacity-60' : undefined}>
                  <button
                    type="button"
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-2 ${selectedBoxId === box.id ? 'bg-primary-50' : ''}`}
                    onClick={() => setSelectedBoxId(box.id)}
                  >
                    <div>
                      <p className="font-medium text-sm">{box.name}</p>
                      <p className="text-xs text-gray-500">
                        /{box.slug} · {box.sku ? `${box.sku} · ` : ''}₦{Number(box.list_price).toLocaleString()}
                        {!box.active && <span className="ml-2 text-red-600">Inactive</span>}
                      </p>
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
                          sku: box.sku || '',
                          description: box.description || '',
                          image_url: box.image_url || '',
                          gallery_urls: box.gallery_urls || [],
                          list_price: String(box.list_price),
                          sort_order: String(box.sort_order),
                          active: box.active,
                          occasion_types: box.occasion_types || [],
                          recipient_types: box.recipient_types || [],
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

        <div className="bg-white border rounded-xl overflow-hidden min-h-[420px]">
          <div className="px-4 py-3 border-b font-medium flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Package className="w-4 h-4 shrink-0" />
              <span className="truncate">{selectedBox ? selectedBox.name : 'Select a box'}</span>
            </div>
            {selectedBox && (
              <button
                type="button"
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:text-primary-900"
                onClick={() => {
                  setEditingBox(selectedBox);
                  setBoxForm({
                    name: selectedBox.name,
                    slug: selectedBox.slug,
                    sku: selectedBox.sku || '',
                    description: selectedBox.description || '',
                    image_url: selectedBox.image_url || '',
                    gallery_urls: selectedBox.gallery_urls || [],
                    list_price: String(selectedBox.list_price),
                    sort_order: String(selectedBox.sort_order),
                    active: selectedBox.active,
                    occasion_types: selectedBox.occasion_types || [],
                    recipient_types: selectedBox.recipient_types || [],
                  });
                  setShowBoxForm(true);
                }}
              >
                <Pencil className="w-3.5 h-3.5" /> Edit details
              </button>
            )}
          </div>
          {!selectedBox ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <Package className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="font-medium text-gray-700">Select a box from the list</p>
              <p className="mt-1">Then add pool products — it appears on the gift shop automatically when active.</p>
            </div>
          ) : (
            <div className="p-4 md:p-5 space-y-5">
              {/* Publish checklist */}
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
                <p className="text-sm font-semibold text-gray-900">Ready for the gift shop?</p>
                <ul className="space-y-1.5 text-sm">
                  <ChecklistItem done={hasItems} label="At least one pool item in the box" />
                  <ChecklistItem done={hasTags} label="Occasion or recipient tags set (edit box)" />
                  <ChecklistItem done={selectedBox.active} label="Box is active" />
                </ul>
                {isShopLive ? (
                  <div className="mt-3 pt-3 border-t border-gray-200 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ready in admin
                      </span>
                      <a
                        href={`${shopPreviewBase}/gifts/boxes/${selectedBox.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-900"
                      >
                        {localAdmin ? 'Preview locally' : 'Preview on JulineMart'}{' '}
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                    {localAdmin ? (
                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
                        <strong>julinemart.com will 404 for now</strong> — Gifts is not deployed to production yet.
                        Preview locally: run PWA on <span className="font-mono">:3000</span> with{' '}
                        <span className="font-mono">JLO_API_BASE_URL=http://localhost:8888</span>, then use the link above.
                      </p>
                    ) : productionGiftsDeployed ? (
                      <p className="text-xs text-gray-500">
                        If preview 404s, deploy <span className="font-mono">julinemart-pwa</span> gifts routes and JLO gift
                        functions to Netlify.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mt-2">
                    {!hasItems
                      ? 'Next: add products from the pool below.'
                      : !hasTags
                        ? 'Next: click Edit details and pick occasion/recipient tags.'
                        : 'Next: reactivate this box to show it on the shop.'}
                  </p>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-gray-900 mb-2">What&apos;s in this box</p>
                {boxItems.length > 0 && (
                  <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm space-y-1.5">
                    {boxItems.map((item) => (
                      <div key={`price-${item.id}`} className="flex justify-between gap-2 text-gray-700">
                        <span className="min-w-0 truncate">
                          {boxItemName(item)} × {item.quantity}
                          {item.line_source === 'jlo_sourced' ? (
                            <span className="ml-1 text-[10px] uppercase text-gray-400">sourced</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 font-medium">
                          ₦{(boxItemUnitCost(item) * item.quantity).toLocaleString()}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-gray-200 pt-1.5 font-medium text-gray-900">
                      <span>Item total</span>
                      <span>₦{componentTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>Packaging markup (hub)</span>
                      <span>₦{Number(commercial.packaging_markup).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-600">
                      <span>
                        Profit {Number(commercial.profit_margin_percent)}% + ₦
                        {Number(commercial.profit_margin_fixed).toLocaleString()}
                      </span>
                      <span>₦{(suggestedListPrice - componentTotal).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900">
                      <span>Suggested customer price</span>
                      <span>₦{suggestedListPrice.toLocaleString()}</span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Markup comes from this hub&apos;s BYO commercial settings. Change it under Gift Fulfilment
                      Centres → Pool.
                    </p>
                    <button
                      type="button"
                      className="btn-primary btn-sm mt-1"
                      disabled={priceApplyBusy}
                      onClick={() => void applySuggestedPrice()}
                    >
                      {priceApplyBusy ? 'Saving…' : `Set customer price to ₦${suggestedListPrice.toLocaleString()}`}
                    </button>
                    {Number(selectedBox.list_price) !== suggestedListPrice && (
                      <p className="text-xs text-amber-800">
                        Current list price is ₦{Number(selectedBox.list_price).toLocaleString()} (not using the
                        suggested stack yet).
                      </p>
                    )}
                  </div>
                )}
                <p className="text-xs text-gray-600 mb-3">
                  List ₦{Number(selectedBox.list_price).toLocaleString()} · item cost ₦
                  {componentTotal.toLocaleString()} · margin ₦
                  {(Number(selectedBox.list_price) - componentTotal).toLocaleString()}
                </p>
              {itemsLoading ? (
                <p className="text-sm text-gray-500">Loading items…</p>
              ) : boxItems.length === 0 ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  No items yet — pick from the pool below. The box won&apos;t appear on /gifts until it has pool items.
                </p>
              ) : (
                <ul className="space-y-2">
                  {boxItems.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium">{boxItemName(item)}</p>
                        <p className="text-xs text-gray-500">
                          Qty {item.quantity} · ₦{boxItemUnitCost(item).toLocaleString()} each
                          {item.line_source === 'jlo_sourced' ? ' · sourced' : ''}
                          {item.vendor_payout_status === 'pre_settled' ? ' · pre-paid stock' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <label className="inline-flex items-center gap-1 text-xs text-gray-600">
                          {item.line_source !== 'jlo_sourced' && (
                            <>
                          <input
                            type="checkbox"
                            checked={item.vendor_payout_status === 'pre_settled'}
                            onChange={() => toggleItemPayout(item)}
                          />
                          Pre-paid
                            </>
                          )}
                        </label>
                        <button type="button" className="text-red-500" onClick={() => removeItem(item.id)}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              </div>

              <div className="border-t pt-5 space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">Add from gift pool</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Tap Add on each product — no separate save step. Items appear in the box list above instantly.
                  </p>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    className="border rounded-lg pl-9 pr-3 py-2 text-sm w-full"
                    placeholder="Filter by name or SKU…"
                    value={poolSearch}
                    onChange={(e) => setPoolSearch(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 text-xs text-gray-500">
                  <span>Default qty</span>
                  <input
                    className="border rounded-lg px-2 py-1 w-16 text-sm text-gray-900"
                    value={addQty}
                    onChange={(e) => setAddQty(e.target.value)}
                  />
                  <span className="ml-2">Override ₦ (optional)</span>
                  <input
                    className="border rounded-lg px-2 py-1 flex-1 text-sm text-gray-900"
                    placeholder="Blank = catalog / sourced price"
                    value={addCost}
                    onChange={(e) => setAddCost(e.target.value)}
                  />
                  <label className="inline-flex items-center gap-1.5 ml-2">
                    <input
                      type="checkbox"
                      checked={addPreSettled}
                      onChange={(e) => setAddPreSettled(e.target.checked)}
                    />
                    Pre-paid
                  </label>
                </div>
                {poolLoading ? (
                  <p className="text-sm text-gray-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading pool…
                  </p>
                ) : poolCatalog.length === 0 ? (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    No products in this hub&apos;s pool yet. Add SKUs under Gift Hubs &amp; Pool first.
                  </p>
                ) : poolResults.length === 0 ? (
                  <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-3 text-sm text-gray-600">
                    {poolSearch.trim()
                      ? 'No pool items match your filter.'
                      : hasItems ? (
                        <>
                          <p className="font-medium text-gray-800">All pool SKUs are in this box.</p>
                          <p className="text-xs mt-1">
                            You&apos;re done here — edit tags if needed, then preview on the shop when the checklist above is green.
                          </p>
                        </>
                      ) : (
                        'All pool items are already in this box, or the pool is empty.'
                      )}
                  </div>
                ) : (
                  <ul className="max-h-56 overflow-y-auto divide-y border rounded-lg">
                    {poolResults.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-gray-50">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{p.name}</p>
                          <p className="text-xs text-gray-500">
                            {p.sku ? `SKU ${p.sku}` : 'No SKU'}
                            {p.line_source === 'jlo_sourced' ? ' · sourced' : ''}
                            {p.available_qty != null ? ` · ${p.available_qty} in pool` : ''}
                            {p.gift_program_cost != null
                              ? ` · ₦${Number(p.gift_program_cost).toLocaleString()}`
                              : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-primary-600 text-xs font-semibold px-2 py-1 rounded-md hover:bg-primary-50"
                          onClick={() => addItem(p)}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-gray-400">{poolCatalog.length} SKU(s) in hub pool</p>
              </div>

              <div className="border-t pt-5 mt-2 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Box actions</p>
                <div className="flex flex-wrap gap-2">
                  {selectedBox.active ? (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg text-sm font-medium border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                      onClick={() => deactivateBox(selectedBox)}
                    >
                      Deactivate (hide from shop)
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700"
                      onClick={() => reactivateBox(selectedBox)}
                    >
                      Reactivate on shop
                    </button>
                  )}
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-700 hover:bg-red-50"
                    onClick={() => deleteBox(selectedBox)}
                  >
                    Delete permanently
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Deactivate hides the box from customers. Delete only for test boxes with no orders.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${done ? 'text-gray-700' : 'text-gray-500'}`}>
      {done ? (
        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
      ) : (
        <Circle className="w-4 h-4 shrink-0 text-gray-300" />
      )}
      <span>{label}</span>
    </li>
  );
}
