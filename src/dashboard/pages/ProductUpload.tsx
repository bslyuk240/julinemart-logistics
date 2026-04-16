/**
 * Product Upload / Edit
 *
 * Create or edit a product directly in Supabase.
 * Supports simple products and variable products with full attribute/variation manager.
 * Accessible by: admin, shop_manager, agents with catalog_access.
 *
 * Route: /admin/products/upload          (new)
 *        /admin/products/upload?id=<uuid> (edit)
 *
 * Variation actions:
 * - Generate Variations: builds the full cartesian matrix from attributes; merges existing rows
 *   by attribute signature (keeps SKU, prices, image per combination) and adds empty rows for new combos.
 * - Realign rows: sets row i’s label to option i (comma / matrix order). Table row order is unchanged;
 *   each row keeps its image/SKU. Use after reordering options so “first row = first option”.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronUp, ListOrdered, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import RichTextEditor from '../components/RichTextEditor';
import { clearProductListSessionCache } from '../lib/productListSessionCache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VendorOption { id: string; store_name: string; store_slug: string }
interface HubOption    { id: string; name: string; code: string }
interface CatOption    { id: string; name: string; slug: string; parent_id: string | null }
interface TagOption    { id: string; name: string; slug: string }

interface ImageRow {
  src: string;
  alt: string;
  position: number;
  is_thumbnail: boolean;
}

// Attribute row in the builder (before generating variations)
interface VarAttr {
  name: string;
  optionsRaw: string; // comma-separated input value
  is_variation: boolean;
}

// A single variation row
interface VarRow {
  id?: string; // set when editing existing variation
  attributes: { name: string; value: string }[];
  sku: string;
  regular_price: string;
  sale_price: string;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  manage_stock: boolean;
  stock_quantity: string;
  image_url: string;
}

interface FormState {
  name: string;
  slug: string;
  short_description: string;
  description: string;
  status: 'draft' | 'published';
  type: 'simple' | 'variable';
  regular_price: string;
  sale_price: string;
  sku: string;
  manage_stock: boolean;
  stock_quantity: string;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  is_virtual: boolean;
  ships_from_abroad: boolean;
  vendor_id: string;
  hub_id: string;
  seo_title: string;
  seo_description: string;
  /** Product weight in kg (shipping). */
  weight: string;
  /** Package length / width / height in cm. */
  length: string;
  width: string;
  height: string;
  category_ids: string[];
  tag_ids: string[];
  images: ImageRow[];
}

const EMPTY_FORM: FormState = {
  name: '', slug: '', short_description: '', description: '',
  status: 'draft', type: 'simple',
  regular_price: '', sale_price: '', sku: '',
  manage_stock: false, stock_quantity: '', stock_status: 'instock',
  is_virtual: false, ships_from_abroad: false,
  vendor_id: '', hub_id: '',
  seo_title: '', seo_description: '',
  weight: '', length: '', width: '', height: '',
  category_ids: [], tag_ids: [], images: [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Parse optional dimension/weight field: empty → null, invalid → null. */
function toNullableDim(value: string): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Stable key for matching rows to matrix combos (Generate / sort on load).
 * Normalizes like catalog-product `variationStableSortKey` so "White" matches option "white"
 * and trimming differences do not leave rows unsorted (images then disagree with option order).
 */
function attrSignature(attrs: { name: string; value: string }[]): string {
  return attrs
    .map((a) => {
      const name = String(a.name ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      const value = String(a.value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      return `${name}::${value}`;
    })
    .filter((pair) => pair !== '::')
    .sort()
    .join('||');
}

/** True if variation has at least one non-empty name/value pair (Supabase may return []). */
function hasMeaningfulAttributes(attrs: { name: string; value: string }[] | undefined): boolean {
  if (!Array.isArray(attrs) || attrs.length === 0) return false;
  return attrs.some((a) => String(a.name ?? '').trim() && String(a.value ?? '').trim());
}

/**
 * Fill missing variation attributes from the cartesian matrix by row index (option list order).
 * Required when DB rows have empty attributes — Realign/sort cannot work until labels exist.
 */
function hydrateVariationAttributesFromMatrix(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  const combos = generateCombinations(varAttrs);
  if (combos.length === 0) return rows;
  return rows.map((row, i) => {
    if (hasMeaningfulAttributes(row.attributes)) return row;
    const fill = combos[i];
    if (!fill?.length) return row;
    return { ...row, attributes: fill.map((a) => ({ name: a.name, value: a.value })) };
  });
}

function generateCombinations(varAttrs: VarAttr[]): { name: string; value: string }[][] {
  const active = varAttrs
    .filter((a) => a.is_variation && a.name.trim() && a.optionsRaw.trim())
    .map((a) => ({
      name: a.name.trim(),
      values: a.optionsRaw.split(',').map((o) => o.trim()).filter(Boolean),
    }));

  if (active.length === 0) return [];

  return active.reduce<{ name: string; value: string }[][]>(
    (combos, attr) =>
      combos.flatMap((combo) => attr.values.map((v) => [...combo, { name: attr.name, value: v }])),
    [[]]
  );
}

/** Align variation rows with the same cartesian order used by "Generate variations" in the UI. */
function sortVariationsLikeMatrix(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  const combos = generateCombinations(varAttrs);
  if (combos.length === 0) return rows;
  const indexBySig = new Map(combos.map((c, i) => [attrSignature(c), i] as const));
  return rows.slice().sort((a, b) => {
    const ia = indexBySig.get(attrSignature(a.attributes));
    const ib = indexBySig.get(attrSignature(b.attributes));
    if (ia === undefined && ib === undefined) return 0;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}

/**
 * After loading from API: fill empty labels, then sort by matrix index (DB row order may differ).
 */
function realignVariationRowsOnLoad(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  return sortVariationsLikeMatrix(hydrateVariationAttributesFromMatrix(rows, varAttrs), varAttrs);
}

/**
 * Realign button: assign matrix combo **i** to **row i** in the current table order (comma / cartesian
 * order from the attribute fields). Does **not** re-sort rows by label — so row 1 stays row 1, and each
 * row keeps its image/SKU; only the **Option** labels update to match your option list order.
 * Use this when you reordered “Red, Blue” → “Blue, Red” and want row 1 = first option, row 2 = second.
 * If row count ≠ matrix size, falls back to hydrate + sort.
 */
function applyRealignFromOptionOrder(rows: VarRow[], varAttrs: VarAttr[]): VarRow[] {
  const combos = generateCombinations(varAttrs);
  if (combos.length === 0) return rows;
  if (rows.length !== combos.length) {
    return sortVariationsLikeMatrix(hydrateVariationAttributesFromMatrix(rows, varAttrs), varAttrs);
  }
  return rows.map((row, i) => ({
    ...row,
    attributes: combos[i].map((a) => ({ name: a.name, value: a.value })),
  }));
}

/** Minimal HTML entity decode for category names stored as `Baby &amp; Kids`. */
function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function skuCodeFromPrimarySegment(rawSeg: string, padSource: string, len = 3): string {
  const alnum = rawSeg.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let core = alnum.slice(0, len);
  if (core.length < len) {
    const pad = toSlug(padSource || 'x')
      .replace(/[^a-z0-9]/gi, '')
      .toUpperCase();
    core = (core + pad).slice(0, len);
  }
  return core.padEnd(len, 'X').slice(0, len);
}

/**
 * Category prefix: prefer the first word of the **name** (slugified).
 * Child Woo slugs often repeat the parent (`electronics-electronics-3` → would wrongly be ELE for every subcategory).
 */
function categorySkuCode(name: string, slug: string, len = 3): string {
  const clean = decodeBasicHtmlEntities(name || '');
  const nameSeg = toSlug(clean).split('-').filter(Boolean)[0] || '';
  const slugSeg = (slug || '').split('-').filter(Boolean)[0] || '';
  const raw = nameSeg || slugSeg || 'x';
  return skuCodeFromPrimarySegment(raw, clean || slug, len);
}

/** Vendor prefix: prefer **store_slug** first segment (stable store codes), then name. */
function vendorSkuCode(slug: string, name: string, len = 3): string {
  const slugSeg = (slug || '').split('-').filter(Boolean)[0] || '';
  const nameSeg = toSlug(decodeBasicHtmlEntities(name || '')).split('-').filter(Boolean)[0] || '';
  const raw = slugSeg || nameSeg || 'x';
  return skuCodeFromPrimarySegment(raw, name || slug, len);
}

/** Selected categories in tree order (parent block, then children) for a stable “primary” category. */
function orderedSelectedCategoryIds(allCategories: CatOption[], categoryIds: string[]): string[] {
  const sel = new Set(categoryIds);
  const out: string[] = [];
  const tops = allCategories.filter((c) => !c.parent_id);
  for (const t of tops) {
    if (sel.has(t.id)) out.push(t.id);
    for (const ch of allCategories.filter((c) => c.parent_id === t.id)) {
      if (sel.has(ch.id)) out.push(ch.id);
    }
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductUpload() {
  const { session } = useAuth();
  const notification = useNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const moderationListPath =
    (location.state as { returnTo?: string } | null)?.returnTo ?? '/admin/products/moderation';

  // Form state
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [varAttrs, setVarAttrs] = useState<VarAttr[]>([
    { name: '', optionsRaw: '', is_variation: true },
  ]);
  const [variations, setVariations] = useState<VarRow[]>([]);

  // Meta
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [allCategories, setAllCategories] = useState<CatOption[]>([]);
  const [allTags, setAllTags] = useState<TagOption[]>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVariationIdx, setUploadingVariationIdx] = useState<number | null>(null);
  /** Lightbox URL when user taps a variation thumbnail */
  const [variationImagePreviewUrl, setVariationImagePreviewUrl] = useState<string | null>(null);
  const slugEditedManually = useRef(false);

  useEffect(() => {
    if (!variationImagePreviewUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVariationImagePreviewUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variationImagePreviewUrl]);

  // ── Image upload to Supabase Storage ─────────────────────────────────────────
  const uploadImageFile = async (file: File): Promise<string | null> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      notification.error('Upload failed', error.message);
      return null;
    }
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    const url = await uploadImageFile(file);
    setUploadingImage(false);
    e.target.value = '';
    if (!url) return;
    setForm((prev) => ({
      ...prev,
      images: [
        ...prev.images,
        { src: url, alt: '', position: prev.images.length, is_thumbnail: prev.images.length === 0 },
      ],
    }));
  };

  const handleVariationImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVariationIdx(idx);
    const url = await uploadImageFile(file);
    setUploadingVariationIdx(null);
    e.target.value = '';
    if (url) updateVariation(idx, 'image_url', url);
  };

  const authHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }), [session]);

  const [skuGenBusy, setSkuGenBusy] = useState(false);

  const resolveSkuPrefix = (): { prefix: string } | null => {
    if (!form.vendor_id) {
      notification.error('Generate SKU', 'Select a vendor first.');
      return null;
    }
    const ordered = orderedSelectedCategoryIds(allCategories, form.category_ids);
    const primaryCatId = ordered[0];
    if (!primaryCatId) {
      notification.error(
        'Generate SKU',
        'Select at least one category. The first category in the list (top-to-bottom, parent then child) sets the category code.'
      );
      return null;
    }
    const cat = allCategories.find((c) => c.id === primaryCatId);
    const ven = vendors.find((v) => v.id === form.vendor_id);
    if (!cat || !ven) {
      notification.error('Generate SKU', 'Could not resolve category or vendor.');
      return null;
    }
    const catCode = categorySkuCode(cat.name, cat.slug);
    const venCode = vendorSkuCode(ven.store_slug, ven.store_name);
    return { prefix: `${catCode}-${venCode}-` };
  };

  const suggestNextSkuRequest = async (prefix: string, extraSkus: string[]) => {
    const res = await fetch(`${apiBase}/.netlify/functions/product-sku-next`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prefix, extra_skus: extraSkus }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not compute next SKU');
    }
    return json.data?.next_sku as string;
  };

  const handleGenerateSimpleSku = async () => {
    const resolved = resolveSkuPrefix();
    if (!resolved) return;
    setSkuGenBusy(true);
    try {
      const extra_skus = form.sku.trim() ? [form.sku.trim()] : [];
      const nextSku = await suggestNextSkuRequest(resolved.prefix, extra_skus);
      set('sku', nextSku);
    } catch (e: unknown) {
      notification.error('Generate SKU', e instanceof Error ? e.message : 'Could not compute next SKU');
    } finally {
      setSkuGenBusy(false);
    }
  };

  const handleGenerateVariationSku = async (idx: number) => {
    const resolved = resolveSkuPrefix();
    if (!resolved) return;
    setSkuGenBusy(true);
    try {
      const extra_skus = variations
        .map((v, j) => (j === idx ? '' : v.sku))
        .map((s) => s.trim())
        .filter(Boolean);
      const nextSku = await suggestNextSkuRequest(resolved.prefix, extra_skus);
      updateVariation(idx, 'sku', nextSku);
    } catch (e: unknown) {
      notification.error('Generate SKU', e instanceof Error ? e.message : 'Could not compute next SKU');
    } finally {
      setSkuGenBusy(false);
    }
  };

  const handleGenerateEmptyVariationSkus = async () => {
    const resolved = resolveSkuPrefix();
    if (!resolved) return;
    const emptyIdx = variations.map((v, i) => (!v.sku.trim() ? i : -1)).filter((i) => i >= 0);
    if (emptyIdx.length === 0) {
      notification.error('Generate SKU', 'Every variation already has a SKU.');
      return;
    }
    setSkuGenBusy(true);
    try {
      const prefix = resolved.prefix;
      const baseline = variations.map((v) => v.sku.trim()).filter(Boolean);
      const assigned: string[] = [];
      for (let k = 0; k < emptyIdx.length; k++) {
        const nextSku = await suggestNextSkuRequest(prefix, [...baseline, ...assigned]);
        assigned.push(nextSku);
      }
      setVariations((prev) => {
        const nextRows = [...prev];
        emptyIdx.forEach((rowIdx, j) => {
          nextRows[rowIdx] = { ...nextRows[rowIdx], sku: assigned[j] };
        });
        return nextRows;
      });
    } catch (e: unknown) {
      notification.error('Generate SKU', e instanceof Error ? e.message : 'Could not compute next SKU');
    } finally {
      setSkuGenBusy(false);
    }
  };

  // ── Load meta ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const meta = (type: string) =>
          fetch(`${apiBase}/.netlify/functions/catalog-meta?type=${type}`, { headers: authHeaders() })
            .then((r) => r.json())
            .catch(() => ({ data: [] }));
        const [vData, hData, cData, tData] = await Promise.all([
          meta('vendors'), meta('hubs'), meta('categories'), meta('tags'),
        ]);
        setVendors(vData.data || []);
        setHubs(hData.data || []);
        setAllCategories(cData.data || []);
        setAllTags(tData.data || []);
      } finally {
        setLoadingMeta(false);
      }
    };
    load();
  }, [apiBase, authHeaders]);

  // ── Load product for edit ────────────────────────────────────────────────────
  useEffect(() => {
    if (!editId) return;
    const load = async () => {
      const res = await fetch(`${apiBase}/.netlify/functions/catalog-product?id=${editId}`);
      const json = await res.json();
      if (!json.success || !json.data) return;
      const p = json.data;

      setForm({
        name: p.name || '',
        slug: p.slug || '',
        short_description: p.short_description || '',
        description: p.description || '',
        status: p.status || 'draft',
        type: p.type || 'simple',
        regular_price: p.regular_price != null ? String(p.regular_price) : '',
        sale_price: p.sale_price != null ? String(p.sale_price) : '',
        sku: p.sku || '',
        manage_stock: !!p.manage_stock,
        stock_quantity: p.stock_quantity != null ? String(p.stock_quantity) : '',
        stock_status: p.stock_status || 'instock',
        is_virtual: !!p.is_virtual,
        ships_from_abroad: !!p.ships_from_abroad,
        vendor_id: p.vendor?.id || '',
        hub_id: p.hub?.id || '',
        seo_title: p.seo_title || '',
        seo_description: p.seo_description || '',
        weight: p.weight != null ? String(p.weight) : '',
        length: p.length != null ? String(p.length) : '',
        width: p.width != null ? String(p.width) : '',
        height: p.height != null ? String(p.height) : '',
        category_ids: (p.categories || []).map((c: any) => c.id),
        tag_ids: (p.tags || []).map((t: any) => t.id),
        images: (p.images || []).map((img: any) => ({
          src: img.src, alt: img.alt || '',
          position: img.position ?? 0, is_thumbnail: !!img.is_thumbnail,
        })),
      });

      // Populate variation attributes and rows
      if (p.type === 'variable') {
        const attrs: VarAttr[] = (p.attributes || []).map((a: any) => ({
          name: a.name || '',
          optionsRaw: (a.options || []).join(', '),
          is_variation: a.is_variation ?? true,
        }));
        const attrsForEditor =
          attrs.length > 0 ? attrs : [{ name: '', optionsRaw: '', is_variation: true }];
        setVarAttrs(attrsForEditor);

        const rows: VarRow[] = (p.variations || []).map((v: any) => ({
          id: v.id,
          // Normalize variation attributes to {name, value} for the editor.
          // Supabase may return [{name, value}] (import format) or
          // [{name, option}] (WC-mapped format from catalog-product).
          attributes: Array.isArray(v.attributes)
            ? v.attributes.map((a: any) => ({ name: a.name ?? '', value: a.value ?? a.option ?? '' }))
            : [],
          sku: v.sku || '',
          regular_price: v.regular_price != null ? String(v.regular_price) : '',
          sale_price: v.sale_price != null ? String(v.sale_price) : '',
          stock_status: v.stock_status || 'instock',
          manage_stock: !!v.manage_stock,
          stock_quantity: v.stock_quantity != null ? String(v.stock_quantity) : '',
          image_url: v.image?.src || '',
        }));
        setVariations(realignVariationRowsOnLoad(rows, attrsForEditor));
      }

      slugEditedManually.current = true;
    };
    load();
  }, [editId, apiBase]);

  // ── Form helpers ─────────────────────────────────────────────────────────────
  const set = (key: keyof FormState, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleNameChange = (name: string) => {
    setForm((prev) => ({
      ...prev,
      name,
      slug: slugEditedManually.current ? prev.slug : toSlug(name),
    }));
  };

  const addImage = () => {
    const url = newImageUrl.trim();
    if (!url) return;
    setForm((prev) => ({
      ...prev,
      images: [
        ...prev.images,
        { src: url, alt: '', position: prev.images.length, is_thumbnail: prev.images.length === 0 },
      ],
    }));
    setNewImageUrl('');
  };

  const removeImage = (i: number) =>
    setForm((prev) => {
      const imgs = prev.images.filter((_, idx) => idx !== i).map((img, idx) => ({
        ...img, position: idx, is_thumbnail: idx === 0,
      }));
      return { ...prev, images: imgs };
    });

  const toggleCategory = (id: string) =>
    setForm((prev) => ({
      ...prev,
      category_ids: prev.category_ids.includes(id)
        ? prev.category_ids.filter((c) => c !== id)
        : [...prev.category_ids, id],
    }));

  const toggleTag = (id: string) =>
    setForm((prev) => ({
      ...prev,
      tag_ids: prev.tag_ids.includes(id)
        ? prev.tag_ids.filter((t) => t !== id)
        : [...prev.tag_ids, id],
    }));

  // ── Variation helpers ────────────────────────────────────────────────────────
  const updateAttr = (i: number, field: keyof VarAttr, value: string | boolean) =>
    setVarAttrs((prev) => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a));

  const addAttr = () =>
    setVarAttrs((prev) => [...prev, { name: '', optionsRaw: '', is_variation: true }]);

  const removeAttr = (i: number) =>
    setVarAttrs((prev) => prev.filter((_, idx) => idx !== i));

  const handleGenerateVariations = () => {
    const combos = generateCombinations(varAttrs);
    if (combos.length === 0) {
      notification.error('No attributes', 'Add at least one attribute with options first');
      return;
    }

    // Match by attribute signature; if rows had empty attributes (all map to ""), fall back to same index.
    const newRows: VarRow[] = combos.map((attrs, comboIdx) => {
      const sig = attrSignature(attrs);
      const bySig = variations.find(
        (v) => hasMeaningfulAttributes(v.attributes) && attrSignature(v.attributes) === sig
      );
      if (bySig) return { ...bySig, attributes: attrs };
      const byIndex = variations[comboIdx];
      if (byIndex && !hasMeaningfulAttributes(byIndex.attributes)) {
        return { ...byIndex, attributes: attrs };
      }
      return {
        attributes: attrs,
        sku: '',
        regular_price: '',
        sale_price: '',
        stock_status: 'instock',
        manage_stock: false,
        stock_quantity: '',
        image_url: '',
      };
    });

    setVariations(newRows);
  };

  /**
   * Apply option-list order to labels: row 1 = first comma option, etc. Images/SKUs stay on each row.
   */
  const handleRealignVariationRows = () => {
    if (form.type !== 'variable') return;
    if (variations.length === 0) {
      notification.error('Nothing to realign', 'Add attributes and use Generate Variations first.');
      return;
    }
    const combos = generateCombinations(varAttrs);
    if (combos.length === 0) {
      notification.error('No matrix', 'Add at least one variation attribute with comma-separated options.');
      return;
    }

    const hadEmptyAttrs = variations.some((v) => !hasMeaningfulAttributes(v.attributes));
    const countMismatch = variations.length !== combos.length;
    const realigned = applyRealignFromOptionOrder(variations, varAttrs);
    setVariations(realigned);

    if (countMismatch) {
      notification.warning(
        'Realigned with note',
        `Row count (${variations.length}) does not match the full matrix (${combos.length}). Labels were filled/sorted where possible. Use Generate Variations to add or drop rows.`
      );
    } else if (hadEmptyAttrs) {
      notification.success(
        'Rows realigned',
        'Labels now follow your option list (top row = first option). Save to persist.'
      );
    } else {
      notification.success(
        'Rows realigned',
        'Row 1 = first option in your list, row 2 = second, etc. Images and SKUs stayed on each row—swap image URLs if a picture and label do not match.'
      );
    }
  };

  const updateVariation = (i: number, field: keyof VarRow, value: string | boolean) =>
    setVariations((prev) => prev.map((v, idx) => idx === i ? { ...v, [field]: value } : v));

  const removeVariation = (i: number) =>
    setVariations((prev) => prev.filter((_, idx) => idx !== i));

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = async (targetStatus: 'draft' | 'published') => {
    if (!form.name.trim()) { notification.error('Validation', 'Product name is required'); return; }
    if (!form.slug.trim()) { notification.error('Validation', 'Slug is required'); return; }
    if (!form.vendor_id) { notification.error('Validation', 'Please assign a vendor'); return; }
    if (form.type === 'variable' && variations.length === 0) {
      notification.error('Validation', 'Generate variations before saving a variable product');
      return;
    }

    setSaving(true);
    try {
      const url = editId
        ? `${apiBase}/.netlify/functions/catalog-product-upsert?id=${editId}`
        : `${apiBase}/.netlify/functions/catalog-product-upsert`;
      const method = editId ? 'PUT' : 'POST';

      const payload: Record<string, any> = {
        ...form,
        status: targetStatus,
        sku: form.type === 'simple' ? (form.sku.trim() || null) : null,
        regular_price: form.type === 'simple' && form.regular_price !== '' && form.regular_price != null
          ? Number(form.regular_price)
          : null,
        sale_price: form.type === 'simple' && form.sale_price !== '' && form.sale_price != null
          ? Number(form.sale_price)
          : null,
        stock_quantity:
          form.manage_stock && form.stock_quantity !== '' && form.stock_quantity != null
            ? Number(form.stock_quantity)
            : null,
        vendor_id: form.vendor_id || null,
        hub_id: form.hub_id || null,
        weight: toNullableDim(form.weight),
        length: toNullableDim(form.length),
        width: toNullableDim(form.width),
        height: toNullableDim(form.height),
      };

      // Include attributes + variations for variable products
      if (form.type === 'variable') {
        payload.attributes = varAttrs
          .filter((a) => a.name.trim())
          .map((a) => ({
            name: a.name.trim(),
            options: a.optionsRaw.split(',').map((o) => o.trim()).filter(Boolean),
            is_variation: a.is_variation,
          }));
        payload.variations = variations.map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          attributes: v.attributes,
          sku: v.sku || null,
          regular_price:
            v.regular_price != null && v.regular_price !== '' ? Number(v.regular_price) : null,
          sale_price: v.sale_price != null && v.sale_price !== '' ? Number(v.sale_price) : null,
          stock_status: v.stock_status,
          manage_stock: v.manage_stock,
          stock_quantity:
            v.manage_stock && v.stock_quantity != null && v.stock_quantity !== ''
              ? Number(v.stock_quantity)
              : null,
          image_url: v.image_url.trim() || null,
        }));
      } else {
        // Switching from variable to simple — clear variations
        payload.attributes = [];
        payload.variations = [];
      }

      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(payload) });
      const json = await res.json();

      if (!res.ok || !json.success) {
        notification.error('Save Failed', json.error || 'Could not save product');
        return;
      }

      notification.success(
        editId ? 'Product Updated' : 'Product Created',
        `"${json.data.name}" saved as ${json.data.status}`
      );
      navigate(moderationListPath);
    } catch (err: any) {
      notification.error('Error', err?.message || 'Unexpected error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!editId) return;
    const label = form.name.trim() || 'this product';
    if (
      !window.confirm(
        `Delete “${label}” permanently? This removes the product, variations, and images from the catalog. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(
        `${apiBase}/.netlify/functions/catalog-product-upsert?id=${encodeURIComponent(editId)}`,
        { method: 'DELETE', headers: authHeaders() }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        notification.error('Delete failed', json.error || json.message || 'Could not delete product');
        return;
      }
      clearProductListSessionCache();
      notification.success('Product deleted', 'The product was removed from the catalog.');
      navigate(moderationListPath);
    } catch (err: unknown) {
      notification.error('Delete failed', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setDeleting(false);
    }
  };

  if (loadingMeta && !editId) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  const topCats = allCategories.filter((c) => !c.parent_id);
  const filteredTags = allTags.filter((t) =>
    tagInput ? t.name.toLowerCase().includes(tagInput.toLowerCase()) : true
  );
  const isVariable = form.type === 'variable';

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-none mx-auto px-3 sm:px-5 xl:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate(moderationListPath)}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 hover:bg-gray-50"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Products
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {editId ? 'Edit Product' : 'Add New Product'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Products are saved directly to the catalog. Drafts are not visible on the storefront.
            </p>
          </div>
        </div>
        <span className={`self-start px-3 py-1 rounded-full text-xs font-semibold ${
          form.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {form.status === 'published' ? 'Published' : 'Draft'}
        </span>
      </div>

      <div className="space-y-6">

        {/* ── Product Type ────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-semibold text-gray-900 mb-3">Product Type</h2>
          <div className="flex gap-3">
            {(['simple', 'variable'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  set('type', t);
                  if (t === 'simple') setVariations([]);
                }}
                className={`flex-1 py-3 px-4 rounded-lg border-2 text-sm font-medium transition-colors ${
                  form.type === t
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {t === 'simple' ? (
                  <div>
                    <div className="font-semibold">Simple Product</div>
                    <div className="text-xs font-normal mt-0.5 opacity-70">Single price, one SKU</div>
                  </div>
                ) : (
                  <div>
                    <div className="font-semibold">Variable Product</div>
                    <div className="text-xs font-normal mt-0.5 opacity-70">Multiple options (size, color…)</div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* ── Basic Info ──────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Basic Info</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Nike Air Max 270"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug *</label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => { slugEditedManually.current = true; set('slug', e.target.value); }}
              placeholder="nike-air-max-270"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-400 mt-1">Auto-generated from name. Must be unique.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Short Description</label>
            <RichTextEditor
              value={form.short_description}
              onChange={(html) => set('short_description', html)}
              placeholder="Brief summary shown on product cards"
              minHeight="80px"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Description</label>
            <RichTextEditor
              value={form.description}
              onChange={(html) => set('description', html)}
              placeholder="Full product description"
              minHeight="160px"
            />
          </div>
        </section>

        {/* ── Vendor & Hub (before pricing / variations so SKU generation has vendor) ─ */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Vendor & Hub</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
              <select
                value={form.vendor_id}
                onChange={(e) => set('vendor_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select vendor...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.store_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hub</label>
              <select
                value={form.hub_id}
                onChange={(e) => set('hub_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">No hub (ships from vendor)</option>
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={form.ships_from_abroad}
                onChange={(e) => set('ships_from_abroad', e.target.checked)}
                className="w-4 h-4 text-primary-600 rounded"
              />
              <span className="text-sm text-gray-700">Ships from abroad (international)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox" checked={form.is_virtual}
                onChange={(e) => set('is_virtual', e.target.checked)}
                className="w-4 h-4 text-primary-600 rounded"
              />
              <span className="text-sm text-gray-700">Virtual product (no shipping)</span>
            </label>
          </div>
        </section>

        {/* ── Package & shipping (stored on product; used for per-kg quotes) ─ */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Package & shipping</h2>
          <p className="text-xs text-gray-500">
            Weight and size feed checkout shipping (e.g. flat rate + per kg). Leave blank if unknown; virtual goods can skip.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
              <input
                type="number"
                value={form.weight}
                onChange={(e) => set('weight', e.target.value)}
                min="0"
                step="0.01"
                placeholder="e.g. 0.5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Length (cm)</label>
              <input
                type="number"
                value={form.length}
                onChange={(e) => set('length', e.target.value)}
                min="0"
                step="0.1"
                placeholder="—"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Width (cm)</label>
              <input
                type="number"
                value={form.width}
                onChange={(e) => set('width', e.target.value)}
                min="0"
                step="0.1"
                placeholder="—"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
              <input
                type="number"
                value={form.height}
                onChange={(e) => set('height', e.target.value)}
                min="0"
                step="0.1"
                placeholder="—"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </section>

        {/* ── Categories ──────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h2 className="font-semibold text-gray-900">Categories</h2>
          {allCategories.length === 0 ? (
            <p className="text-sm text-gray-400">Loading categories...</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
              {topCats.map((cat) => {
                const children = allCategories.filter((c) => c.parent_id === cat.id);
                return (
                  <div key={cat.id}>
                    <label className="flex items-center gap-2 cursor-pointer py-1">
                      <input
                        type="checkbox"
                        checked={form.category_ids.includes(cat.id)}
                        onChange={() => toggleCategory(cat.id)}
                        className="w-4 h-4 text-primary-600 rounded"
                      />
                      <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                    </label>
                    {children.map((child) => (
                      <label key={child.id} className="flex items-center gap-2 cursor-pointer py-0.5 pl-5">
                        <input
                          type="checkbox"
                          checked={form.category_ids.includes(child.id)}
                          onChange={() => toggleCategory(child.id)}
                          className="w-3.5 h-3.5 text-primary-600 rounded"
                        />
                        <span className="text-xs text-gray-600">{child.name}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {form.category_ids.length > 0 && (
            <p className="text-xs text-primary-600">{form.category_ids.length} selected</p>
          )}
        </section>

        {/* ── Pricing & Stock (simple only) ───────────────────────────── */}
        {!isVariable ? (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Pricing & Stock</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Regular Price (₦)</label>
                <input
                  type="number" value={form.regular_price}
                  onChange={(e) => set('regular_price', e.target.value)}
                  min="0" step="0.01" placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sale Price (₦)</label>
                <input
                  type="number" value={form.sale_price}
                  onChange={(e) => set('sale_price', e.target.value)}
                  min="0" step="0.01" placeholder="Leave blank if no sale"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                <input
                  type="text" value={form.sku}
                  onChange={(e) => set('sku', e.target.value)}
                  placeholder="e.g. LAP-JUL-001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleGenerateSimpleSku()}
                  disabled={skuGenBusy}
                  className="mt-1.5 text-xs font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50"
                >
                  {skuGenBusy ? 'Working…' : 'Generate SKU'}
                </button>
                <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                  Builds <span className="font-mono">CAT-VEN-###</span> from the first selected category (code from category <strong>name</strong>) and vendor (<strong>slug</strong> first), then picks the next unused number (checks all simple + variation SKUs).
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stock Status</label>
                <select
                  value={form.stock_status}
                  onChange={(e) => set('stock_status', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  <option value="instock">In Stock</option>
                  <option value="outofstock">Out of Stock</option>
                  <option value="onbackorder">On Backorder</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox" checked={form.manage_stock}
                  onChange={(e) => set('manage_stock', e.target.checked)}
                  className="w-4 h-4 text-primary-600 rounded"
                />
                <span className="text-sm text-gray-700">Track stock quantity</span>
              </label>
              {form.manage_stock && (
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-700">Quantity:</label>
                  <input
                    type="number" value={form.stock_quantity}
                    onChange={(e) => set('stock_quantity', e.target.value)}
                    min="0"
                    className="w-24 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}
            </div>
          </section>
        ) : (
          // ── Attributes (variable) ──────────────────────────────────────
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Attributes</h2>
              <p className="text-xs text-gray-400">Define options, then generate variation rows below</p>
            </div>

            <div className="space-y-3">
              {varAttrs.map((attr, i) => (
                <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                  <input
                    type="text"
                    value={attr.name}
                    onChange={(e) => updateAttr(i, 'name', e.target.value)}
                    placeholder="Attribute name (e.g. Color)"
                    className="w-full sm:w-36 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                  <input
                    type="text"
                    value={attr.optionsRaw}
                    onChange={(e) => updateAttr(i, 'optionsRaw', e.target.value)}
                    placeholder="Options (comma-separated: Red, Blue, Green)"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                  <div className="flex items-center justify-between gap-2 sm:justify-start">
                    <label className="flex items-center gap-1.5 text-xs text-gray-500">
                      <input
                        type="checkbox"
                        checked={attr.is_variation}
                        onChange={(e) => updateAttr(i, 'is_variation', e.target.checked)}
                        className="w-3.5 h-3.5"
                      />
                      Used for variations
                    </label>
                    <button
                      type="button"
                      onClick={() => removeAttr(i)}
                      disabled={varAttrs.length === 1}
                      className="p-1.5 text-gray-400 hover:text-red-500 disabled:opacity-30"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={addAttr}
                className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                <Plus className="w-4 h-4" />
                Add attribute
              </button>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleRealignVariationRows}
                  disabled={variations.length === 0}
                  title="Set labels from your option list: row 1 = first option, row 2 = second… Images and SKUs stay on each row."
                  className="flex items-center gap-1.5 px-4 py-2 border border-primary-200 text-primary-800 bg-primary-50 text-sm font-medium rounded-lg hover:bg-primary-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ListOrdered className="w-4 h-4" />
                  Realign rows
                </button>
                <button
                  type="button"
                  onClick={handleGenerateVariations}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700"
                >
                  <RefreshCw className="w-4 h-4" />
                  Generate Variations
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 -mt-1">
              <strong className="font-medium text-gray-600">Generate</strong> creates or updates rows from your attribute options.
              <strong className="font-medium text-gray-600"> Realign</strong> sets row 1 = first option in your comma list, row 2 = second, etc. Row order and images stay put—swap image URLs if a label and picture disagree.
            </p>
          </section>
        )}

        {/* ── Variations table (variable only) ───────────────────────── */}
        {isVariable && variations.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold text-gray-900">
                Variations
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {variations.length} variation{variations.length !== 1 ? 's' : ''}
                </span>
              </h2>
              <button
                type="button"
                onClick={() => void handleGenerateEmptyVariationSkus()}
                disabled={skuGenBusy}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-50 self-start"
              >
                {skuGenBusy ? 'Working…' : 'Fill SKUs on empty rows'}
              </button>
            </div>

            {/* Desktop / tablet table */}
            <div className="hidden md:block overflow-x-auto -mx-1">
              <table className="w-full text-sm table-fixed border-separate border-spacing-0">
                <colgroup>
                  <col className="w-[19%]" />
                  <col className="w-[120px]" />
                  <col className="w-[7rem]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[8rem]" />
                  <col className="w-9" />
                </colgroup>
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="pb-2 pr-3 font-medium align-bottom">Attributes</th>
                    <th className="pb-2 pl-1 pr-2 font-medium align-bottom">Image</th>
                    <th className="pb-2 pl-1 pr-1 font-medium align-bottom">SKU</th>
                    <th className="pb-2 pl-2 font-medium align-bottom">Regular (₦)</th>
                    <th className="pb-2 pl-2 font-medium align-bottom">Sale (₦)</th>
                    <th className="pb-2 pl-2 font-medium align-bottom">Stock</th>
                    <th className="pb-2 w-9 align-bottom" aria-label="Remove row" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {variations.map((v, i) => (
                    <tr key={i} className="group">
                      {/* Attribute labels — first column only (Option / Colour chips) */}
                      <td className="py-3 pr-3 align-top min-w-0 border-r border-transparent">
                        <div className="flex flex-wrap gap-1.5 min-h-[2.5rem] content-start">
                          {v.attributes.length === 0 ? (
                            <span className="text-xs text-amber-600 italic leading-snug">
                              No attributes — use Realign or Generate
                            </span>
                          ) : (
                            v.attributes.map((a, ai) => (
                              <span
                                key={`${a.name}-${a.value}-${ai}`}
                                className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-800 px-2.5 py-1 rounded-full border border-gray-200/80"
                              >
                                <span className="text-gray-500 font-medium">{a.name}:</span>
                                <span className="font-medium">{a.value}</span>
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      {/* Variation image — preview; URL hidden in collapsible row */}
                      <td className="py-3 pl-1 pr-2 align-top min-w-0 max-w-[120px]">
                        <div className="flex flex-col gap-1.5 max-w-[120px]">
                          <div className="flex items-start gap-1.5">
                            {v.image_url.trim() ? (
                              <button
                                type="button"
                                onClick={() => setVariationImagePreviewUrl(v.image_url.trim())}
                                title="Tap to preview"
                                aria-label={`Preview variation ${i + 1} image`}
                                className="group/img flex-shrink-0 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden ring-1 ring-black/[0.04] hover:ring-primary-400 cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 transition-shadow"
                              >
                                <img
                                  src={v.image_url.trim()}
                                  alt=""
                                  className="w-12 h-12 object-contain block"
                                  onError={(e) => {
                                    const el = e.target as HTMLImageElement;
                                    el.style.display = 'none';
                                    el.parentElement?.classList.add('hidden');
                                  }}
                                />
                              </button>
                            ) : (
                              <div className="w-12 h-12 rounded-lg border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-[9px] text-gray-400 text-center px-0.5 leading-tight">
                                No image
                              </div>
                            )}
                            <label
                              className={`flex items-center justify-center w-10 h-10 rounded-lg border cursor-pointer transition-colors flex-shrink-0 self-end ${uploadingVariationIdx === i ? 'border-gray-200 text-gray-300 pointer-events-none' : 'border-primary-200 text-primary-600 hover:bg-primary-50'}`}
                              title="Upload image"
                            >
                              {uploadingVariationIdx === i ? (
                                <span className="text-xs">…</span>
                              ) : (
                                <Upload className="w-4 h-4" />
                              )}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                className="hidden"
                                disabled={uploadingVariationIdx !== null}
                                onChange={(e) => handleVariationImageUpload(e, i)}
                              />
                            </label>
                          </div>
                          {v.image_url.trim() ? (
                            <a
                              href={v.image_url.trim()}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] font-medium text-primary-600 hover:text-primary-800 w-fit"
                            >
                              Open in new tab
                            </a>
                          ) : null}
                          <details className="group/url text-xs">
                            <summary className="cursor-pointer list-none text-primary-600 hover:text-primary-800 font-medium select-none [&::-webkit-details-marker]:hidden flex items-center gap-1">
                              <span className="border-b border-dotted border-primary-400">
                                {v.image_url.trim() ? 'Edit image URL' : 'Set image URL'}
                              </span>
                            </summary>
                            <div className="mt-2 pt-2 border-t border-gray-100">
                              <input
                                type="url"
                                value={v.image_url}
                                onChange={(e) => updateVariation(i, 'image_url', e.target.value)}
                                placeholder="https://..."
                                title={v.image_url.trim() || undefined}
                                className="w-full min-w-0 px-2 py-1.5 border border-gray-200 rounded-md text-xs font-mono focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                              />
                              {v.image_url.trim() ? (
                                <p className="mt-1 text-[10px] text-gray-400 truncate" title={v.image_url}>
                                  {v.image_url}
                                </p>
                              ) : null}
                            </div>
                          </details>
                        </div>
                      </td>
                      <td className="py-2 pl-1 pr-1 align-top min-w-0 max-w-[7rem] w-[7rem]">
                        <div className="flex flex-col gap-1 max-w-[7rem]">
                          <input
                            type="text"
                            value={v.sku}
                            onChange={(e) => updateVariation(i, 'sku', e.target.value)}
                            placeholder="SKU"
                            title={v.sku}
                            className="w-full max-w-[7rem] box-border px-1.5 py-1.5 border border-gray-200 rounded-md text-xs font-mono focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          />
                          <button
                            type="button"
                            onClick={() => void handleGenerateVariationSku(i)}
                            disabled={skuGenBusy}
                            className="text-[10px] font-medium text-primary-600 hover:text-primary-800 text-left disabled:opacity-50 truncate"
                          >
                            {skuGenBusy ? '…' : 'Generate'}
                          </button>
                        </div>
                      </td>
                      <td className="py-2 pl-2 pr-1 align-top min-w-0">
                        <input
                          type="number"
                          value={v.regular_price}
                          onChange={(e) => updateVariation(i, 'regular_price', e.target.value)}
                          placeholder="0"
                          min="0"
                          step="0.01"
                          className="w-full min-w-0 max-w-full px-1.5 py-1.5 border border-gray-200 rounded-md text-sm tabular-nums focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </td>
                      <td className="py-2 pl-1 pr-2 align-top min-w-0">
                        <input
                          type="number"
                          value={v.sale_price}
                          onChange={(e) => updateVariation(i, 'sale_price', e.target.value)}
                          placeholder="—"
                          min="0"
                          step="0.01"
                          className="w-full min-w-0 max-w-full px-1.5 py-1.5 border border-gray-200 rounded-md text-sm tabular-nums focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </td>
                      <td className="py-2 pl-2 pr-1 align-top min-w-0">
                        <select
                          value={v.stock_status}
                          onChange={(e) => updateVariation(i, 'stock_status', e.target.value)}
                          className="w-full min-w-0 max-w-full px-1 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-primary-500"
                        >
                          <option value="instock">In Stock</option>
                          <option value="outofstock">Out of Stock</option>
                          <option value="onbackorder">Backorder</option>
                        </select>
                      </td>
                      <td className="py-2 pl-2">
                        <button
                          type="button"
                          onClick={() => removeVariation(i)}
                          className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile-friendly stacked cards */}
            <div className="space-y-3 md:hidden">
              {variations.map((v, i) => (
                <div
                  key={i}
                  className="border border-gray-200 rounded-lg p-3 bg-white shadow-sm space-y-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap gap-1.5">
                        {v.attributes.length === 0 ? (
                          <span className="text-xs text-amber-600 italic leading-snug">
                            No attributes — use Realign or Generate
                          </span>
                        ) : (
                          v.attributes.map((a, ai) => (
                            <span
                              key={`${a.name}-${a.value}-${ai}`}
                              className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-800 px-2.5 py-1 rounded-full border border-gray-200/80"
                            >
                              <span className="text-gray-500 font-medium">{a.name}:</span>
                              <span className="font-medium">{a.value}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      {v.image_url.trim() ? (
                        <button
                          type="button"
                          onClick={() => setVariationImagePreviewUrl(v.image_url.trim())}
                          className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden"
                        >
                          <img
                            src={v.image_url.trim()}
                            alt=""
                            className="w-14 h-14 object-contain"
                          />
                        </button>
                      ) : (
                        <div className="w-14 h-14 rounded-lg border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-[9px] text-gray-400 text-center px-0.5 leading-tight">
                          No image
                        </div>
                      )}
                      <label
                        className={`flex items-center justify-center w-9 h-9 rounded-lg border cursor-pointer transition-colors ${
                          uploadingVariationIdx === i
                            ? 'border-gray-200 text-gray-300 pointer-events-none'
                            : 'border-primary-200 text-primary-600 hover:bg-primary-50'
                        }`}
                      >
                        {uploadingVariationIdx === i ? (
                          <span className="text-[10px]">…</span>
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          className="hidden"
                          disabled={uploadingVariationIdx !== null}
                          onChange={(e) => handleVariationImageUpload(e, i)}
                        />
                      </label>
                    </div>
                  </div>

                  <details className="group/url text-xs">
                    <summary className="cursor-pointer list-none text-primary-600 hover:text-primary-800 font-medium select-none [&::-webkit-details-marker]:hidden flex items-center gap-1">
                      <span className="border-b border-dotted border-primary-400">
                        {v.image_url.trim() ? 'Edit image URL' : 'Set image URL'}
                      </span>
                    </summary>
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <input
                        type="url"
                        value={v.image_url}
                        onChange={(e) => updateVariation(i, 'image_url', e.target.value)}
                        placeholder="https://..."
                        title={v.image_url.trim() || undefined}
                        className="w-full min-w-0 px-2 py-1.5 border border-gray-200 rounded-md text-xs font-mono focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </details>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs text-gray-500">SKU</label>
                      <input
                        type="text"
                        value={v.sku}
                        onChange={(e) => updateVariation(i, 'sku', e.target.value)}
                        placeholder="SKU"
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs font-mono focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleGenerateVariationSku(i)}
                        disabled={skuGenBusy}
                        className="mt-0.5 text-[11px] font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50"
                      >
                        {skuGenBusy ? '…' : 'Generate'}
                      </button>
                    </div>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <label className="block text-xs text-gray-500">Regular price (₦)</label>
                        <input
                          type="number"
                          value={v.regular_price}
                          onChange={(e) => updateVariation(i, 'regular_price', e.target.value)}
                          placeholder="0"
                          min="0"
                          step="0.01"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs tabular-nums focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs text-gray-500">Sale price (₦)</label>
                        <input
                          type="number"
                          value={v.sale_price}
                          onChange={(e) => updateVariation(i, 'sale_price', e.target.value)}
                          placeholder="—"
                          min="0"
                          step="0.01"
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs tabular-nums focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Stock status</label>
                      <select
                        value={v.stock_status}
                        onChange={(e) => updateVariation(i, 'stock_status', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-primary-500"
                      >
                        <option value="instock">In Stock</option>
                        <option value="outofstock">Out of Stock</option>
                        <option value="onbackorder">Backorder</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVariation(i)}
                      className="ml-3 p-1.5 text-gray-300 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Bulk price fill */}
            <BulkPriceFill
              onApply={(price, salePrice) => {
                setVariations((prev) =>
                  prev.map((v) => ({
                    ...v,
                    regular_price: price || v.regular_price,
                    sale_price: salePrice !== undefined ? salePrice : v.sale_price,
                  }))
                );
              }}
            />

            {variationImagePreviewUrl ? (
              <div
                className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70"
                role="dialog"
                aria-modal="true"
                aria-label="Variation image preview"
                onClick={() => setVariationImagePreviewUrl(null)}
              >
                <button
                  type="button"
                  onClick={() => setVariationImagePreviewUrl(null)}
                  className="absolute top-3 right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white"
                  aria-label="Close preview"
                >
                  <X className="w-5 h-5" />
                </button>
                <img
                  src={variationImagePreviewUrl}
                  alt=""
                  className="max-h-[min(85vh,900px)] max-w-[min(92vw,1200px)] w-auto h-auto object-contain rounded-lg shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            ) : null}
          </section>
        )}

        {/* ── Tags ────────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h2 className="font-semibold text-gray-900">Tags</h2>
          <input
            type="text" value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Filter tags..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
          />
          <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
            {filteredTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  form.tag_ids.includes(tag.id)
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </section>

        {/* ── Images ──────────────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Images</h2>

          {form.images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {form.images.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img.src} alt={img.alt}
                    className={`w-full aspect-square object-cover rounded-lg border-2 ${
                      img.is_thumbnail ? 'border-primary-500' : 'border-gray-200'
                    }`}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23eee" width="100" height="100"/><text x="50%" y="50%" text-anchor="middle" fill="%23999" font-size="12">Error</text></svg>';
                    }}
                  />
                  {img.is_thumbnail && (
                    <span className="absolute top-1 left-1 bg-primary-600 text-white text-xs px-1.5 py-0.5 rounded">Main</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="url" value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImage(); } }}
              placeholder="Paste image URL and press Enter or click Add"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={addImage}
              className="flex items-center gap-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
            <label className={`flex items-center gap-1 px-4 py-2 rounded-lg text-sm cursor-pointer transition-colors ${uploadingImage ? 'bg-gray-100 text-gray-400 pointer-events-none' : 'bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-200'}`}>
              <Upload className="w-4 h-4" />
              {uploadingImage ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                disabled={uploadingImage}
                onChange={handleProductImageUpload}
              />
            </label>
          </div>
          <p className="text-xs text-gray-400">First image is the main thumbnail. Max 5 MB per image.</p>
        </section>

        {/* ── Advanced / SEO ──────────────────────────────────────────── */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-gray-50"
          >
            <h2 className="font-semibold text-gray-900">Advanced / SEO</h2>
            {showAdvanced ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>

          {showAdvanced && (
            <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SEO Title</label>
                <input
                  type="text" value={form.seo_title}
                  onChange={(e) => set('seo_title', e.target.value)}
                  placeholder="Defaults to product name if empty"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SEO Description</label>
                <textarea
                  value={form.seo_description}
                  onChange={(e) => set('seo_description', e.target.value)}
                  rows={2}
                  placeholder="Brief description for search engines"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>
            </div>
          )}
        </section>

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 pb-8">
          <button
            type="button"
            disabled={saving || deleting}
            onClick={() => handleSubmit('draft')}
            className="px-6 py-2.5 bg-gray-100 text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button
            type="button"
            disabled={saving || deleting}
            onClick={() => handleSubmit('published')}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Publishing...' : 'Publish'}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => navigate(moderationListPath)}
            className="px-6 py-2.5 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          {editId ? (
            <button
              type="button"
              disabled={saving || deleting}
              onClick={() => void handleDeleteProduct()}
              className="ml-auto px-6 py-2.5 border border-red-200 text-red-700 rounded-lg font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete product'}
            </button>
          ) : null}
        </div>

      </div>
    </div>
  );
}

// ── Bulk Price Fill ────────────────────────────────────────────────────────────
// Lets staff set the same price on all variations at once

function BulkPriceFill({ onApply }: { onApply: (price: string, salePrice: string) => void }) {
  const [price, setPrice] = useState('');
  const [sale, setSale] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary-600 hover:text-primary-700 font-medium"
      >
        Set price for all variations
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-xs text-gray-500">Set all:</span>
      <input
        type="number" value={price} onChange={(e) => setPrice(e.target.value)}
        placeholder="Regular ₦" min="0" step="0.01"
        className="w-28 px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-primary-500"
      />
      <input
        type="number" value={sale} onChange={(e) => setSale(e.target.value)}
        placeholder="Sale ₦ (opt)" min="0" step="0.01"
        className="w-28 px-2 py-1.5 border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-primary-500"
      />
      <button
        type="button"
        onClick={() => { onApply(price, sale); setOpen(false); setPrice(''); setSale(''); }}
        className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded-md hover:bg-primary-700"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-3 py-1.5 text-gray-500 text-xs hover:text-gray-700"
      >
        Cancel
      </button>
    </div>
  );
}
