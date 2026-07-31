import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader, Package, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { Sheet } from '../Sheet';
import { formatNaira } from '../lib/displayUtils';
import {
  CJ_SEARCH_PAGE_SIZE,
  callGlobalSourcing,
  runImportJob,
  type HubOption,
  type PricingPreview,
  type ProductDetails,
  type ProductVariant,
  type SearchProduct,
  type VendorOption,
} from '../lib/globalSourcingApi';
import {
  buildCjProductUrl,
  flagToneClasses,
  getInspectedProductFlags,
  getSearchResultFlags,
  getVariantOptionLabel,
  hydrateCjProductForImport,
  pickDefaultInboundHub,
} from '../lib/globalSourcingHelpers';

export default function GlobalSourcingCjProducts() {
  const { session } = useAuth();
  const notification = useNotification();

  const [loadingRef, setLoadingRef] = useState(true);
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductDetails | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [selectedHubId, setSelectedHubId] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [sourcingTag, setSourcingTag] = useState('Ships from Abroad');
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [importing, setImporting] = useState(false);

  const selectedVariant = useMemo(
    () => product?.variants.find((v) => v.external_variant_id === selectedVariantId) || null,
    [product, selectedVariantId],
  );

  const loadReference = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingRef(true);
    try {
      const res = await callGlobalSourcing<{ data: { hubs: HubOption[]; vendors: VendorOption[] } }>(
        'global-sourcing-reference-data',
        { method: 'GET' },
      );
      const nextHubs = res.data?.hubs || [];
      const nextVendors = res.data?.vendors || [];
      setHubs(nextHubs);
      setVendors(nextVendors);
      const defaultHub = pickDefaultInboundHub(nextHubs);
      setSelectedHubId(defaultHub?.id || nextHubs[0]?.id || '');
      setSelectedVendorId(nextVendors[0]?.id || '');
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load hubs and vendors');
    } finally {
      setLoadingRef(false);
    }
  }, [notification, session?.access_token]);

  useEffect(() => {
    loadReference();
  }, [loadReference]);

  const runSearch = async (page: number, append = false) => {
    if (!session?.access_token || !searchQuery.trim()) {
      notification.error('Search required', 'Enter a CJ product query');
      return;
    }
    if (append) setLoadingMore(true);
    else {
      setSearching(true);
      setSearchAttempted(true);
      setSearchError(null);
      setResults([]);
      setHasMore(false);
    }
    try {
      const res = await callGlobalSourcing<{ data: { results: SearchProduct[] } }>('cj-search-products', {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery.trim(), page, pageSize: CJ_SEARCH_PAGE_SIZE }),
      });
      const next = res.data?.results || [];
      setResults((prev) => (append ? [...prev, ...next] : next));
      setSearchPage(page);
      setHasMore(next.length === CJ_SEARCH_PAGE_SIZE);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to search CJ products';
      if (!append) setResults([]);
      setSearchError(message);
      notification.error('CJ search failed', message);
    } finally {
      if (append) setLoadingMore(false);
      else setSearching(false);
    }
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    void runSearch(1, false);
  };

  const inspectProduct = async (item: SearchProduct) => {
    if (!session?.access_token) return;
    setInspectOpen(true);
    setInspectingId(item.external_product_id);
    setInspectError(null);
    setPreview(null);
    setPrice('');
    setProduct(null);
    try {
      const hydrated = await hydrateCjProductForImport({
        externalProductId: item.external_product_id,
        fallbackTitle: item.title,
        fallbackImages: item.images?.filter(Boolean) || [],
        fallbackSourcePrice: item.source_price,
        fallbackCurrency: item.currency || 'USD',
      });
      setProduct(hydrated);
      setSelectedVariantId(hydrated.variants[0]?.external_variant_id || '');
      setTitle(hydrated.title);
      setDescription(hydrated.description);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load product details';
      setInspectError(message);
      notification.error('Inspect failed', message);
    } finally {
      setInspectingId(null);
    }
  };

  const quote = async () => {
    if (!session?.access_token || !product || !selectedVariant?.external_variant_id || !selectedHubId) {
      notification.error('Missing inputs', 'Select a hub and variant before quoting');
      return;
    }
    setQuoting(true);
    try {
      const res = await callGlobalSourcing<{ data: PricingPreview }>('global-sourcing-price-preview', {
        method: 'POST',
        body: JSON.stringify({
          provider: product.provider || 'cj',
          receiving_hub_id: selectedHubId,
          external_variant_id: selectedVariant.external_variant_id,
          source_price: selectedVariant.source_price,
          currency: selectedVariant.currency,
          inbound_shipping_usd: selectedVariant.inbound_shipping_usd ?? product.inbound_shipping_usd ?? null,
        }),
      });
      setPreview(res.data);
      setPrice(res.data.final_price_ngn);
    } catch (err) {
      setPreview(null);
      notification.error('Quote failed', err instanceof Error ? err.message : 'Unable to quote landed pricing');
    } finally {
      setQuoting(false);
    }
  };

  const importProduct = async () => {
    if (!session?.access_token || !product || !selectedVariant || !selectedHubId || !selectedVendorId) {
      notification.error('Missing mapping', 'Select vendor and receiving hub');
      return;
    }
    if (!preview) {
      notification.error('Quote required', 'Generate a landed price quote before importing');
      return;
    }
    setImporting(true);
    try {
      const payload = buildImportPayload(product, selectedVariant, {
        title,
        description,
        price,
        sourcingTag,
        selectedHubId,
        selectedVendorId,
        preview,
      });
      const queued = await callGlobalSourcing<{ data: { job_id: string } }>('global-sourcing-import-product', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const job = await runImportJob(queued.data.job_id);
      if (job.status === 'failed') throw new Error('Import job failed');
      notification.success(
        'Imported',
        job.result?.imported_variation_count
          ? `Product imported with ${job.result.imported_variation_count} variant(s)`
          : 'Product imported successfully',
      );
      closeInspect();
    } catch (err) {
      notification.error('Import failed', err instanceof Error ? err.message : 'Unable to import product');
    } finally {
      setImporting(false);
    }
  };

  const closeInspect = () => {
    setInspectOpen(false);
    setProduct(null);
    setPreview(null);
    setInspectError(null);
  };

  if (loadingRef) {
    return (
      <div className="flex justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <>
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search CJ products"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
          style={{ fontSize: '16px' }}
        />
        <button
          type="submit"
          disabled={searching}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-primary-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {searching ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </form>

      {searchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{searchError}</div>
      )}

      {results.length > 0 && (
        <p className="text-xs text-gray-500">
          {results.length} result{results.length !== 1 ? 's' : ''}
          {hasMore ? ` · page ${searchPage}` : ''}
        </p>
      )}

      {searchAttempted && !searching && results.length === 0 && (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">
          {searchError ? 'Fix the search error and try again.' : 'No CJ products matched this search.'}
        </div>
      )}

      {!searchAttempted && results.length === 0 && (
        <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">
          Search CJ Dropshipping to import products into your catalog.
        </div>
      )}

      <div className="space-y-2">
        {results.map((item) => (
          <button
            key={item.external_product_id}
            type="button"
            onClick={() => void inspectProduct(item)}
            disabled={inspectingId === item.external_product_id}
            className="flex w-full gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-gray-100 active:bg-gray-50 disabled:opacity-60"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
              {item.images?.[0] ? (
                <img src={item.images[0]} alt="" className="h-full w-full object-cover" />
              ) : (
                <Package className="h-5 w-5 text-gray-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-semibold text-gray-900">{item.title}</p>
              <p className="text-xs text-gray-500">
                {item.category || 'Uncategorized'} · PID {item.external_product_id}
              </p>
              <p className="text-xs text-gray-500">
                {item.source_price !== null ? `${item.currency} ${item.source_price}` : 'No source price'}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {getSearchResultFlags(item).map((flag) => (
                  <span
                    key={flag.label}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${flagToneClasses(flag.tone)}`}
                  >
                    {flag.label}
                  </span>
                ))}
              </div>
            </div>
            {inspectingId === item.external_product_id ? (
              <Loader className="h-4 w-4 shrink-0 animate-spin text-primary-600" />
            ) : null}
          </button>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          disabled={loadingMore || searching}
          onClick={() => void runSearch(searchPage + 1, true)}
          className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-60"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      <Sheet open={inspectOpen} onClose={closeInspect} ariaLabel="Import CJ product">
        {inspectingId && !product && !inspectError ? (
          <div className="flex flex-col items-center py-8">
            <Loader className="h-6 w-6 animate-spin text-primary-600" />
            <p className="mt-3 text-sm text-gray-500">Loading product details…</p>
          </div>
        ) : null}

        {inspectError && !product ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{inspectError}</div>
        ) : null}

        {product && (
          <>
            <div className="flex gap-3">
              {product.images[0] ? (
                <img src={product.images[0]} alt="" className="h-20 w-20 rounded-lg object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-gray-100">
                  <Package className="h-6 w-6 text-gray-400" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-gray-900">{product.title}</h3>
                <p className="text-xs text-gray-500">PID {product.external_product_id}</p>
                {buildCjProductUrl(product.title, product.external_product_id) && (
                  <a
                    href={buildCjProductUrl(product.title, product.external_product_id)!}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary-600"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open on CJ
                  </a>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              {getInspectedProductFlags(product).map((flag) => (
                <span
                  key={flag.label}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${flagToneClasses(flag.tone)}`}
                >
                  {flag.label}
                </span>
              ))}
            </div>

            <select
              value={selectedVariantId}
              onChange={(e) => {
                setSelectedVariantId(e.target.value);
                setPreview(null);
                setPrice('');
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              {product.variants.map((variant, index) => (
                <option key={variant.external_variant_id || index} value={variant.external_variant_id || ''}>
                  {getVariantOptionLabel(variant, index, product.title)}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Product title"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            />

            <select
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              {vendors.length === 0 ? (
                <option value="">No vendors</option>
              ) : (
                vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.store_name}
                  </option>
                ))
              )}
            </select>

            <select
              value={selectedHubId}
              onChange={(e) => setSelectedHubId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.code}
                </option>
              ))}
            </select>

            <input
              type="text"
              value={sourcingTag}
              onChange={(e) => setSourcingTag(e.target.value)}
              placeholder="Customer label"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            />

            <input
              type="text"
              value={price}
              readOnly
              placeholder="Final price (NGN)"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700"
              style={{ fontSize: '16px' }}
            />

            {preview && (
              <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                <p className="font-semibold text-gray-900">Landed pricing</p>
                <p className="mt-1">Supplier USD {preview.supplier_price_usd}</p>
                {preview.landed_cost_usd != null && <p>Landed USD {preview.landed_cost_usd}</p>}
                <p className="mt-1 font-medium text-green-700">{formatNaira(Number(preview.final_price_ngn) || 0)}</p>
                {preview.estimated_inbound_days_min && preview.estimated_inbound_days_max && (
                  <p className="mt-1">
                    ETA {preview.estimated_inbound_days_min}–{preview.estimated_inbound_days_max} days
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={quoting || !selectedVariantId}
              onClick={() => void quote()}
              className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-900 disabled:opacity-60"
            >
              {quoting ? 'Quoting…' : 'Quote selected variant'}
            </button>

            <button
              type="button"
              disabled={importing || !preview || !price}
              onClick={() => void importProduct()}
              className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {importing ? 'Importing…' : 'Import product + variants'}
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}

function buildImportPayload(
  product: ProductDetails,
  selectedVariant: ProductVariant,
  opts: {
    title: string;
    description: string;
    price: string;
    sourcingTag: string;
    selectedHubId: string;
    selectedVendorId: string;
    preview: PricingPreview;
  },
) {
  return {
    provider: product.provider || 'cj',
    external_product_id: product.external_product_id,
    external_variant_id: selectedVariant.external_variant_id,
    supplier_source: product.supplier_source || product.provider || 'cj',
    supplier_product_id: product.supplier_product_id || product.external_product_id,
    supplier_variant_id: selectedVariant.external_variant_id,
    supplier_url: product.supplier_url || null,
    title: opts.title.trim() || product.title,
    description: opts.description.trim(),
    description_images: product.description_images || [],
    images: product.images,
    selected_attributes: selectedVariant.attributes || {},
    selected_variant: {
      external_variant_id: selectedVariant.external_variant_id,
      title: selectedVariant.title,
      image: selectedVariant.image || null,
      source_price: selectedVariant.source_price,
      currency: selectedVariant.currency,
      inbound_shipping_usd: selectedVariant.inbound_shipping_usd ?? product.inbound_shipping_usd ?? null,
      attributes: selectedVariant.attributes || {},
    },
    variants: product.variants.map((variant) => ({
      external_variant_id: variant.external_variant_id,
      title: variant.title,
      image: variant.image || null,
      source_price: variant.source_price,
      currency: variant.currency,
      inbound_shipping_usd: variant.inbound_shipping_usd ?? product.inbound_shipping_usd ?? null,
      attributes: variant.attributes || {},
    })),
    regular_price: opts.price,
    currency: selectedVariant.currency || product.currency || 'USD',
    sourcing_tag_label_suggestion: opts.sourcingTag,
    fulfillment_mode: 'cj_hub',
    receiving_hub_id: opts.selectedHubId,
    pricing_preview: opts.preview,
    target_vendor_mapping: { vendor_id: opts.selectedVendorId },
    supplier_price_snapshot: selectedVariant.source_price ?? product.source_price ?? null,
    inbound_shipping_usd: selectedVariant.inbound_shipping_usd ?? product.inbound_shipping_usd ?? null,
  };
}
