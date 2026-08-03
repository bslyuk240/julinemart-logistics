import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, ImagePlus, Loader, Sparkles, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import RichTextEditor from '../../components/RichTextEditor';
import { clearProductListSessionCache } from '../../lib/productListSessionCache';
import { toSlug, toNullableDim, categorySkuCode, vendorSkuCode, orderedSelectedCategoryIds, type CategoryLike } from '../../lib/productSku';
import { VarAttr, VarRow, defaultVarAttrs, realignVariationRowsOnLoad } from '../../lib/productVariations';
import { ProductVariationsSection } from '../components/ProductVariationsSection';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  PRODUCT_UPLOAD_STEPS,
  ProductUploadForm,
  emptyProductUploadForm,
} from '../lib/productUploadForm';
import { PRODUCT_IMAGE_ACCEPT, uploadProductImageFile } from '../../lib/productImageUpload';

interface VendorOption { id: string; store_name: string; store_slug: string; hub_id?: string }
interface HubOption { id: string; name: string; code: string; is_sub_hub?: boolean; parent_hub_name?: string }
interface TagOption { id: string; name: string }

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
const inputCls = 'w-full rounded-xl bg-white px-3 py-3 text-sm text-gray-900 ring-1 ring-gray-100';
const inputStyle = { fontSize: '16px' } as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  );
}

export default function MobileProductUpload() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const notification = useNotification();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('id');

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ProductUploadForm>(emptyProductUploadForm);
  const [varAttrs, setVarAttrs] = useState<VarAttr[]>(defaultVarAttrs());
  const [variations, setVariations] = useState<VarRow[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [allCategories, setAllCategories] = useState<CategoryLike[]>([]);
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingProduct, setLoadingProduct] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const [skuGenBusy, setSkuGenBusy] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVariationIdx, setUploadingVariationIdx] = useState<number | null>(null);
  const [variationImagePreviewUrl, setVariationImagePreviewUrl] = useState<string | null>(null);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const slugEditedManually = useRef(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(
    (): Record<string, string> => ({
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    }),
    [session],
  );

  const patch = (p: Partial<ProductUploadForm>) => setForm((prev) => ({ ...prev, ...p }));

  const notify = (kind: 'error' | 'success' | 'warning', title: string, message: string) => {
    if (kind === 'error') notification.error(title, message);
    else if (kind === 'warning') notification.warning(title, message);
    else notification.success(title, message);
  };

  useEffect(() => {
    (async () => {
      try {
        const meta = (type: string) =>
          fetch(`${functionsBase}/catalog-meta?type=${type}`, { headers: authHeaders() }).then((r) => r.json()).catch(() => ({ data: [] }));
        const [v, h, c, t] = await Promise.all([meta('vendors'), meta('hubs'), meta('categories'), meta('tags')]);
        setVendors(v.data || []);
        setHubs((h.data || []).map((hub: HubOption & { parent_hub?: { name?: string } }) => ({ ...hub, parent_hub_name: hub.parent_hub?.name ?? hub.parent_hub_name })));
        setAllCategories(c.data || []);
        setAllTags(t.data || []);
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [authHeaders]);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      setLoadingProduct(true);
      try {
        const res = await fetch(`${functionsBase}/catalog-product?id=${editId}`);
        const json = await res.json();
        if (!json.success || !json.data) return;
        const p = json.data;
        setForm({
          name: p.name || '', slug: p.slug || '',
          short_description: p.short_description || '', description: p.description || '',
          status: p.status || 'draft', type: p.type || 'simple',
          regular_price: p.regular_price != null ? String(p.regular_price) : '',
          sale_price: p.sale_price != null ? String(p.sale_price) : '',
          sku: p.sku || '',
          manage_stock: !!p.manage_stock,
          stock_quantity: p.stock_quantity != null ? String(p.stock_quantity) : '',
          stock_status: p.stock_status || 'instock',
          is_virtual: !!p.is_virtual,
          ships_from_abroad: !!p.ships_from_abroad,
          vendor_id: p.vendor?.id || '', hub_id: p.hub?.id || '',
          seo_title: p.seo_title || '', seo_description: p.seo_description || '',
          weight: p.weight != null ? String(p.weight) : '',
          length: p.length != null ? String(p.length) : '',
          width: p.width != null ? String(p.width) : '',
          height: p.height != null ? String(p.height) : '',
          category_ids: (p.categories || []).map((c: { id: string }) => c.id),
          tag_ids: (p.tags || []).map((t: { id: string }) => t.id),
          images: (p.images || []).map((img: { src: string; alt?: string; position?: number; is_thumbnail?: boolean }) => ({
            src: img.src, alt: img.alt || '', position: img.position ?? 0, is_thumbnail: !!img.is_thumbnail,
          })),
        });
        if (p.type === 'variable') {
          const attrs: VarAttr[] = (p.attributes || []).map((a: { name: string; options: string[]; is_variation?: boolean }) => ({
            name: a.name || '', optionsRaw: (a.options || []).join(', '), is_variation: a.is_variation ?? true,
          }));
          const attrsForEditor = attrs.length > 0 ? attrs : defaultVarAttrs();
          setVarAttrs(attrsForEditor);
          const rows: VarRow[] = (p.variations || []).map((v: Record<string, unknown>) => ({
            id: v.id as string | undefined,
            attributes: Array.isArray(v.attributes)
              ? (v.attributes as Array<{ name?: string; value?: string; option?: string }>).map((a) => ({ name: a.name ?? '', value: a.value ?? a.option ?? '' }))
              : [],
            sku: (v.sku as string) || '',
            regular_price: v.regular_price != null ? String(v.regular_price) : '',
            sale_price: v.sale_price != null ? String(v.sale_price) : '',
            stock_status: (v.stock_status as VarRow['stock_status']) || 'instock',
            manage_stock: !!v.manage_stock,
            stock_quantity: v.stock_quantity != null ? String(v.stock_quantity) : '',
            image_url: (v.image as { src?: string })?.src || '',
          }));
          setVariations(realignVariationRowsOnLoad(rows, attrsForEditor));
        }
        slugEditedManually.current = true;
      } finally {
        setLoadingProduct(false);
      }
    })();
  }, [editId]);

  const handleNameChange = (name: string) => {
    patch({ name, slug: slugEditedManually.current ? form.slug : toSlug(name) });
  };

  const toggleCategory = (id: string) =>
    patch({ category_ids: form.category_ids.includes(id) ? form.category_ids.filter((c) => c !== id) : [...form.category_ids, id] });

  const toggleTag = (id: string) =>
    patch({ tag_ids: form.tag_ids.includes(id) ? form.tag_ids.filter((t) => t !== id) : [...form.tag_ids, id] });

  const uploadImageFile = async (file: File) => {
    const { url, error } = await uploadProductImageFile(supabase, file);
    if (error) { notification.error('Upload failed', error); return null; }
    return url;
  };

  const addImageUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    patch({ images: [...form.images, { src: trimmed, alt: '', position: form.images.length, is_thumbnail: form.images.length === 0 }] });
  };

  const resolveSkuPrefix = () => {
    if (!form.vendor_id) { notification.error('Generate SKU', 'Select a vendor first.'); return null; }
    const primaryCatId = orderedSelectedCategoryIds(allCategories, form.category_ids)[0];
    if (!primaryCatId) { notification.error('Generate SKU', 'Select at least one category first.'); return null; }
    const cat = allCategories.find((c) => c.id === primaryCatId);
    const ven = vendors.find((v) => v.id === form.vendor_id);
    if (!cat || !ven) return null;
    return `${categorySkuCode(cat.name, cat.slug)}-${vendorSkuCode(ven.store_slug, ven.store_name)}-`;
  };

  const suggestNextSku = async (prefix: string, extra: string[]) => {
    const res = await fetch(`${functionsBase}/product-sku-next`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ prefix, extra_skus: extra }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) throw new Error(json.error || 'Could not compute next SKU');
    return json.data.next_sku as string;
  };

  const handleGenerateSku = async () => {
    const prefix = resolveSkuPrefix();
    if (!prefix) return;
    setSkuGenBusy(true);
    try { patch({ sku: await suggestNextSku(prefix, form.sku.trim() ? [form.sku.trim()] : []) }); }
    catch (e) { notification.error('Generate SKU', e instanceof Error ? e.message : 'Failed'); }
    finally { setSkuGenBusy(false); }
  };

  const handleGenerateVariationSku = async (idx: number) => {
    const prefix = resolveSkuPrefix();
    if (!prefix) return;
    setSkuGenBusy(true);
    try {
      const extra = variations.map((v, j) => (j === idx ? '' : v.sku)).map((s) => s.trim()).filter(Boolean);
      const next = await suggestNextSku(prefix, extra);
      setVariations((prev) => prev.map((v, i) => (i === idx ? { ...v, sku: next } : v)));
    } catch (e) { notification.error('Generate SKU', e instanceof Error ? e.message : 'Failed'); }
    finally { setSkuGenBusy(false); }
  };

  const handleGenerateEmptyVariationSkus = async () => {
    const prefix = resolveSkuPrefix();
    if (!prefix) return;
    const emptyIdx = variations.map((v, i) => (!v.sku.trim() ? i : -1)).filter((i) => i >= 0);
    if (!emptyIdx.length) { notification.error('Generate SKU', 'Every variation already has a SKU.'); return; }
    setSkuGenBusy(true);
    try {
      const baseline = variations.map((v) => v.sku.trim()).filter(Boolean);
      const assigned: string[] = [];
      for (let k = 0; k < emptyIdx.length; k++) assigned.push(await suggestNextSku(prefix, [...baseline, ...assigned]));
      setVariations((prev) => {
        const next = [...prev];
        emptyIdx.forEach((rowIdx, j) => { next[rowIdx] = { ...next[rowIdx], sku: assigned[j] }; });
        return next;
      });
    } catch (e) { notification.error('Generate SKU', e instanceof Error ? e.message : 'Failed'); }
    finally { setSkuGenBusy(false); }
  };

  const handleVariationImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingVariationIdx(idx);
    const url = await uploadImageFile(file);
    setUploadingVariationIdx(null);
    if (url) setVariations((prev) => prev.map((v, i) => (i === idx ? { ...v, image_url: url } : v)));
  };

  const runAiDraft = async () => {
    if (aiDrafting) return;
    setAiDrafting(true);
    try {
      const categoryNames = form.category_ids.map((id) => allCategories.find((c) => c.id === id)?.name).filter(Boolean) as string[];
      const existingDescImages = form.description.match(/<img\b[^>]*>/gi) || [];
      const res = await fetch(`${functionsBase}/admin-ai-product-draft`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name: form.name, short_description: form.short_description, description: form.description, category_names: categoryNames, image_urls: form.images.map((i) => i.src) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.data) throw new Error(json.error || 'AI failed');
      const draft = json.data;
      const nextName = draft.suggested_name?.trim() || form.name;
      const nextDesc = draft.full_description_html?.trim() || form.description;
      const restored = existingDescImages.length > 0 && !/<img\b/i.test(nextDesc) ? `${nextDesc}\n${existingDescImages.join('\n')}` : nextDesc;
      patch({
        name: nextName,
        slug: slugEditedManually.current ? form.slug : toSlug(nextName),
        short_description: draft.short_description_html?.trim() || form.short_description,
        description: restored,
        seo_title: draft.seo_title?.trim() || form.seo_title,
        seo_description: draft.seo_description?.trim() || form.seo_description,
      });
      notification.success('AI draft ready', 'Review the text before publishing.');
    } catch (e) { notification.error('AI failed', e instanceof Error ? e.message : 'Could not generate'); }
    finally { setAiDrafting(false); }
  };

  const validateStep = (idx: number) => {
    if (idx === 0 && !form.name.trim()) { notification.error('Required', 'Product name is required'); return false; }
    if (idx === 1 && !form.vendor_id) { notification.error('Required', 'Select a vendor'); return false; }
    if (idx === 3 && form.type === 'variable' && variations.length === 0) {
      notification.error('Required', 'Generate at least one variation'); return false;
    }
    return true;
  };

  const save = async (targetStatus: 'draft' | 'published') => {
    if (!form.name.trim() || !form.slug.trim() || !form.vendor_id) {
      notification.error('Validation', 'Name, slug and vendor are required');
      return;
    }
    if (form.type === 'variable' && variations.length === 0) {
      notification.error('Validation', 'Add variations before saving');
      return;
    }
    setSaving(true);
    try {
      const url = editId ? `${functionsBase}/catalog-product-upsert?id=${editId}` : `${functionsBase}/catalog-product-upsert`;
      const payload: Record<string, unknown> = {
        ...form,
        status: targetStatus,
        sku: form.type === 'simple' ? (form.sku.trim() || null) : null,
        regular_price: form.type === 'simple' && form.regular_price !== '' ? Number(form.regular_price) : null,
        sale_price: form.type === 'simple' && form.sale_price !== '' ? Number(form.sale_price) : null,
        stock_quantity: form.manage_stock && form.stock_quantity !== '' ? Number(form.stock_quantity) : null,
        vendor_id: form.vendor_id || null,
        hub_id: form.hub_id || null,
        weight: toNullableDim(form.weight),
        length: toNullableDim(form.length),
        width: toNullableDim(form.width),
        height: toNullableDim(form.height),
      };
      if (form.type === 'variable') {
        payload.attributes = varAttrs.filter((a) => a.name.trim()).map((a) => ({
          name: a.name.trim(), options: a.optionsRaw.split(',').map((o) => o.trim()).filter(Boolean), is_variation: a.is_variation,
        }));
        payload.variations = variations.map((v) => ({
          ...(v.id ? { id: v.id } : {}),
          attributes: v.attributes,
          sku: v.sku || null,
          regular_price: v.regular_price !== '' ? Number(v.regular_price) : null,
          sale_price: v.sale_price !== '' ? Number(v.sale_price) : null,
          stock_status: v.stock_status,
          manage_stock: v.manage_stock,
          stock_quantity: v.manage_stock && v.stock_quantity !== '' ? Number(v.stock_quantity) : null,
          image_url: v.image_url.trim() || null,
        }));
      } else {
        payload.attributes = [];
        payload.variations = [];
      }
      const res = await fetch(url, { method: editId ? 'PUT' : 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed');
      clearProductListSessionCache();
      notification.success('Saved', `"${json.data.name}" saved as ${json.data.status}`);
      navigate('/admin/products/moderation');
    } catch (e) { notification.error('Save failed', e instanceof Error ? e.message : 'Unable to save'); }
    finally { setSaving(false); }
  };

  if (loadingMeta || loadingProduct) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader className="h-6 w-6 animate-spin text-primary-600" /></div>;
  }

  const current = PRODUCT_UPLOAD_STEPS[step];
  const progress = ((step + 1) / PRODUCT_UPLOAD_STEPS.length) * 100;
  const topCategories = allCategories.filter((c) => !c.parent_id);
  const filteredTags = allTags.filter((t) => !tagFilter || t.name.toLowerCase().includes(tagFilter.toLowerCase()));

  const renderStep = () => {
    switch (current.id) {
      case 'basics':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['simple', 'variable'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { patch({ type: t }); if (t === 'simple') setVariations([]); }}
                  className={`rounded-xl px-3 py-3 text-left ring-2 ${form.type === t ? 'bg-primary-50 ring-primary-500' : 'bg-white ring-gray-100'}`}
                >
                  <p className="text-sm font-semibold capitalize">{t}</p>
                  <p className="text-[11px] text-gray-500">{t === 'simple' ? 'One SKU & price' : 'Options & variations'}</p>
                </button>
              ))}
            </div>
            <Field label="Product name *">
              <input value={form.name} onChange={(e) => handleNameChange(e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
            <Field label="Slug *">
              <input value={form.slug} onChange={(e) => { slugEditedManually.current = true; patch({ slug: e.target.value }); }} className={`${inputCls} font-mono text-xs`} style={inputStyle} />
            </Field>
            <Field label="Short description">
              <RichTextEditor value={form.short_description} onChange={(html) => patch({ short_description: html })} minHeight="72px" placeholder="Card summary" />
            </Field>
            <Field label="Full description">
              <RichTextEditor value={form.description} onChange={(html) => patch({ description: html })} minHeight="120px" placeholder="Full details" />
            </Field>
            <button type="button" onClick={runAiDraft} disabled={aiDrafting || !form.name} className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-50 py-3 text-sm font-semibold text-purple-700 ring-1 ring-purple-100 disabled:opacity-50">
              <Sparkles className="h-4 w-4" />
              {aiDrafting ? 'Generating…' : 'Generate copy with AI'}
            </button>
          </div>
        );
      case 'vendor':
        return (
          <div className="space-y-4">
            <Field label="Vendor *">
              <select value={form.vendor_id} onChange={(e) => { const v = vendors.find((x) => x.id === e.target.value); patch({ vendor_id: e.target.value, hub_id: v?.hub_id || form.hub_id }); }} className={inputCls} style={inputStyle}>
                <option value="">Choose vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.store_name}</option>)}
              </select>
            </Field>
            <Field label="Fulfillment hub">
              <select value={form.hub_id} onChange={(e) => patch({ hub_id: e.target.value })} className={inputCls} style={inputStyle}>
                <option value="">Ships from vendor</option>
                {hubs.map((h) => <option key={h.id} value={h.id}>{h.is_sub_hub ? `↳ ${h.name}` : `${h.name} (${h.code})`}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <input type="checkbox" checked={form.ships_from_abroad} onChange={(e) => patch({ ships_from_abroad: e.target.checked })} />
              <span className="text-sm text-gray-800">Ships from abroad</span>
            </label>
            <label className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <input type="checkbox" checked={form.is_virtual} onChange={(e) => patch({ is_virtual: e.target.checked })} />
              <span className="text-sm text-gray-800">Virtual product (no shipping)</span>
            </label>
            <Field label="Weight (kg)">
              <input type="number" min={0} step={0.01} value={form.weight} onChange={(e) => patch({ weight: e.target.value })} className={inputCls} style={inputStyle} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="L (cm)"><input type="number" min={0} step={0.1} value={form.length} onChange={(e) => patch({ length: e.target.value })} className={inputCls} style={inputStyle} /></Field>
              <Field label="W (cm)"><input type="number" min={0} step={0.1} value={form.width} onChange={(e) => patch({ width: e.target.value })} className={inputCls} style={inputStyle} /></Field>
              <Field label="H (cm)"><input type="number" min={0} step={0.1} value={form.height} onChange={(e) => patch({ height: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            </div>
          </div>
        );
      case 'catalog':
        return (
          <div className="space-y-4">
            <button type="button" onClick={() => setCategorySheetOpen(true)} className="w-full rounded-xl bg-white p-4 text-left ring-1 ring-gray-100">
              <p className="text-xs font-medium text-gray-400">Categories</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{form.category_ids.length ? `${form.category_ids.length} selected` : 'Tap to select'}</p>
            </button>
            <button type="button" onClick={() => setTagSheetOpen(true)} className="w-full rounded-xl bg-white p-4 text-left ring-1 ring-gray-100">
              <p className="text-xs font-medium text-gray-400">Tags</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{form.tag_ids.length ? `${form.tag_ids.length} selected` : 'Tap to select'}</p>
            </button>
          </div>
        );
      case 'offer':
        return form.type === 'simple' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Regular ₦"><input type="number" min={0} step={0.01} value={form.regular_price} onChange={(e) => patch({ regular_price: e.target.value })} className={inputCls} style={inputStyle} /></Field>
              <Field label="Sale ₦"><input type="number" min={0} step={0.01} value={form.sale_price} onChange={(e) => patch({ sale_price: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            </div>
            <Field label="SKU">
              <div className="flex gap-2">
                <input value={form.sku} onChange={(e) => patch({ sku: e.target.value })} className={`${inputCls} flex-1 font-mono`} style={inputStyle} />
                <button type="button" onClick={handleGenerateSku} disabled={skuGenBusy} className="shrink-0 rounded-xl bg-gray-900 px-4 text-xs font-semibold text-white disabled:opacity-50">{skuGenBusy ? '…' : 'Gen'}</button>
              </div>
            </Field>
            <Field label="Stock status">
              <select value={form.stock_status} onChange={(e) => patch({ stock_status: e.target.value as ProductUploadForm['stock_status'] })} className={inputCls} style={inputStyle}>
                <option value="instock">In stock</option><option value="outofstock">Out of stock</option><option value="onbackorder">Backorder</option>
              </select>
            </Field>
            <label className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <input type="checkbox" checked={form.manage_stock} onChange={(e) => patch({ manage_stock: e.target.checked })} />
              <span className="text-sm">Track quantity</span>
            </label>
            {form.manage_stock && <Field label="Quantity"><input type="number" min={0} value={form.stock_quantity} onChange={(e) => patch({ stock_quantity: e.target.value })} className={inputCls} style={inputStyle} /></Field>}
          </div>
        ) : (
          <ProductVariationsSection
            varAttrs={varAttrs} setVarAttrs={setVarAttrs} variations={variations} setVariations={setVariations}
            skuGenBusy={skuGenBusy} uploadingVariationIdx={uploadingVariationIdx}
            variationImagePreviewUrl={variationImagePreviewUrl} setVariationImagePreviewUrl={setVariationImagePreviewUrl}
            onGenerateVariationSku={handleGenerateVariationSku} onGenerateEmptySkus={handleGenerateEmptyVariationSkus}
            onVariationImageUpload={handleVariationImageUpload} onNotify={notify}
          />
        );
      case 'media':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {form.images.map((img, i) => (
                <div key={i} className="relative aspect-square overflow-hidden rounded-xl ring-1 ring-gray-100">
                  <img src={img.src} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => patch({ images: form.images.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, position: idx, is_thumbnail: idx === 0 })) })} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-3 w-3" /></button>
                  {img.is_thumbnail && <span className="absolute bottom-1 left-1 rounded bg-primary-600 px-1.5 py-0.5 text-[9px] font-bold text-white">Main</span>}
                </div>
              ))}
              <button type="button" onClick={() => galleryInputRef.current?.click()} disabled={uploadingImage} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl bg-white ring-1 ring-dashed ring-gray-200 text-gray-400">
                <ImagePlus className="h-5 w-5" />
                <span className="text-[10px]">{uploadingImage ? '…' : 'Gallery'}</span>
              </button>
              <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={uploadingImage} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl bg-white ring-1 ring-dashed ring-gray-200 text-gray-400">
                <Camera className="h-5 w-5" />
                <span className="text-[10px]">{uploadingImage ? '…' : 'Camera'}</span>
              </button>
            </div>
            <input ref={galleryInputRef} type="file" accept={PRODUCT_IMAGE_ACCEPT} className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
              setUploadingImage(true); const url = await uploadImageFile(file); setUploadingImage(false);
              if (url) addImageUrl(url);
            }} />
            <input ref={cameraInputRef} type="file" accept={PRODUCT_IMAGE_ACCEPT} capture="environment" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
              setUploadingImage(true); const url = await uploadImageFile(file); setUploadingImage(false);
              if (url) addImageUrl(url);
            }} />
            <Field label="Or paste image URL">
              <input type="url" placeholder="https://…" className={inputCls} style={inputStyle} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addImageUrl((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} />
            </Field>
          </div>
        );
      case 'review':
        return (
          <div className="space-y-4">
            <div className="rounded-xl bg-white p-4 ring-1 ring-gray-100">
              <p className="font-semibold text-gray-900">{form.name || 'Untitled'}</p>
              <p className="text-xs text-gray-500 capitalize">{form.type} · {vendors.find((v) => v.id === form.vendor_id)?.store_name || 'No vendor'}</p>
              <p className="mt-2 text-xs text-gray-500">{form.category_ids.length} categories · {form.tag_ids.length} tags · {form.images.length} photos</p>
            </div>
            <Field label="SEO title"><input value={form.seo_title} onChange={(e) => patch({ seo_title: e.target.value })} className={inputCls} style={inputStyle} /></Field>
            <Field label="SEO description"><textarea value={form.seo_description} onChange={(e) => patch({ seo_description: e.target.value })} rows={3} className={inputCls} style={inputStyle} /></Field>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-0 flex-col" style={{ paddingBottom: `calc(${TABBAR_SPACE} + 72px)` }}>
      <div className="sticky top-0 z-10 space-y-2 bg-gray-50 px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigate('/admin/products/moderation')} className="rounded-lg p-2 text-gray-600 hover:bg-white">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold text-gray-900">{editId ? 'Edit product' : 'Add product'}</h1>
            <p className="text-xs text-gray-500">Step {step + 1}/{PRODUCT_UPLOAD_STEPS.length}: {current.title}</p>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
          <div className="h-full rounded-full bg-primary-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-gray-400">{current.subtitle}</p>
      </div>

      <div className="flex-1 px-4 py-2">{renderStep()}</div>

      <div className="fixed inset-x-0 z-30 border-t border-gray-200 bg-white p-3" style={{ bottom: TABBAR_SPACE }}>
        <div className="flex gap-2">
          {step > 0 ? (
            <button type="button" onClick={() => setStep((s) => s - 1)} className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold">
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
          ) : (
            <button type="button" onClick={() => navigate('/admin/products/moderation')} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold">Cancel</button>
          )}
          {step < PRODUCT_UPLOAD_STEPS.length - 1 ? (
            <button type="button" onClick={() => { if (validateStep(step)) setStep((s) => s + 1); }} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex flex-[2] gap-2">
              <button type="button" disabled={saving} onClick={() => save('draft')} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold disabled:opacity-50">Draft</button>
              <button type="button" disabled={saving} onClick={() => save('published')} className="flex-1 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Saving…' : 'Publish'}
              </button>
            </div>
          )}
        </div>
      </div>

      <Sheet open={categorySheetOpen} onClose={() => setCategorySheetOpen(false)} ariaLabel="Categories">
        <h3 className="text-base font-bold">Categories</h3>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {topCategories.map((cat) => (
            <div key={cat.id}>
              <label className="flex items-center gap-2 py-1">
                <input type="checkbox" checked={form.category_ids.includes(cat.id)} onChange={() => toggleCategory(cat.id)} />
                <span className="text-sm font-medium">{cat.name}</span>
              </label>
              {allCategories.filter((c) => c.parent_id === cat.id).map((child) => (
                <label key={child.id} className="flex items-center gap-2 py-1 pl-6">
                  <input type="checkbox" checked={form.category_ids.includes(child.id)} onChange={() => toggleCategory(child.id)} />
                  <span className="text-sm text-gray-600">{child.name}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setCategorySheetOpen(false)} className="mt-3 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white">Done</button>
      </Sheet>

      <Sheet open={tagSheetOpen} onClose={() => setTagSheetOpen(false)} ariaLabel="Tags">
        <h3 className="text-base font-bold">Tags</h3>
        <input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="Filter…" className={inputCls} style={inputStyle} />
        <div className="flex max-h-[50vh] flex-wrap gap-2 overflow-y-auto pt-2">
          {filteredTags.map((tag) => {
            const active = form.tag_ids.includes(tag.id);
            return (
              <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)} className={`rounded-full px-3 py-2 text-xs font-medium ${active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                {tag.name}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setTagSheetOpen(false)} className="mt-3 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white">Done</button>
      </Sheet>
    </div>
  );
}
