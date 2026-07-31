import { useState } from 'react';
import { ListOrdered, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import {
  VarAttr,
  VarRow,
  applyRealignFromOptionOrder,
  buildGeneratedVariations,
  generateCombinations,
  hasMeaningfulAttributes,
} from '../../lib/productVariations';

const inputClass = 'w-full rounded-xl bg-white px-3 py-3 text-sm text-gray-900 ring-1 ring-gray-100';
const inputStyle = { fontSize: '16px' } as const;

function BulkPriceFill({ onApply }: { onApply: (price: string, salePrice: string) => void }) {
  const [price, setPrice] = useState('');
  const [sale, setSale] = useState('');
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-primary-600">
        Set price for all variations
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Regular ₦" min={0} step={0.01} className="w-28 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" style={inputStyle} />
      <input type="number" value={sale} onChange={(e) => setSale(e.target.value)} placeholder="Sale ₦" min={0} step={0.01} className="w-28 rounded-lg border border-gray-200 px-2 py-1.5 text-xs" style={inputStyle} />
      <button type="button" onClick={() => { onApply(price, sale); setOpen(false); }} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white">
        Apply
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">
        Cancel
      </button>
    </div>
  );
}

interface ProductVariationsSectionProps {
  varAttrs: VarAttr[];
  setVarAttrs: React.Dispatch<React.SetStateAction<VarAttr[]>>;
  variations: VarRow[];
  setVariations: React.Dispatch<React.SetStateAction<VarRow[]>>;
  skuGenBusy: boolean;
  uploadingVariationIdx: number | null;
  variationImagePreviewUrl: string | null;
  setVariationImagePreviewUrl: (url: string | null) => void;
  onGenerateVariationSku: (idx: number) => void;
  onGenerateEmptySkus: () => void;
  onVariationImageUpload: (e: React.ChangeEvent<HTMLInputElement>, idx: number) => void;
  onNotify: (kind: 'error' | 'success' | 'warning', title: string, message: string) => void;
}

export function ProductVariationsSection({
  varAttrs,
  setVarAttrs,
  variations,
  setVariations,
  skuGenBusy,
  uploadingVariationIdx,
  variationImagePreviewUrl,
  setVariationImagePreviewUrl,
  onGenerateVariationSku,
  onGenerateEmptySkus,
  onVariationImageUpload,
  onNotify,
}: ProductVariationsSectionProps) {
  const updateAttr = (i: number, field: keyof VarAttr, value: string | boolean) =>
    setVarAttrs((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));

  const addAttr = () => setVarAttrs((prev) => [...prev, { name: '', optionsRaw: '', is_variation: true }]);
  const removeAttr = (i: number) => setVarAttrs((prev) => prev.filter((_, idx) => idx !== i));

  const updateVariation = (i: number, field: keyof VarRow, value: string | boolean) =>
    setVariations((prev) => prev.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));

  const removeVariation = (i: number) => setVariations((prev) => prev.filter((_, idx) => idx !== i));

  const handleGenerate = () => {
    const combos = buildGeneratedVariations(varAttrs, variations);
    if (combos.length === 0) {
      onNotify('error', 'No attributes', 'Add at least one attribute with options first');
      return;
    }
    setVariations(combos);
    onNotify('success', 'Variations generated', `${combos.length} variation row(s) ready`);
  };

  const handleRealign = () => {
    if (variations.length === 0) {
      onNotify('error', 'Nothing to realign', 'Add attributes and use Generate Variations first.');
      return;
    }
    const combos = generateCombinations(varAttrs);
    if (combos.length === 0) {
      onNotify('error', 'No matrix', 'Add at least one variation attribute with comma-separated options.');
      return;
    }
    const hadEmptyAttrs = variations.some((v) => !hasMeaningfulAttributes(v.attributes));
    const countMismatch = variations.length !== combos.length;
    setVariations(applyRealignFromOptionOrder(variations, varAttrs));
    if (countMismatch) {
      onNotify('warning', 'Realigned with note', `Row count (${variations.length}) does not match the full matrix (${combos.length}). Use Generate Variations to add or drop rows.`);
    } else if (hadEmptyAttrs) {
      onNotify('success', 'Rows realigned', 'Labels now follow your option list.');
    } else {
      onNotify('success', 'Rows realigned', 'Row order unchanged; labels updated to match your option list.');
    }
  };

  return (
    <>
      <div className="space-y-3 rounded-xl bg-white p-3.5 ring-1 ring-gray-100">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Attributes</p>
        {varAttrs.map((attr, i) => (
          <div key={i} className="space-y-2 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-100">
            <input value={attr.name} onChange={(e) => updateAttr(i, 'name', e.target.value)} placeholder="Attribute (e.g. Color)" className={inputClass} style={inputStyle} />
            <input value={attr.optionsRaw} onChange={(e) => updateAttr(i, 'optionsRaw', e.target.value)} placeholder="Options: Red, Blue, Green" className={inputClass} style={inputStyle} />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={attr.is_variation} onChange={(e) => updateAttr(i, 'is_variation', e.target.checked)} />
                Used for variations
              </label>
              <button type="button" onClick={() => removeAttr(i)} disabled={varAttrs.length === 1} className="text-gray-400 disabled:opacity-30">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={addAttr} className="flex items-center gap-1 text-xs font-semibold text-primary-600">
          <Plus className="h-3.5 w-3.5" />
          Add attribute
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleRealign} disabled={variations.length === 0} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-primary-200 bg-primary-50 py-2.5 text-xs font-semibold text-primary-800 disabled:opacity-40">
            <ListOrdered className="h-3.5 w-3.5" />
            Realign rows
          </button>
          <button type="button" onClick={handleGenerate} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary-600 py-2.5 text-xs font-semibold text-white">
            <RefreshCw className="h-3.5 w-3.5" />
            Generate variations
          </button>
        </div>
        <p className="text-[11px] leading-snug text-gray-500">
          Generate creates or updates rows from attribute options. Realign sets row 1 = first option in your comma list.
        </p>
      </div>

      {variations.length > 0 && (
        <div className="space-y-3 rounded-xl bg-white p-3.5 ring-1 ring-gray-100">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Variations ({variations.length})
            </p>
            <button type="button" onClick={onGenerateEmptySkus} disabled={skuGenBusy} className="text-[11px] font-semibold text-primary-600 disabled:opacity-50">
              {skuGenBusy ? '…' : 'Fill empty SKUs'}
            </button>
          </div>

          <BulkPriceFill
            onApply={(price, salePrice) => {
              setVariations((prev) =>
                prev.map((v) => ({
                  ...v,
                  regular_price: price || v.regular_price,
                  sale_price: salePrice !== undefined ? salePrice : v.sale_price,
                })),
              );
            }}
          />

          <div className="space-y-3">
            {variations.map((v, i) => (
              <div key={i} className="space-y-3 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-100">
                <div className="flex flex-wrap gap-1.5">
                  {v.attributes.length === 0 ? (
                    <span className="text-xs italic text-amber-600">No attributes — use Realign or Generate</span>
                  ) : (
                    v.attributes.map((a, ai) => (
                      <span key={`${a.name}-${a.value}-${ai}`} className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs text-gray-800">
                        {a.name}: {a.value}
                      </span>
                    ))
                  )}
                </div>

                <div className="flex items-start gap-3">
                  {v.image_url.trim() ? (
                    <button type="button" onClick={() => setVariationImagePreviewUrl(v.image_url.trim())} className="overflow-hidden rounded-lg border border-gray-200">
                      <img src={v.image_url.trim()} alt="" className="h-14 w-14 object-contain" />
                    </button>
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-gray-200 text-[9px] text-gray-400">
                      No image
                    </div>
                  )}
                  <label className={`flex h-10 w-10 items-center justify-center rounded-lg border ${uploadingVariationIdx === i ? 'pointer-events-none opacity-50' : 'cursor-pointer border-primary-200 text-primary-600'}`}>
                    {uploadingVariationIdx === i ? '…' : <Upload className="h-4 w-4" />}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploadingVariationIdx !== null} onChange={(e) => onVariationImageUpload(e, i)} />
                  </label>
                </div>

                <input type="url" value={v.image_url} onChange={(e) => updateVariation(i, 'image_url', e.target.value)} placeholder="Image URL" className={`${inputClass} font-mono text-xs`} style={inputStyle} />

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] text-gray-500">SKU</label>
                    <input value={v.sku} onChange={(e) => updateVariation(i, 'sku', e.target.value)} className={inputClass} style={inputStyle} />
                    <button type="button" onClick={() => onGenerateVariationSku(i)} disabled={skuGenBusy} className="mt-1 text-[11px] font-semibold text-primary-600 disabled:opacity-50">
                      Generate
                    </button>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-gray-500">Stock</label>
                    <select value={v.stock_status} onChange={(e) => updateVariation(i, 'stock_status', e.target.value)} className={inputClass} style={inputStyle}>
                      <option value="instock">In stock</option>
                      <option value="outofstock">Out of stock</option>
                      <option value="onbackorder">Backorder</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-gray-500">Regular (₦)</label>
                    <input type="number" min={0} step={0.01} value={v.regular_price} onChange={(e) => updateVariation(i, 'regular_price', e.target.value)} className={inputClass} style={inputStyle} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] text-gray-500">Sale (₦)</label>
                    <input type="number" min={0} step={0.01} value={v.sale_price} onChange={(e) => updateVariation(i, 'sale_price', e.target.value)} className={inputClass} style={inputStyle} />
                  </div>
                </div>

                <button type="button" onClick={() => removeVariation(i)} className="flex items-center gap-1 text-xs text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove row
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {variationImagePreviewUrl && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onClick={() => setVariationImagePreviewUrl(null)} role="dialog" aria-modal="true">
          <button type="button" onClick={() => setVariationImagePreviewUrl(null)} className="absolute right-3 top-3 rounded-full bg-white/10 p-2 text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
          <img src={variationImagePreviewUrl} alt="" className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  );
}
