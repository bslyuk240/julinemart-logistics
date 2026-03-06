import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Truck,
} from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

type TabKey = 'cj-products' | 'imported-products' | 'inbound-shipments' | 'settings';

interface HubOption {
  id: string;
  name: string;
  code: string;
}

interface VendorOption {
  id: string;
  store_name: string;
  woocommerce_vendor_id: string;
}

interface SearchProduct {
  provider: string;
  external_product_id: string;
  title: string;
  images: string[];
  category: string | null;
  source_price: number | null;
  currency: string;
  variants_summary: string | null;
}

interface ProductVariant {
  external_variant_id: string | null;
  title: string;
  image?: string | null;
  source_price: number | null;
  currency: string;
  attributes: Record<string, string>;
}

interface ProductDetails {
  provider: string;
  external_product_id: string;
  title: string;
  description: string;
  images: string[];
  variants: ProductVariant[];
  source_price: number | null;
  currency?: string;
}

interface ImportedProduct {
  woo_product_id: string;
  name: string;
  status: string;
  provider: string;
  external_product_id: string | null;
  fulfillment_mode: string | null;
  receiving_hub?: { name: string } | null;
  vendor?: { store_name: string } | null;
  updated_at: string | null;
}

interface InboundShipment {
  id: string;
  created_at: string;
  provider: string;
  cj_order_id: string | null;
  inbound_status: string;
  inbound_tracking_number: string | null;
  estimated_arrival_at: string | null;
  received_at_hub_at: string | null;
  hubs?: { name: string } | null;
  sub_orders?: { tracking_number: string | null } | null;
}

interface SettingsStatus {
  configured: boolean;
  wooConfigured: boolean;
  checks: Record<string, boolean>;
  authenticated?: boolean;
  expires_at?: string;
}

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'cj-products', label: 'CJ Products' },
  { key: 'imported-products', label: 'Imported Products' },
  { key: 'inbound-shipments', label: 'Inbound Shipments' },
  { key: 'settings', label: 'Settings' },
];

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function endpointCandidates(endpoint: string) {
  const urls = [`/api/${endpoint}`, `${functionsBase}/${endpoint}`];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888/api/${endpoint}`);
    urls.push(`http://localhost:8888${functionsBase}/${endpoint}`);
  }
  return Array.from(new Set(urls));
}

async function callAdmin<T>(endpoint: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const urls = endpointCandidates(endpoint);
  let lastError: Error | null = null;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const isLast = index === urls.length - 1;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(init.headers || {}),
        },
      });

      if (response.status === 404 && !isLast) continue;

      const raw = await response.text();
      const body = raw ? JSON.parse(raw) : {};
      if (!response.ok) {
        throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
      }
      return body as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Request failed');
      if (isLast) throw lastError;
    }
  }

  throw lastError || new Error('Request failed');
}

export function GlobalSourcingPage() {
  const { session } = useAuth();
  const notification = useNotification();

  const [activeTab, setActiveTab] = useState<TabKey>('cj-products');
  const [loadingReferenceData, setLoadingReferenceData] = useState(true);
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedHubId, setSelectedHubId] = useState('');
  const [price, setPrice] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourcingTag, setSourcingTag] = useState('Ships from Abroad');
  const [importing, setImporting] = useState(false);
  const [importedProducts, setImportedProducts] = useState<ImportedProduct[]>([]);
  const [loadingImported, setLoadingImported] = useState(false);
  const [shipments, setShipments] = useState<InboundShipment[]>([]);
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [shipmentActionId, setShipmentActionId] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [testingSettings, setTestingSettings] = useState(false);

  const selectedVariant = useMemo(
    () => productDetails?.variants.find((variant) => variant.external_variant_id === selectedVariantId) || null,
    [productDetails, selectedVariantId]
  );

  const loadReferenceData = useCallback(async () => {
    setLoadingReferenceData(true);
    try {
      const [{ data: hubRows, error: hubError }, { data: vendorRows, error: vendorError }] = await Promise.all([
        supabase.from('hubs').select('id, name, code').eq('is_active', true).order('name', { ascending: true }),
        supabase
          .from('vendors')
          .select('id, store_name, woocommerce_vendor_id')
          .eq('is_active', true)
          .order('store_name', { ascending: true }),
      ]);
      if (hubError) throw hubError;
      if (vendorError) throw vendorError;
      setHubs((hubRows || []) as HubOption[]);
      setVendors((vendorRows || []) as VendorOption[]);
      setSelectedHubId(hubRows?.[0]?.id || '');
      setSelectedVendorId(vendorRows?.[0]?.id || '');
    } catch (error: unknown) {
      notification.error('Load failed', getErrorMessage(error, 'Unable to load hubs and vendors'));
    } finally {
      setLoadingReferenceData(false);
    }
  }, [notification]);

  const loadImportedProducts = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingImported(true);
    try {
      const response = await callAdmin<{ data: ImportedProduct[] }>('global-sourcing-products', session.access_token, { method: 'GET' });
      setImportedProducts(response.data || []);
    } catch (error: unknown) {
      notification.error('Load failed', getErrorMessage(error, 'Unable to load imported products'));
    } finally {
      setLoadingImported(false);
    }
  }, [notification, session?.access_token]);

  const loadShipments = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingShipments(true);
    try {
      const response = await callAdmin<{ data: InboundShipment[] }>('global-sourcing-inbound-shipments', session.access_token, { method: 'GET' });
      setShipments(response.data || []);
    } catch (error: unknown) {
      notification.error('Load failed', getErrorMessage(error, 'Unable to load inbound shipments'));
    } finally {
      setLoadingShipments(false);
    }
  }, [notification, session?.access_token]);

  const loadSettingsStatus = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingSettings(true);
    try {
      const response = await callAdmin<{ data: SettingsStatus }>('cj-auth', session.access_token, { method: 'GET' });
      setSettingsStatus(response.data);
    } catch (error: unknown) {
      notification.error('Settings failed', getErrorMessage(error, 'Unable to load settings status'));
    } finally {
      setLoadingSettings(false);
    }
  }, [notification, session?.access_token]);

  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

  useEffect(() => {
    if (!productDetails) return;
    setTitle(productDetails.title);
    setDescription(productDetails.description);
    setPrice(String(selectedVariant?.source_price ?? productDetails.source_price ?? ''));
    if (!selectedVariantId && productDetails.variants[0]) {
      setSelectedVariantId(productDetails.variants[0].external_variant_id);
    }
  }, [productDetails, selectedVariant, selectedVariantId]);

  useEffect(() => {
    if (!session?.access_token) return;
    if (activeTab === 'imported-products' && importedProducts.length === 0) void loadImportedProducts();
    if (activeTab === 'inbound-shipments' && shipments.length === 0) void loadShipments();
    if (activeTab === 'settings' && !settingsStatus) void loadSettingsStatus();
  }, [
    activeTab,
    importedProducts.length,
    loadImportedProducts,
    loadSettingsStatus,
    loadShipments,
    session?.access_token,
    settingsStatus,
    shipments.length,
  ]);

  const testSettings = async () => {
    if (!session?.access_token) return;
    setTestingSettings(true);
    try {
      const response = await callAdmin<{ data: SettingsStatus }>('cj-auth', session.access_token, { method: 'POST' });
      setSettingsStatus((current) => ({ ...(current || { configured: false, wooConfigured: false, checks: {} }), ...response.data }));
      notification.success('CJ ready', 'CJ backend authentication succeeded');
    } catch (error: unknown) {
      notification.error('CJ auth failed', getErrorMessage(error, 'Unable to authenticate with CJ'));
    } finally {
      setTestingSettings(false);
    }
  };

  const searchProducts = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.access_token) return;
    if (!searchQuery.trim()) {
      notification.error('Search required', 'Enter a CJ product query');
      return;
    }
    setSearching(true);
    setSearchAttempted(true);
    setSearchError(null);
    setProductDetails(null);
    try {
      const response = await callAdmin<{ data: { results: SearchProduct[] } }>('cj-search-products', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery.trim(), page: 1, pageSize: 20 }),
      });
      setResults(response.data?.results || []);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unable to search CJ products');
      setResults([]);
      setSearchError(message);
      notification.error('CJ search failed', message);
    } finally {
      setSearching(false);
    }
  };

  const inspectProduct = async (product: SearchProduct) => {
    if (!session?.access_token) return;
    try {
      const response = await callAdmin<{ data: { product: ProductDetails } }>('cj-product-details', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ external_product_id: product.external_product_id }),
      });
      setProductDetails(response.data.product);
      setSelectedVariantId(response.data.product.variants[0]?.external_variant_id || null);
    } catch (error: unknown) {
      notification.error('Inspect failed', getErrorMessage(error, 'Unable to load product details'));
    }
  };

  const importProduct = async () => {
    if (!session?.access_token || !productDetails) return;
    if (!selectedVendorId || !selectedHubId) {
      notification.error('Missing mapping', 'Select a target vendor and receiving hub');
      return;
    }
    setImporting(true);
    try {
      const payload = {
        provider: 'cj',
        external_product_id: productDetails.external_product_id,
        external_variant_id: selectedVariant?.external_variant_id || null,
        title: title.trim() || productDetails.title,
        description: description.trim(),
        images: productDetails.images,
        selected_attributes: selectedVariant?.attributes || {},
        selected_variant: selectedVariant
          ? {
              external_variant_id: selectedVariant.external_variant_id,
              image: selectedVariant.image || null,
              source_price: selectedVariant.source_price,
              currency: selectedVariant.currency,
              attributes: selectedVariant.attributes,
            }
          : null,
        regular_price: price,
        currency: selectedVariant?.currency || productDetails.currency || 'USD',
        sourcing_tag_label_suggestion: sourcingTag,
        fulfillment_mode: 'cj_hub',
        receiving_hub_id: selectedHubId,
        target_vendor_mapping: { vendor_id: selectedVendorId },
        supplier_price_snapshot: selectedVariant?.source_price ?? productDetails.source_price ?? null,
      };
      const response = await callAdmin<{ data: { woo_product_id: string } }>('global-sourcing-import-product', session.access_token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      notification.success('Imported', `Woo product ${response.data.woo_product_id} updated`);
      setActiveTab('imported-products');
      await loadImportedProducts();
    } catch (error: unknown) {
      notification.error('Import failed', getErrorMessage(error, 'Unable to import product'));
    } finally {
      setImporting(false);
    }
  };

  const markReceived = async (shipmentId: string) => {
    if (!session?.access_token) return;
    setShipmentActionId(shipmentId);
    try {
      await callAdmin('global-sourcing-inbound-shipments', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ action: 'mark_received_at_hub', shipment_id: shipmentId }),
      });
      notification.success('Updated', 'Inbound shipment marked as received');
      await loadShipments();
    } catch (error: unknown) {
      notification.error('Update failed', getErrorMessage(error, 'Unable to update shipment'));
    } finally {
      setShipmentActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Global Sourcing</h1>
          <p className="mt-2 max-w-3xl text-gray-600">
            Admin-only sourcing workflow for CJ product discovery, Woo product writeback, and inbound
            shipment handling.
          </p>
        </div>
        <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p>Hubs: {hubs.length}</p>
          <p>Vendors: {vendors.length}</p>
          <p>Imported products: {importedProducts.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              activeTab === tab.key
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-200 bg-white text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loadingReferenceData ? (
        <div className="card py-16 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" />
          <p className="mt-3 text-sm text-gray-600">Loading vendor and hub mappings...</p>
        </div>
      ) : null}

      {!loadingReferenceData && activeTab === 'cj-products' ? (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <div className="card space-y-4">
            <form onSubmit={searchProducts} className="flex gap-3">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search CJ products"
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 focus:border-primary-500 focus:outline-none"
              />
              <button className="btn-primary inline-flex items-center gap-2" type="submit" disabled={searching}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </button>
            </form>

            <div className="space-y-3">
              {searchError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  CJ search failed: {searchError}
                </div>
              ) : null}
              {results.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
                  {searchError
                    ? 'Fix the CJ search error and try again.'
                    : searchAttempted
                    ? 'No CJ products matched this search.'
                    : 'No CJ products loaded yet.'}
                </div>
              ) : (
                results.map((product) => (
                  <div key={product.external_product_id} className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-gray-900">{product.title}</p>
                        <p className="text-sm text-gray-500">
                          {product.category || 'Uncategorized'} · PID {product.external_product_id}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          {product.source_price !== null ? `${product.currency} ${product.source_price}` : 'No source price'}
                        </p>
                      </div>
                      <button type="button" onClick={() => void inspectProduct(product)} className="btn-secondary">
                        Inspect
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Import to Woo</h2>
              <p className="text-sm text-gray-600">Woo remains the product source of truth.</p>
            </div>

            {!productDetails ? (
              <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
                Inspect a CJ product to continue.
              </div>
            ) : (
              <>
                <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                  <p className="font-semibold text-gray-900">{productDetails.title}</p>
                  <p className="mt-1">PID {productDetails.external_product_id}</p>
                  <p className="mt-1">Variants: {productDetails.variants.length}</p>
                </div>

                <select
                  value={selectedVariantId || ''}
                  onChange={(event) => setSelectedVariantId(event.target.value || null)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                >
                  {productDetails.variants.map((variant, index) => (
                    <option key={`${variant.external_variant_id || 'default'}-${index}`} value={variant.external_variant_id || ''}>
                      {variant.title || 'Default variant'} {variant.source_price !== null ? `· ${variant.currency} ${variant.source_price}` : ''}
                    </option>
                  ))}
                </select>

                <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-3" placeholder="Woo title" />
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-3" rows={4} placeholder="Description" />
                <input value={price} onChange={(event) => setPrice(event.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-3" placeholder="Source price in supplier currency" />
                <input value={sourcingTag} onChange={(event) => setSourcingTag(event.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-3" placeholder="Customer label" />

                <select value={selectedVendorId} onChange={(event) => setSelectedVendorId(event.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-3">
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.store_name} · Woo vendor {vendor.woocommerce_vendor_id}
                    </option>
                  ))}
                </select>

                <select value={selectedHubId} onChange={(event) => setSelectedHubId(event.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-3">
                  {hubs.map((hub) => (
                    <option key={hub.id} value={hub.id}>
                      {hub.name} · {hub.code}
                    </option>
                  ))}
                </select>

                <button type="button" onClick={() => void importProduct()} className="btn-primary inline-flex w-full items-center justify-center gap-2" disabled={importing}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Import into Woo
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {!loadingReferenceData && activeTab === 'imported-products' ? (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Imported Products</h2>
              <p className="text-sm text-gray-600">Filtered from Woo by sourcing meta written by this module.</p>
            </div>
            <button type="button" onClick={() => void loadImportedProducts()} className="btn-secondary inline-flex items-center gap-2">
              {loadingImported ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>

          {importedProducts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
              No imported products found.
            </div>
          ) : (
            <div className="space-y-3">
              {importedProducts.map((product) => (
                <div key={product.woo_product_id} className="rounded-lg border border-gray-200 p-4 text-sm text-gray-700">
                  <p className="font-semibold text-gray-900">{product.name}</p>
                  <p className="mt-1">Woo #{product.woo_product_id} · CJ PID {product.external_product_id || 'n/a'}</p>
                  <p className="mt-1">Vendor: {product.vendor?.store_name || 'Not set'} · Hub: {product.receiving_hub?.name || 'Not set'}</p>
                  <p className="mt-1">Mode: {product.fulfillment_mode || 'Not set'} · Status: {product.status}</p>
                  <p className="mt-1">Updated: {formatDate(product.updated_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!loadingReferenceData && activeTab === 'inbound-shipments' ? (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Inbound Shipments</h2>
              <p className="text-sm text-gray-600">Supplier to hub movement is separate from last-mile delivery.</p>
            </div>
            <button type="button" onClick={() => void loadShipments()} className="btn-secondary inline-flex items-center gap-2">
              {loadingShipments ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
          </div>

          {shipments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
              No inbound shipments found.
            </div>
          ) : (
            <div className="space-y-3">
              {shipments.map((shipment) => (
                <div key={shipment.id} className="rounded-lg border border-gray-200 p-4 text-sm text-gray-700">
                  <p className="font-semibold text-gray-900">
                    {shipment.provider.toUpperCase()} · {shipment.cj_order_id || 'Awaiting CJ order ID'}
                  </p>
                  <p className="mt-1">Created: {formatDate(shipment.created_at)}</p>
                  <p className="mt-1">Hub: {shipment.hubs?.name || 'Not linked'} · Sub-order: {shipment.sub_orders?.tracking_number || 'Not linked'}</p>
                  <p className="mt-1">Status: {shipment.inbound_status} · Tracking: {shipment.inbound_tracking_number || 'Not set'}</p>
                  <p className="mt-1">ETA: {formatDate(shipment.estimated_arrival_at)} · Received: {formatDate(shipment.received_at_hub_at)}</p>
                  <button
                    type="button"
                    onClick={() => void markReceived(shipment.id)}
                    disabled={shipment.inbound_status === 'received_at_hub' || shipmentActionId === shipment.id}
                    className="btn-primary mt-3 inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {shipmentActionId === shipment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                    Mark Received at Hub
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!loadingReferenceData && activeTab === 'settings' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Provider Health</h2>
                <p className="text-sm text-gray-600">Backend-only config checks. No secrets are exposed.</p>
              </div>
              <button type="button" onClick={() => void loadSettingsStatus()} className="btn-secondary inline-flex items-center gap-2">
                {loadingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
            </div>

            {settingsStatus ? (
              <>
                <div className={`rounded-lg px-4 py-3 text-sm ${settingsStatus.configured ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                  CJ config: {settingsStatus.configured ? 'present' : 'missing'}
                </div>
                <div className={`rounded-lg px-4 py-3 text-sm ${settingsStatus.wooConfigured ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                  Woo config: {settingsStatus.wooConfigured ? 'present' : 'missing'}
                </div>
                {settingsStatus.authenticated !== undefined ? (
                  <div className="rounded-lg bg-primary-50 px-4 py-3 text-sm text-primary-800">
                    CJ auth: {settingsStatus.authenticated ? 'authenticated' : 'not authenticated'}
                    {settingsStatus.expires_at ? ` · expires ${formatDate(settingsStatus.expires_at)}` : ''}
                  </div>
                ) : null}
                <div className="space-y-2">
                  {Object.entries(settingsStatus.checks || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm">
                      <span className="font-medium text-gray-700">{key}</span>
                      <span className={value ? 'text-green-700' : 'text-red-700'}>{value ? 'configured' : 'missing'}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
                Load settings status to verify backend configuration.
              </div>
            )}
          </div>

          <div className="card space-y-4 text-sm text-gray-700">
            <h2 className="text-lg font-semibold text-gray-900">Operational Notes</h2>
            <p>Products remain in WooCommerce. Vendor ownership is resolved from the existing JLO vendors table.</p>
            <p>Inbound shipment state is stored in JLO without changing the existing last-mile delivery enum.</p>
            <button type="button" onClick={() => void testSettings()} className="btn-primary inline-flex items-center gap-2" disabled={testingSettings}>
              {testingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Test CJ backend authentication
            </button>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <div className="flex gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <p>
                  This MVP writes sourcing meta to Woo and prepares inbound records in JLO. It does not
                  automate CJ order placement yet.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
