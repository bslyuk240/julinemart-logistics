import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { Sheet } from '../Sheet';
import { formatNaira } from '../lib/displayUtils';
import {
  callGlobalSourcing,
  runImportJob,
  type HubOption,
  type PricingPreview,
  type ProductDetails,
  type VendorOption,
} from '../lib/globalSourcingApi';

interface SourceRequest {
  id: string;
  created_at: string;
  product_url: string;
  status: string;
}

export default function GlobalSourcingImportUrlPanel() {
  const { session } = useAuth();
  const notification = useNotification();
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [requests, setRequests] = useState<SourceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [showHtml, setShowHtml] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [product, setProduct] = useState<ProductDetails | null>(null);
  const [selectedHubId, setSelectedHubId] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [price, setPrice] = useState('');
  const [preview, setPreview] = useState<PricingPreview | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const [ref, req] = await Promise.all([
        callGlobalSourcing<{ data: { hubs: HubOption[]; vendors: VendorOption[] } }>('global-sourcing-reference-data', {
          method: 'GET',
        }),
        callGlobalSourcing<{ data: SourceRequest[] }>('global-sourcing-source-link', { method: 'GET' }),
      ]);
      setHubs(ref.data?.hubs || []);
      setVendors(ref.data?.vendors || []);
      setRequests(req.data || []);
      if (ref.data?.hubs?.[0]) setSelectedHubId(ref.data.hubs[0].id);
      if (ref.data?.vendors?.[0]) setSelectedVendorId(ref.data.vendors[0].id);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load reference data');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const ingest = async (e: FormEvent) => {
    e.preventDefault();
    if (!session?.access_token || !url.trim()) return;
    setSubmitting(true);
    try {
      const res = await callGlobalSourcing<{ data: { product: ProductDetails } }>('global-sourcing-aliexpress-ingest', {
        method: 'POST',
        body: JSON.stringify({
          product_url: url.trim(),
          ...(html.trim() ? { product_html: html } : {}),
        }),
      });
      setProduct(res.data.product);
      setSelectedVariantId(res.data.product.variants[0]?.external_variant_id || '');
      setPreview(null);
      setPrice('');
      notification.success('Loaded', 'Review variant and import');
    } catch (err) {
      setShowHtml(true);
      notification.error('Ingest failed', err instanceof Error ? err.message : 'Try pasting page HTML');
    } finally {
      setSubmitting(false);
    }
  };

  const quote = async () => {
    if (!session?.access_token || !product || !selectedHubId || !selectedVariantId) return;
    const variant = product.variants.find((v) => v.external_variant_id === selectedVariantId);
    if (!variant) return;
    setQuoting(true);
    try {
      const res = await callGlobalSourcing<{ data: PricingPreview }>('global-sourcing-price-preview', {
        method: 'POST',
        body: JSON.stringify({
          provider: product.provider || 'aliexpress',
          receiving_hub_id: selectedHubId,
          external_variant_id: variant.external_variant_id,
          source_price: variant.source_price,
          currency: variant.currency,
          inbound_shipping_usd: product.inbound_shipping_usd ?? null,
        }),
      });
      setPreview(res.data);
      setPrice(res.data.final_price_ngn);
    } catch (err) {
      notification.error('Quote failed', err instanceof Error ? err.message : 'Unable to quote price');
    } finally {
      setQuoting(false);
    }
  };

  const runImport = async () => {
    if (!session?.access_token || !product || !selectedVariantId || !price.trim()) return;
    const variant = product.variants.find((v) => v.external_variant_id === selectedVariantId);
    if (!variant) return;
    setImporting(true);
    try {
      const queued = await callGlobalSourcing<{ data: { job_id: string } }>('global-sourcing-import-product', {
        method: 'POST',
        body: JSON.stringify({
          provider: product.provider,
          external_product_id: product.external_product_id,
          title: product.title,
          description: product.description,
          images: product.images,
          selected_variant_id: selectedVariantId,
          selected_variant: {
            external_variant_id: variant.external_variant_id,
            title: variant.title,
            source_price: variant.source_price,
            currency: variant.currency,
          },
          variants: product.variants,
          regular_price: price,
          currency: variant.currency,
          fulfillment_mode: 'cj_hub',
          receiving_hub_id: selectedHubId,
          pricing_preview: preview,
          target_vendor_mapping: selectedVendorId ? { vendor_id: selectedVendorId } : {},
          supplier_price_snapshot: variant.source_price,
          inbound_shipping_usd: product.inbound_shipping_usd ?? null,
        }),
      });
      const job = await runImportJob(queued.data.job_id);
      if (job.status === 'failed') throw new Error('Import job failed');
      notification.success('Imported', 'Product added to catalog');
      setProduct(null);
      setUrl('');
      setHtml('');
    } catch (err) {
      notification.error('Import failed', err instanceof Error ? err.message : 'Unable to import');
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <>
      <form onSubmit={ingest} className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-gray-100">
        <p className="text-sm text-gray-600">Paste an AliExpress product URL to import via Global Sourcing.</p>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.aliexpress.com/item/…"
          className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
          style={{ fontSize: '16px' }}
        />
        <button type="button" onClick={() => setShowHtml((v) => !v)} className="text-xs font-semibold text-primary-600">
          {showHtml ? 'Hide HTML fallback' : 'Use HTML paste fallback'}
        </button>
        {showHtml && (
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="Paste page HTML if fetch is blocked"
            className="min-h-[120px] w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs"
          />
        )}
        <button
          type="submit"
          disabled={submitting || !url.trim()}
          className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? 'Loading…' : 'Load product'}
        </button>
      </form>

      {requests.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Recent requests</p>
          {requests.slice(0, 5).map((r) => (
            <div key={r.id} className="rounded-lg bg-white p-3 text-xs ring-1 ring-gray-100">
              <p className="truncate font-medium text-gray-900">{r.product_url}</p>
              <p className="text-gray-500">{r.status} · {new Date(r.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}

      <Sheet open={!!product} onClose={() => setProduct(null)} ariaLabel="Import product">
        {product && (
          <>
            <h3 className="text-base font-bold text-gray-900">{product.title}</h3>
            {product.images[0] && <img src={product.images[0]} alt="" className="max-h-32 rounded-lg object-cover" />}
            <select
              value={selectedVariantId}
              onChange={(e) => setSelectedVariantId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              {product.variants.map((v) => (
                <option key={v.external_variant_id || v.title} value={v.external_variant_id || ''}>
                  {v.title} · ${v.source_price ?? '—'}
                </option>
              ))}
            </select>
            <select
              value={selectedHubId}
              onChange={(e) => setSelectedHubId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <select
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.store_name}
                </option>
              ))}
            </select>
            {preview && (
              <p className="text-sm text-gray-600">
                Final price {formatNaira(Number(preview.final_price_ngn) || 0)}
                {preview.landed_cost_usd != null ? ` · Landed USD ${preview.landed_cost_usd}` : ''}
              </p>
            )}
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Retail price (NGN)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            />
            <button
              type="button"
              disabled={quoting}
              onClick={quote}
              className="w-full rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-900"
            >
              {quoting ? 'Quoting…' : 'Get landed price'}
            </button>
            <button
              type="button"
              disabled={importing || !price.trim()}
              onClick={runImport}
              className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {importing ? 'Importing…' : 'Import to catalog'}
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}
