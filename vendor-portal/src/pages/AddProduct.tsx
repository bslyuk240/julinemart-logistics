import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Plus, Trash2, Upload, X, RefreshCw,
  ChevronDown, ChevronUp, ImageIcon, Lock,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import RichTextEditor from '../components/RichTextEditor';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImageRow {
  src: string;
  alt: string;
  position: number;
  is_thumbnail: boolean;
}

interface VarAttr {
  name: string;
  optionsRaw: string;
  is_variation: boolean;
}

interface VarRow {
  id?: string;
  attributes: { name: string; value: string }[];
  sku: string;
  regular_price: string;
  sale_price: string;
  cost_price: string;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  manage_stock: boolean;
  stock_quantity: string;
  image_url: string;
}

interface CatOption {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
}

interface TagOption {
  id: string;
  name: string;
  slug: string;
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
  cost_price: string;
  sku: string;
  manage_stock: boolean;
  stock_quantity: string;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  is_virtual: boolean;
  ships_from_abroad: boolean;
  seo_title: string;
  seo_description: string;
  weight: string;
  length: string;
  width: string;
  height: string;
  category_ids: string[];
  tag_ids: string[];
  images: ImageRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function toNullableDim(value: string): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function generateCombinations(varAttrs: VarAttr[]): { name: string; value: string }[][] {
  const filtered = varAttrs.filter(a => a.name.trim() && a.optionsRaw.trim());
  if (!filtered.length) return [];
  const pools = filtered.map(a => ({
    name: a.name.trim(),
    values: a.optionsRaw.split(',').map(v => v.trim()).filter(Boolean),
  }));
  let result: { name: string; value: string }[][] = [[]];
  for (const pool of pools) {
    result = result.flatMap(combo =>
      pool.values.map(val => [...combo, { name: pool.name, value: val }])
    );
  }
  return result;
}

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

function categorySkuCode(name: string, slug: string, len = 3): string {
  const clean = decodeBasicHtmlEntities(name || '');
  const nameSeg = toSlug(clean).split('-').filter(Boolean)[0] || '';
  const slugSeg = (slug || '').split('-').filter(Boolean)[0] || '';
  const raw = nameSeg || slugSeg || 'x';
  return skuCodeFromPrimarySegment(raw, clean || slug, len);
}

function vendorSkuCode(slug: string, name: string, len = 3): string {
  const slugSeg = (slug || '').split('-').filter(Boolean)[0] || '';
  const nameSeg = toSlug(decodeBasicHtmlEntities(name || '')).split('-').filter(Boolean)[0] || '';
  const raw = slugSeg || nameSeg || 'x';
  return skuCodeFromPrimarySegment(raw, name || slug, len);
}

function orderedSelectedCategoryIds(allCategories: CatOption[], categoryIds: string[]): string[] {
  const sel = new Set(categoryIds);
  const out: string[] = [];
  const tops = allCategories.filter(c => !c.parent_id);
  for (const t of tops) {
    if (sel.has(t.id)) out.push(t.id);
    for (const ch of allCategories.filter(c => c.parent_id === t.id)) {
      if (sel.has(ch.id)) out.push(ch.id);
    }
  }
  return out;
}

const INITIAL_FORM: FormState = {
  name: '',
  slug: '',
  short_description: '',
  description: '',
  status: 'published',
  type: 'simple',
  regular_price: '',
  sale_price: '',
  cost_price: '',
  sku: '',
  manage_stock: false,
  stock_quantity: '',
  stock_status: 'instock',
  is_virtual: false,
  ships_from_abroad: false,
  seo_title: '',
  seo_description: '',
  weight: '',
  length: '',
  width: '',
  height: '',
  category_ids: [],
  tag_ids: [],
  images: [],
};

// ─── Image Upload ─────────────────────────────────────────────────────────────

async function uploadImage(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, file, { cacheControl: '31536000', upsert: false });
  if (error) {
    alert('Upload failed: ' + error.message);
    return null;
  }
  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddProduct() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const { vendor } = useAuth();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [varAttrs, setVarAttrs] = useState<VarAttr[]>([{ name: '', optionsRaw: '', is_variation: true }]);
  const [variations, setVariations] = useState<VarRow[]>([]);

  const [categories, setCategories] = useState<CatOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [seoOpen, setSeoOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [skuGenBusy, setSkuGenBusy] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const varFileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // ── Load meta (categories, tags) ─────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      api.getProductMeta('categories'),
      api.getProductMeta('tags'),
    ]).then(([cats, tgs]) => {
      setCategories((cats as CatOption[]) || []);
      setTags((tgs as TagOption[]) || []);
    }).catch(() => {/* non-critical */});
  }, []);

  // ── Load existing product for edit ────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const { data: prod, error: pErr } = await supabase
          .from('products')
          .select('*')
          .eq('id', id)
          .single();
        if (pErr || !prod) { alert('Product not found'); navigate('/products'); return; }

        const [imgRes, catRes, tagRes, attrRes, varRes] = await Promise.all([
          supabase.from('product_images').select('*').eq('product_id', id).is('variation_id', null).order('position'),
          supabase.from('product_category_map').select('category_id').eq('product_id', id),
          supabase.from('product_tag_map').select('tag_id').eq('product_id', id),
          supabase.from('product_attribute_map').select('*, product_attributes(name, slug)').eq('product_id', id).order('display_order'),
          supabase.from('product_variations').select('*, product_images(src)').eq('product_id', id).eq('is_active', true),
        ]);

        setForm({
          name: prod.name || '',
          slug: prod.slug || '',
          short_description: String(prod.short_description || ''),
          description: String(prod.description || ''),
          status: (prod.status === 'draft' ? 'draft' : 'published') as 'draft' | 'published',
          type: (prod.type === 'variable' ? 'variable' : 'simple') as 'simple' | 'variable',
          regular_price: prod.regular_price != null ? String(prod.regular_price) : '',
          sale_price: prod.sale_price != null ? String(prod.sale_price) : '',
          cost_price: prod.cost_price != null ? String(prod.cost_price) : '',
          sku: prod.sku || '',
          manage_stock: prod.manage_stock || false,
          stock_quantity: prod.stock_quantity != null ? String(prod.stock_quantity) : '',
          stock_status: (prod.stock_status || 'instock') as 'instock' | 'outofstock' | 'onbackorder',
          is_virtual: prod.is_virtual || false,
          ships_from_abroad: prod.ships_from_abroad || false,
          seo_title: prod.seo_title || '',
          seo_description: prod.seo_description || '',
          weight: prod.weight != null ? String(prod.weight) : '',
          length: prod.length != null ? String(prod.length) : '',
          width: prod.width != null ? String(prod.width) : '',
          height: prod.height != null ? String(prod.height) : '',
          category_ids: (catRes.data || []).map((r: { category_id: string }) => r.category_id),
          tag_ids: (tagRes.data || []).map((r: { tag_id: string }) => r.tag_id),
          images: (imgRes.data || []).map((img: ImageRow) => ({
            src: img.src,
            alt: img.alt || '',
            position: img.position,
            is_thumbnail: img.is_thumbnail,
          })),
        });

        if (attrRes.data?.length) {
          setVarAttrs(attrRes.data.map((a: {
            product_attributes: { name: string } | null;
            options: string[];
            is_variation: boolean;
          }) => ({
            name: a.product_attributes?.name || '',
            optionsRaw: (a.options || []).join(', '),
            is_variation: a.is_variation ?? true,
          })));
        }

        if (varRes.data?.length) {
          setVariations(varRes.data.map((v: {
            id: string;
            attributes: { name: string; value: string }[];
            sku: string | null;
            regular_price: number | null;
            sale_price: number | null;
            cost_price: number | null;
            stock_status: string;
            manage_stock: boolean;
            stock_quantity: number | null;
            product_images: { src: string }[];
          }) => ({
            id: v.id,
            attributes: Array.isArray(v.attributes) ? v.attributes : [],
            sku: v.sku || '',
            regular_price: v.regular_price != null ? String(v.regular_price) : '',
            sale_price: v.sale_price != null ? String(v.sale_price) : '',
            cost_price: v.cost_price != null ? String(v.cost_price) : '',
            stock_status: (v.stock_status || 'instock') as VarRow['stock_status'],
            manage_stock: v.manage_stock || false,
            stock_quantity: v.stock_quantity != null ? String(v.stock_quantity) : '',
            image_url: v.product_images?.[0]?.src || '',
          })));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const setField = useCallback(<K extends keyof FormState>(key: K, val: FormState[K]) => {
    setForm(prev => ({ ...prev, [key]: val }));
  }, []);

  const handleNameChange = (name: string) => {
    setForm(prev => ({
      ...prev,
      name,
      slug: prev.slug && prev.slug !== toSlug(prev.name) ? prev.slug : toSlug(name),
    }));
  };

  const toggleCategory = (catId: string) => {
    setForm(prev => ({
      ...prev,
      category_ids: prev.category_ids.includes(catId)
        ? prev.category_ids.filter(c => c !== catId)
        : [...prev.category_ids, catId],
    }));
  };

  const toggleTag = (tagId: string) => {
    setForm(prev => ({
      ...prev,
      tag_ids: prev.tag_ids.includes(tagId)
        ? prev.tag_ids.filter(t => t !== tagId)
        : [...prev.tag_ids, tagId],
    }));
  };

  const addImageUrl = () => {
    const src = urlInput.trim();
    if (!src) return;
    setForm(prev => ({
      ...prev,
      images: [...prev.images, { src, alt: '', position: prev.images.length, is_thumbnail: prev.images.length === 0 }],
    }));
    setUrlInput('');
  };

  const removeImage = (idx: number) => {
    setForm(prev => {
      const imgs = prev.images.filter((_, i) => i !== idx).map((img, i) => ({
        ...img, position: i, is_thumbnail: i === 0,
      }));
      return { ...prev, images: imgs };
    });
  };

  const handleFileUpload = async (file: File, varIdx?: number) => {
    const url = await uploadImage(file);
    if (!url) return;
    if (varIdx !== undefined) {
      setVariations(prev => prev.map((v, i) => i === varIdx ? { ...v, image_url: url } : v));
    } else {
      setForm(prev => ({
        ...prev,
        images: [...prev.images, { src: url, alt: '', position: prev.images.length, is_thumbnail: prev.images.length === 0 }],
      }));
    }
  };

  const generateVariations = () => {
    const combos = generateCombinations(varAttrs);
    if (!combos.length) { alert('Add at least one attribute with options to generate variations.'); return; }
    setVariations(combos.map(attrs => ({
      attributes: attrs,
      sku: '',
      regular_price: '',
      sale_price: '',
      cost_price: '',
      stock_status: 'instock',
      manage_stock: false,
      stock_quantity: '',
      image_url: '',
    })));
  };

  const updateVariation = <K extends keyof VarRow>(idx: number, key: K, val: VarRow[K]) => {
    setVariations(prev => prev.map((v, i) => i === idx ? { ...v, [key]: val } : v));
  };

  const removeVariation = (idx: number) => {
    setVariations(prev => prev.filter((_, i) => i !== idx));
  };

  const resolveSkuPrefix = (): { prefix: string } | null => {
    if (!vendor?.id) {
      alert('Your store profile is still loading. Wait a moment and try again.');
      return null;
    }
    const ordered = orderedSelectedCategoryIds(categories, form.category_ids);
    const primaryCatId = ordered[0];
    if (!primaryCatId) {
      alert(
        'Select at least one category first. The first category in the list (top to bottom) sets the category code in your SKU.'
      );
      return null;
    }
    const cat = categories.find(c => c.id === primaryCatId);
    if (!cat) {
      alert('Could not resolve the selected category.');
      return null;
    }
    const catCode = categorySkuCode(cat.name, cat.slug);
    const venCode = vendorSkuCode(vendor.store_slug, vendor.store_name);
    return { prefix: `${catCode}-${venCode}-` };
  };

  const handleGenerateSimpleSku = async () => {
    const resolved = resolveSkuPrefix();
    if (!resolved) return;
    setSkuGenBusy(true);
    try {
      const extra_skus = form.sku.trim() ? [form.sku.trim()] : [];
      const { next_sku } = await api.suggestNextSku({ prefix: resolved.prefix, extra_skus });
      setField('sku', next_sku);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not compute next SKU.');
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
        .map(s => s.trim())
        .filter(Boolean);
      const { next_sku } = await api.suggestNextSku({ prefix: resolved.prefix, extra_skus });
      updateVariation(idx, 'sku', next_sku);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not compute next SKU.');
    } finally {
      setSkuGenBusy(false);
    }
  };

  const handleGenerateEmptyVariationSkus = async () => {
    const resolved = resolveSkuPrefix();
    if (!resolved) return;
    const emptyIdx = variations.map((v, i) => (!v.sku.trim() ? i : -1)).filter(i => i >= 0);
    if (!emptyIdx.length) {
      alert('Every variation already has a SKU.');
      return;
    }
    setSkuGenBusy(true);
    try {
      const prefix = resolved.prefix;
      const baseline = variations.map(v => v.sku.trim()).filter(Boolean);
      const assigned: string[] = [];
      for (let k = 0; k < emptyIdx.length; k++) {
        const { next_sku } = await api.suggestNextSku({
          prefix,
          extra_skus: [...baseline, ...assigned],
        });
        assigned.push(next_sku);
      }
      setVariations(prev => {
        const nextRows = [...prev];
        emptyIdx.forEach((rowIdx, j) => {
          nextRows[rowIdx] = { ...nextRows[rowIdx], sku: assigned[j] };
        });
        return nextRows;
      });
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not compute next SKU.');
    } finally {
      setSkuGenBusy(false);
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (submitStatus: 'draft' | 'published') => {
    if (!form.name.trim()) { alert('Product name is required.'); return; }
    if (!form.slug.trim()) { alert('Slug is required.'); return; }
    if (form.type === 'variable' && !variations.length) {
      alert('Please generate at least one variation for a variable product.');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description,
        short_description: form.short_description,
        status: submitStatus,
        type: form.type,
        manage_stock: form.manage_stock,
        stock_status: form.stock_status,
        is_virtual: form.is_virtual,
        ships_from_abroad: form.ships_from_abroad,
        seo_title: form.seo_title,
        seo_description: form.seo_description,
        images: form.images,
        category_ids: form.category_ids,
        tag_ids: form.tag_ids,
        weight: toNullableDim(form.weight),
        length: toNullableDim(form.length),
        width: toNullableDim(form.width),
        height: toNullableDim(form.height),
      };

      if (form.type === 'simple') {
        body.sku = form.sku;
        body.regular_price = form.regular_price;
        body.sale_price = form.sale_price;
        body.cost_price = form.cost_price !== '' ? Number(form.cost_price) : null;
        body.stock_quantity = form.manage_stock ? form.stock_quantity : null;
      } else {
        body.sku = null;
        body.cost_price = null;
        body.attributes = varAttrs
          .filter(a => a.name.trim())
          .map(a => ({
            name: a.name.trim(),
            options: a.optionsRaw.split(',').map(v => v.trim()).filter(Boolean),
            is_variation: a.is_variation,
          }));
        body.variations = variations.map(v => ({
          ...(v.id ? { id: v.id } : {}),
          attributes: v.attributes,
          sku: v.sku || null,
          regular_price:
            v.regular_price != null && v.regular_price !== '' ? Number(v.regular_price) : null,
          sale_price: v.sale_price != null && v.sale_price !== '' ? Number(v.sale_price) : null,
          cost_price: v.cost_price != null && v.cost_price !== '' ? Number(v.cost_price) : null,
          stock_status: v.stock_status,
          manage_stock: v.manage_stock,
          stock_quantity:
            v.manage_stock && v.stock_quantity != null && v.stock_quantity !== ''
              ? Number(v.stock_quantity)
              : null,
          image_url: v.image_url.trim() || null,
        }));
      }

      await api.upsertProduct(body, id);
      navigate('/products');
    } catch (err: unknown) {
      alert('Error saving product: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  // ── Category tree ─────────────────────────────────────────────────────────

  const parents = categories.filter(c => !c.parent_id);
  const childrenOf = (pid: string) => categories.filter(c => c.parent_id === pid);

  // ── Filtered tags ─────────────────────────────────────────────────────────

  const filteredTags = tags.filter(t =>
    !tagSearch || t.name.toLowerCase().includes(tagSearch.toLowerCase())
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-32 lg:pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/products" className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{isEdit ? 'Edit Product' : 'Add Product'}</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {isEdit ? 'Update your product details' : 'Create a new product for review'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Product Type */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-3">Product Type</h2>
            <div className="grid grid-cols-2 gap-3">
              {(['simple', 'variable'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setField('type', t)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    form.type === t
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className={`font-semibold text-sm capitalize ${form.type === t ? 'text-primary-700' : 'text-gray-700'}`}>
                    {t === 'simple' ? 'Simple Product' : 'Variable Product'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t === 'simple'
                      ? 'Single SKU with one price'
                      : 'Multiple variants (size, color, etc.)'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Basic Info */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-gray-900">Basic Information</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Product Name <span className="text-red-500">*</span>
              </label>
              <input
                className="input"
                placeholder="e.g. Men's Slim-Fit Chinos"
                value={form.name}
                onChange={e => handleNameChange(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Slug <span className="text-red-500">*</span>
              </label>
              <input
                className="input font-mono text-sm"
                placeholder="mens-slim-fit-chinos"
                value={form.slug}
                onChange={e => setField('slug', e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">URL-friendly identifier. Auto-generated from name.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Short Description</label>
              <RichTextEditor
                value={form.short_description}
                onChange={html => setField('short_description', html)}
                placeholder="Brief summary shown on product cards"
                minHeight="80px"
              />
              <p className="text-xs text-gray-400 mt-1">Same rich text as admin (JLO). HTML is stored as-is.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Description</label>
              <RichTextEditor
                value={form.description}
                onChange={html => setField('description', html)}
                placeholder="Full product description"
                minHeight="200px"
              />
              <p className="text-xs text-gray-400 mt-1">
                Includes images and formatting from imports. Use the image button to add a picture by URL.
              </p>
            </div>
          </div>

          {/* Package & shipping */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-gray-900">Package & shipping</h2>
            <p className="text-xs text-gray-500">
              Used for delivery quotes (e.g. per-kg rates). Optional for digital goods.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Weight (kg)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 0.5"
                  value={form.weight}
                  onChange={e => setField('weight', e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">L (cm)</label>
                <input
                  className="input text-sm"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="—"
                  value={form.length}
                  onChange={e => setField('length', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">W (cm)</label>
                <input
                  className="input text-sm"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="—"
                  value={form.width}
                  onChange={e => setField('width', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">H (cm)</label>
                <input
                  className="input text-sm"
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="—"
                  value={form.height}
                  onChange={e => setField('height', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Pricing & Stock (simple only) */}
          {form.type === 'simple' && (
            <div className="card space-y-4">
              <h2 className="font-semibold text-gray-900">Pricing & Stock</h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Regular Price (₦)</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.regular_price}
                    onChange={e => setField('regular_price', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Sale Price (₦)</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.sale_price}
                    onChange={e => setField('sale_price', e.target.value)}
                  />
                </div>
              </div>

              {/* Cost Price — private to vendor */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Lock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                  <label className="block text-sm font-medium text-amber-800">Your Cost Price (₦)</label>
                  <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">Private · Not visible to admin</span>
                </div>
                <input
                  className="input bg-white"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="What you paid / landed cost"
                  value={form.cost_price}
                  onChange={e => setField('cost_price', e.target.value)}
                />
                {form.cost_price && form.regular_price && (
                  <p className="text-xs text-amber-700">
                    Margin: ₦{(Number(form.regular_price) - Number(form.cost_price)).toLocaleString()}
                    {' '}({Number(form.regular_price) > 0 ? Math.round((1 - Number(form.cost_price) / Number(form.regular_price)) * 100) : 0}%)
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">SKU</label>
                  <input
                    className="input font-mono text-sm"
                    placeholder="e.g. LAP-JUL-001"
                    value={form.sku}
                    onChange={e => setField('sku', e.target.value)}
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
                    Builds <span className="font-mono">CAT-VEN-###</span> from your first selected category and store slug, then the next free number (catalog-wide).
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Stock Status</label>
                  <select
                    className="input"
                    value={form.stock_status}
                    onChange={e => setField('stock_status', e.target.value as FormState['stock_status'])}
                  >
                    <option value="instock">In Stock</option>
                    <option value="outofstock">Out of Stock</option>
                    <option value="onbackorder">On Backorder</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary-600"
                  checked={form.manage_stock}
                  onChange={e => setField('manage_stock', e.target.checked)}
                />
                <span className="text-sm font-medium text-gray-700">Manage stock quantity</span>
              </label>

              {form.manage_stock && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Stock Quantity</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={form.stock_quantity}
                    onChange={e => setField('stock_quantity', e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Attributes & Variations (variable only) */}
          {form.type === 'variable' && (
            <>
              {/* Attributes */}
              <div className="card space-y-4">
                <h2 className="font-semibold text-gray-900">Attributes</h2>
                <p className="text-sm text-gray-500">Define the attributes that create your variations (e.g. Size, Color).</p>

                <div className="space-y-3">
                  {varAttrs.map((attr, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <input
                          className="input text-sm"
                          placeholder="Attribute name (e.g. Size)"
                          value={attr.name}
                          onChange={e => setVarAttrs(prev => prev.map((a, i) => i === idx ? { ...a, name: e.target.value } : a))}
                        />
                        <input
                          className="input text-sm"
                          placeholder="Options, comma-separated"
                          value={attr.optionsRaw}
                          onChange={e => setVarAttrs(prev => prev.map((a, i) => i === idx ? { ...a, optionsRaw: e.target.value } : a))}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setVarAttrs(prev => prev.filter((_, i) => i !== idx))}
                        className="p-2.5 rounded-xl border border-gray-200 hover:bg-red-50 hover:border-red-300 text-gray-400 hover:text-red-500 transition-colors mt-0.5"
                        aria-label="Remove attribute"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setVarAttrs(prev => [...prev, { name: '', optionsRaw: '', is_variation: true }])}
                    className="btn-secondary btn-sm flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    Add Attribute
                  </button>
                  <button
                    type="button"
                    onClick={generateVariations}
                    className="btn-primary btn-sm flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Generate Variations
                  </button>
                </div>
              </div>

              {/* Variations */}
              {variations.length > 0 && (
                <div className="card space-y-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="font-semibold text-gray-900">Variations</h2>
                      <span className="text-sm text-gray-500">{variations.length} variant{variations.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 self-start">
                      <button
                        type="button"
                        onClick={() => void handleGenerateEmptyVariationSkus()}
                        disabled={skuGenBusy}
                        className="text-xs font-medium px-3 py-1.5 rounded-xl border border-primary-200 text-primary-700 bg-primary-50 hover:bg-primary-100 disabled:opacity-50"
                      >
                        {skuGenBusy ? 'Working…' : 'Fill SKUs on empty rows'}
                      </button>
                      {form.cost_price && (
                        <button
                          type="button"
                          onClick={() => setVariations(prev => prev.map(v => ({ ...v, cost_price: form.cost_price })))}
                          className="text-xs font-medium px-3 py-1.5 rounded-xl border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 flex items-center gap-1"
                        >
                          <Lock className="w-3 h-3" />
                          Apply cost to all
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {variations.map((v, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50/50">
                        {/* Variation label */}
                        <div className="flex items-center justify-between">
                          <div className="flex flex-wrap gap-1.5">
                            {v.attributes.map(a => (
                              <span key={a.name} className="badge bg-primary-100 text-primary-700 text-xs">
                                {a.name}: {a.value}
                              </span>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeVariation(idx)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Variation fields */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
                            <input
                              className="input text-sm py-2 min-h-0 h-10 font-mono"
                              placeholder="CAT-VEN-001"
                              value={v.sku}
                              onChange={e => updateVariation(idx, 'sku', e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => void handleGenerateVariationSku(idx)}
                              disabled={skuGenBusy}
                              className="mt-1 text-[10px] font-medium text-primary-600 hover:text-primary-800 disabled:opacity-50"
                            >
                              {skuGenBusy ? '…' : 'Generate SKU'}
                            </button>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Stock Status</label>
                            <select
                              className="input text-sm py-2 min-h-0 h-10"
                              value={v.stock_status}
                              onChange={e => updateVariation(idx, 'stock_status', e.target.value as VarRow['stock_status'])}
                            >
                              <option value="instock">In Stock</option>
                              <option value="outofstock">Out of Stock</option>
                              <option value="onbackorder">On Backorder</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Regular Price (₦)</label>
                            <input
                              className="input text-sm py-2 min-h-0 h-10"
                              type="number"
                              min="0"
                              placeholder="0.00"
                              value={v.regular_price}
                              onChange={e => updateVariation(idx, 'regular_price', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Sale Price (₦)</label>
                            <input
                              className="input text-sm py-2 min-h-0 h-10"
                              type="number"
                              min="0"
                              placeholder="0.00"
                              value={v.sale_price}
                              onChange={e => updateVariation(idx, 'sale_price', e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Cost Price per variation — private */}
                        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5">
                          <div className="flex items-center gap-1 mb-1.5">
                            <Lock className="w-3 h-3 text-amber-600" />
                            <label className="text-xs font-medium text-amber-800">Your Cost (₦)</label>
                            <span className="ml-auto text-[9px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 font-medium">Private</span>
                          </div>
                          <input
                            className="input text-sm py-2 min-h-0 h-9 bg-white"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Landed cost"
                            value={v.cost_price}
                            onChange={e => updateVariation(idx, 'cost_price', e.target.value)}
                          />
                          {v.cost_price && v.regular_price && (
                            <p className="text-[10px] text-amber-700 mt-1">
                              Margin: ₦{(Number(v.regular_price) - Number(v.cost_price)).toLocaleString()}
                            </p>
                          )}
                        </div>

                        {/* Manage stock */}
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-primary-600"
                            checked={v.manage_stock}
                            onChange={e => updateVariation(idx, 'manage_stock', e.target.checked)}
                          />
                          <span className="text-xs font-medium text-gray-700">Manage stock</span>
                        </label>
                        {v.manage_stock && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
                            <input
                              className="input text-sm py-2 min-h-0 h-10"
                              type="number"
                              min="0"
                              placeholder="0"
                              value={v.stock_quantity}
                              onChange={e => updateVariation(idx, 'stock_quantity', e.target.value)}
                            />
                          </div>
                        )}

                        {/* Variation image */}
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Variation Image</label>
                          <div className="flex gap-2">
                            <input
                              className="input text-sm py-2 min-h-0 h-10 flex-1"
                              placeholder="https://..."
                              value={v.image_url}
                              onChange={e => updateVariation(idx, 'image_url', e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => varFileRefs.current[idx]?.click()}
                              className="px-3 h-10 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-500 transition-colors flex items-center gap-1.5 text-sm"
                            >
                              <Upload className="w-3.5 h-3.5" />
                              Upload
                            </button>
                            <input
                              ref={el => { varFileRefs.current[idx] = el; }}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(file, idx);
                                e.target.value = '';
                              }}
                            />
                          </div>
                          {v.image_url && (
                            <img src={v.image_url} alt="variation" className="mt-2 h-16 w-16 object-cover rounded-lg border border-gray-200" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT COLUMN ────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* Images */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-900">Product Images</h2>

            {form.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {form.images.map((img, idx) => (
                  <div key={idx} className="relative group aspect-square">
                    <img
                      src={img.src}
                      alt={img.alt || 'product image'}
                      className="w-full h-full object-cover rounded-lg border border-gray-200"
                    />
                    {idx === 0 && (
                      <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-primary-600 text-white px-1.5 py-0.5 rounded-full">
                        Thumbnail
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!form.images.length && (
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center">
                <ImageIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No images added yet</p>
                <p className="text-xs text-gray-300 mt-0.5">First image will be the thumbnail</p>
              </div>
            )}

            {/* URL input */}
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm py-2 min-h-0 h-10"
                placeholder="https://example.com/image.jpg"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addImageUrl())}
              />
              <button
                type="button"
                onClick={addImageUrl}
                className="px-3 h-10 rounded-xl border border-gray-300 hover:bg-gray-50 text-gray-600 transition-colors text-sm font-medium"
              >
                Add
              </button>
            </div>

            {/* File upload */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full btn-secondary btn-sm flex items-center justify-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Upload from Device
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async e => {
                const files = Array.from(e.target.files || []);
                for (const file of files) await handleFileUpload(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* Categories */}
          <div className="card space-y-2">
            <h2 className="font-semibold text-gray-900 mb-3">Categories</h2>
            {categories.length === 0 ? (
              <p className="text-sm text-gray-400">No categories available</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {parents.map(parent => {
                  const children = childrenOf(parent.id);
                  return (
                    <div key={parent.id} className="space-y-1.5">
                      <label className="flex items-center gap-2 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-primary-600"
                          checked={form.category_ids.includes(parent.id)}
                          onChange={() => toggleCategory(parent.id)}
                        />
                        <span className="text-sm font-medium text-gray-800">{parent.name}</span>
                      </label>
                      {children.length > 0 && (
                        <div className="space-y-1.5 pl-5 border-l border-gray-100 ml-1">
                          {children.map(child => (
                            <label key={child.id} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 accent-primary-600"
                                checked={form.category_ids.includes(child.id)}
                                onChange={() => toggleCategory(child.id)}
                              />
                              <span className="text-xs text-gray-600">{child.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {form.category_ids.length > 0 && (
              <p className="text-xs text-primary-600 font-medium pt-1">
                {form.category_ids.length} selected
              </p>
            )}
          </div>

          {/* Tags */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-900">Tags</h2>
            <input
              className="input text-sm py-2 min-h-0 h-10"
              placeholder="Search tags…"
              value={tagSearch}
              onChange={e => setTagSearch(e.target.value)}
            />
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {filteredTags.length === 0 ? (
                <p className="text-sm text-gray-400">{tagSearch ? 'No matching tags' : 'No tags available'}</p>
              ) : (
                filteredTags.map(tag => (
                  <label key={tag.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary-600"
                      checked={form.tag_ids.includes(tag.id)}
                      onChange={() => toggleTag(tag.id)}
                    />
                    <span className="text-sm text-gray-700">{tag.name}</span>
                  </label>
                ))
              )}
            </div>
            {form.tag_ids.length > 0 && (
              <p className="text-xs text-primary-600 font-medium">{form.tag_ids.length} selected</p>
            )}
          </div>

          {/* SEO */}
          <div className="card">
            <button
              type="button"
              onClick={() => setSeoOpen(o => !o)}
              className="w-full flex items-center justify-between"
            >
              <h2 className="font-semibold text-gray-900">SEO</h2>
              {seoOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {seoOpen && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">SEO Title</label>
                  <input
                    className="input text-sm"
                    placeholder="Optimised page title…"
                    value={form.seo_title}
                    onChange={e => setField('seo_title', e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">{form.seo_title.length}/60 chars recommended</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">SEO Description</label>
                  <textarea
                    className="input resize-none text-sm"
                    rows={3}
                    placeholder="Meta description for search engines…"
                    value={form.seo_description}
                    onChange={e => setField('seo_description', e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1">{form.seo_description.length}/160 chars recommended</p>
                </div>
              </div>
            )}
          </div>

          {/* Flags */}
          <div className="card space-y-3">
            <h2 className="font-semibold text-gray-900">Product Flags</h2>
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary-600"
                checked={form.is_virtual}
                onChange={e => setField('is_virtual', e.target.checked)}
              />
              <div>
                <p className="text-sm font-medium text-gray-700">Virtual product</p>
                <p className="text-xs text-gray-400">Digital goods, services, no shipping needed</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary-600"
                checked={form.ships_from_abroad}
                onChange={e => setField('ships_from_abroad', e.target.checked)}
              />
              <div>
                <p className="text-sm font-medium text-gray-700">Ships from abroad</p>
                <p className="text-xs text-gray-400">Product is sourced internationally</p>
              </div>
            </label>
          </div>

          {/* Submit buttons (desktop) */}
          <div className="card space-y-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSubmit('published')}
              className="w-full btn-primary"
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving…
                </span>
              ) : (
                isEdit ? 'Update Product' : 'Publish Product'
              )}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSubmit('draft')}
              className="w-full btn-secondary"
            >
              Save as Draft
            </button>
          </div>
        </div>
      </div>

      {/* Mobile sticky submit bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4 pb-safe flex gap-3 lg:hidden z-20">
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSubmit('draft')}
          className="flex-1 btn-secondary"
        >
          Draft
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSubmit('published')}
          className="flex-[2] btn-primary"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving…
            </span>
          ) : (
            isEdit ? 'Update Product' : 'Publish Product'
          )}
        </button>
      </div>
    </div>
  );
}
