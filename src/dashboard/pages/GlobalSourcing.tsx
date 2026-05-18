import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Download,
  ExternalLink,
  History,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Truck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

type TabKey =
  | 'cj-products'
  | 'source-by-link'
  | 'imported-products'
  | 'inbound-shipments'
  | 'settings';

interface HubOption {
  id: string;
  name: string;
  code: string;
  is_default?: boolean | null;
  metadata?: Record<string, unknown> | null;
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
  sku?: string | null;
  image?: string | null;
  source_price: number | null;
  currency: string;
  attributes: Record<string, string>;
  inbound_shipping_usd?: number | null;
}

interface ProductDetails {
  provider: string;
  external_product_id: string;
  supplier_source?: string;
  supplier_product_id?: string;
  supplier_url?: string;
  title: string;
  description: string;
  description_images?: string[];
  images: string[];
  variants: ProductVariant[];
  source_price: number | null;
  currency?: string;
  inbound_shipping_usd?: number | null;
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
  updated_at?: string;
  provider: string;
  woo_order_id: string | null;
  cj_order_id: string | null;
  cj_pid?: string | null;
  cj_vid?: string | null;
  inbound_status: string;
  inbound_tracking_number: string | null;
  supplier_status?: string | null;
  supplier_order_mode?: string | null;
  supplier_order_status?: string | null;
  manual_supplier_order_id?: string | null;
  supplier_ordered_at?: string | null;
  estimated_arrival_at: string | null;
  received_at_hub_at: string | null;
  carrier_name?: string | null;
  metadata?: Record<string, unknown> | null;
  hubs?: { name: string; code?: string | null } | null;
  sub_orders?: {
    id?: string;
    main_order_id?: string | null;
    tracking_number: string | null;
    status?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  manual_supplier_orders?: {
    id: string;
    provider: string;
    supplier_order_mode: string;
    cj_order_id: string | null;
    ordered_at: string | null;
    status: string;
    notes: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}

type ShipmentFilter =
  | 'all'
  | 'awaiting_supplier_order'
  | 'manual_ordered'
  | 'auto_ordered'
  | 'received_at_hub';

interface PricingPreview {
  provider: string;
  pricing_mode: string;
  generated_at: string;
  receiving_hub_id: string;
  receiving_hub_name: string;
  selected_variant_id: string;
  supplier_price_usd: number;
  inbound_shipping_quote_usd: number;
  import_buffer_usd: number;
  landed_cost_usd: number;
  exchange_rate: number;
  markup_percent: number;
  markup_flat_ngn: number;
  final_price_ngn: string;
  sale_price_ngn: string | null;
  estimated_inbound_days_min?: number | null;
  estimated_inbound_days_max?: number | null;
  carrier_name?: string | null;
  usd_to_ngn_rate_used?: number;
  usd_to_ngn_rate_source?: string;
  fx_rate_fetched_at?: string | null;
  fx_rate_note?: string | null;
}

interface FxSettingsData {
  provider: string;
  manual_override_enabled: boolean;
  manual_rate: number | null;
  manual_rate_note: string | null;
  live_api_enabled: boolean;
  last_fetched_rate: number | null;
  last_fetched_at: string | null;
  cache_expires_at: string | null;
  effective_rate: number | null;
  effective_source: string;
  effective_fetched_at: string | null;
  effective_note: string | null;
}

interface FxSyncLogEntry {
  id: string;
  created_at: string;
  reason: string;
  rate_used: number;
  previous_rate: number | null;
  change_pct: number | null;
  updated_simple: number;
  updated_variations: number;
  skipped: number;
  errors: string[] | null;
}

interface FxSyncStatusData {
  last_sync_rate: number | null;
  last_sync_at: string | null;
  logs: FxSyncLogEntry[];
}

interface ImportResultData {
  woo_product_id: string;
  imported_variation_count?: number;
  skipped_variant_count?: number;
  warnings?: string[];
}

interface ImportJobData {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress_stage: string | null;
  progress_current: number;
  progress_total: number;
  result: ImportResultData | null;
  error_message: string | null;
  error_details?: { stage?: unknown } | null;
}

type SourceRequestStatus = 'draft' | 'submitted' | 'processing' | 'ready_to_import' | 'failed';

interface SourceLinkRequest {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  provider: string;
  request_type: string;
  source_url: string;
  source_domain: string | null;
  status: Exclude<SourceRequestStatus, 'draft'>;
  note: string | null;
  requested_quantity: number | null;
  vendor_id: string | null;
  vendor?: { id: string; store_name: string; woocommerce_vendor_id?: string | null } | null;
  receiving_hub_id: string | null;
  receiving_hub?: { id: string; name: string; code?: string | null } | null;
  cj_request_id: string | null;
  cj_pid: string | null;
  cj_vid: string | null;
  resolved_product_title: string | null;
  resolved_variant_title: string | null;
  error_message: string | null;
  metadata?: Record<string, unknown> | null;
  raw_request_payload?: Record<string, unknown> | null;
  raw_response_payload?: Record<string, unknown> | null;
  can_continue_to_import?: boolean;
}

function getSearchResultFlags(product: SearchProduct) {
  const flags: Array<{ label: string; tone: 'red' | 'amber' | 'green' }> = [];

  if (!product.title?.trim()) {
    flags.push({ label: 'Missing title', tone: 'red' });
  }
  if (!Array.isArray(product.images) || product.images.length === 0) {
    flags.push({ label: 'Missing image', tone: 'red' });
  }
  if (product.source_price === null) {
    flags.push({ label: 'Missing price', tone: 'red' });
  }
  if (!product.variants_summary?.trim()) {
    flags.push({ label: 'Inspect variants', tone: 'amber' });
  }

  if (flags.length === 0) {
    flags.push({ label: 'Looks usable', tone: 'green' });
  }

  return flags;
}

function getInspectedProductFlags(product: ProductDetails | null) {
  if (!product) return [];

  const flags: Array<{ label: string; tone: 'red' | 'amber' | 'green' }> = [];
  const validVariants = product.variants.filter(
    (variant) => variant.external_variant_id && variant.source_price !== null
  );

  if (!product.title?.trim()) {
    flags.push({ label: 'Missing title', tone: 'red' });
  }
  if (!Array.isArray(product.images) || product.images.length === 0) {
    flags.push({ label: 'Missing image', tone: 'red' });
  }
  if (!product.description?.trim()) {
    flags.push({ label: 'Missing description', tone: 'amber' });
  }
  if (product.variants.length === 0) {
    flags.push({ label: 'No variants returned', tone: 'red' });
  } else if (validVariants.length === 0) {
    flags.push({ label: 'No priced variant', tone: 'red' });
  }

  if (flags.length === 0) {
    flags.push({ label: 'Import ready', tone: 'green' });
  }

  return flags;
}

function toneClasses(tone: 'red' | 'amber' | 'green') {
  if (tone === 'red') return 'border-red-200 bg-red-50 text-red-700';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-green-200 bg-green-50 text-green-700';
}

function humanizeVariantFragment(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVariantOptionLabel(variant: ProductVariant, index: number, productTitle?: string) {
  const attributeLabel = Object.entries(variant.attributes || {})
    .map(([name, value]) => `${name}: ${value}`)
    .join(' / ');
  const rawTitle = variant.title?.trim() || '';
  const normalizedProductTitle = productTitle?.trim().toLowerCase() || '';
  let condensedTitle = rawTitle;

  if (
    rawTitle &&
    normalizedProductTitle &&
    rawTitle.toLowerCase().startsWith(normalizedProductTitle)
  ) {
    condensedTitle = rawTitle.slice(productTitle?.trim().length || 0).trim();
  }

  const baseLabel =
    humanizeVariantFragment(condensedTitle) ||
    humanizeVariantFragment(rawTitle) ||
    attributeLabel ||
    (variant.external_variant_id ? `Variant ${variant.external_variant_id}` : `Variant ${index + 1}`);

  return variant.source_price !== null
    ? `${baseLabel} - ${variant.currency} ${variant.source_price}`
    : baseLabel;
}

interface GlobalSourcingSettingsData {
  provider: string;
  saved: boolean;
  updated_at: string | null;
  values: {
    import_buffer_usd: number | null;
    markup_percent: number | null;
    markup_flat_ngn: number | null;
    usd_to_ngn_rate: number | null;
  };
  fx?: FxSettingsData;
}

interface ReferenceDataResponse {
  hubs: HubOption[];
  vendors: VendorOption[];
  counts: {
    hubs: number;
    vendors: number;
  };
}

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
const sourcingVendorStorageKey = 'global-sourcing:selected-vendor-id';
const sourcingHubStorageKey = 'global-sourcing:selected-hub-id';
const sourcingWooVendorStorageKey = 'global-sourcing:selected-woo-vendor-id';
const sourcingWooVendorNameStorageKey = 'global-sourcing:selected-woo-vendor-name';
const cjProductBaseUrl = 'https://cjdropshipping.com/product';
const cjSearchPageSize = 50;

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'cj-products', label: 'CJ Products' },
  { key: 'source-by-link', label: 'Import from Supplier URL' },
  { key: 'imported-products', label: 'Imported Products' },
  { key: 'inbound-shipments', label: 'Inbound Shipments' },
  { key: 'settings', label: 'Settings' },
];

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatFxSourceLabel(source?: string | null) {
  switch (String(source || '').trim()) {
    case 'manual_override':
      return 'Manual override';
    case 'cached_api':
      return 'Cached API';
    case 'live_api':
      return 'Live API';
    case 'env_fallback':
      return 'Env fallback';
    case 'hardcoded_fallback':
      return 'Hardcoded fallback';
    default:
      return source || 'Not set';
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatSyncReason(reason: string) {
  switch (reason) {
    case 'threshold_triggered': return 'Rate shift ≥3%';
    case 'initial_sync':        return 'Initial sync';
    case 'weekly_scheduled':    return 'Weekly cron';
    case 'manual':              return 'Manual';
    default:                    return reason;
  }
}

function slugifyCjProductTitle(value?: string | null) {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCjProductUrl(title?: string | null, externalProductId?: string | null) {
  const productId = String(externalProductId || '').trim();
  const slug = slugifyCjProductTitle(title);

  if (!productId || !slug) {
    return null;
  }

  return `${cjProductBaseUrl}/${slug}-p-${productId}.html`;
}

function parseObjectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function pickStringValue(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function formatReadableStatus(value?: string | null) {
  const normalized = pickStringValue(value);
  if (!normalized) return 'Not set';
  return normalized.replace(/[_:]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function badgeToneClasses(tone: 'gray' | 'blue' | 'amber' | 'green') {
  if (tone === 'blue') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (tone === 'green') return 'border-green-200 bg-green-50 text-green-700';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function getShipmentSourcing(shipment: InboundShipment) {
  const subOrderMetadata = parseObjectValue(shipment.sub_orders?.metadata);
  return parseObjectValue(subOrderMetadata.global_sourcing);
}

function getShipmentItems(shipment: InboundShipment) {
  const sourcing = getShipmentSourcing(shipment);
  if (Array.isArray(sourcing.items)) {
    return sourcing.items.filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
    );
  }

  const metadata = parseObjectValue(shipment.metadata);
  if (Array.isArray(metadata.items)) {
    return metadata.items.filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
    );
  }

  return [];
}

function getShipmentPrimaryItem(shipment: InboundShipment) {
  const items = getShipmentItems(shipment);
  const shipmentCjVid = pickStringValue(shipment.cj_vid);
  const shipmentCjPid = pickStringValue(shipment.cj_pid);

  return (
    items.find((item) => pickStringValue(item.cj_vid, item.cjVid) === shipmentCjVid && shipmentCjVid) ||
    items.find((item) => pickStringValue(item.cj_pid, item.cjPid) === shipmentCjPid && shipmentCjPid) ||
    items[0] ||
    {}
  );
}

/** Labels for PWA/CJ inbound line items (variation_attributes from create-order metadata). */
function formatInboundItemVariation(item: Record<string, unknown>): string {
  const raw = item.variation_attributes ?? item.variationAttributes;
  if (raw == null) return '';
  if (Array.isArray(raw)) {
    return raw
      .map((a: unknown) => {
        if (!a || typeof a !== 'object') return '';
        const o = a as Record<string, unknown>;
        const name = String(o.name ?? o.attribute ?? '').trim();
        const val = o.option ?? o.value ?? o.option_value;
        const valStr = val !== undefined && val !== null ? String(val).trim() : '';
        if (name && valStr) return `${name}: ${valStr}`;
        if (valStr) return valStr;
        return name;
      })
      .filter(Boolean)
      .join(', ');
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => (v != null && String(v) !== '' ? `${k}: ${String(v)}` : ''))
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

function getShipmentQuantity(shipment: InboundShipment) {
  const item = getShipmentPrimaryItem(shipment);
  const quantity = Number(item.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getShipmentSupplierOrderMode(shipment: InboundShipment) {
  return (
    pickStringValue(
      shipment.supplier_order_mode,
      getShipmentSourcing(shipment).supplier_order_mode
    ) || 'automatic'
  );
}

function getShipmentSupplierOrderStatus(shipment: InboundShipment) {
  const explicit = pickStringValue(
    shipment.supplier_order_status,
    getShipmentSourcing(shipment).supplier_order_status
  );
  if (explicit) return explicit;
  if (shipment.received_at_hub_at || shipment.inbound_status === 'received_at_hub') {
    return 'received_at_hub';
  }
  if (
    shipment.inbound_status === 'supplier_shipped' ||
    shipment.inbound_status === 'supplier_in_transit' ||
    shipment.inbound_status === 'supplier_delivered'
  ) {
    return 'supplier_shipped';
  }
  if (shipment.cj_order_id) return 'supplier_order_placed';
  return 'awaiting_supplier_order';
}

function getShipmentSnapshot(shipment: InboundShipment) {
  const item = getShipmentPrimaryItem(shipment);
  const metadata = parseObjectValue(shipment.metadata);
  const variationLabel = formatInboundItemVariation(item);
  return {
    productId: pickStringValue(item.product_id, item.productId),
    variationId: pickStringValue(item.variation_id, item.variationId),
    cjPid: pickStringValue(shipment.cj_pid, item.cj_pid, item.cjPid),
    cjVid: pickStringValue(shipment.cj_vid, item.cj_vid, item.cjVid),
    title: pickStringValue(item.name, metadata.title, metadata.product_title),
    variationLabel,
    sku: pickStringValue(item.sku),
    quantity: getShipmentQuantity(shipment),
  };
}

function getShipmentCompatibilityKey(shipment: InboundShipment) {
  const snapshot = getShipmentSnapshot(shipment);
  const provider = pickStringValue(shipment.provider, getShipmentSourcing(shipment).provider) || 'cj';
  return snapshot.cjPid && snapshot.cjVid ? [provider, snapshot.cjPid, snapshot.cjVid].join(':') : null;
}

function getShipmentOpenCjUrl(shipment: InboundShipment) {
  const snapshot = getShipmentSnapshot(shipment);
  return buildCjProductUrl(snapshot.title, snapshot.cjPid);
}

function getManualShipmentEligibility(shipment: InboundShipment) {
  const provider = pickStringValue(shipment.provider, getShipmentSourcing(shipment).provider) || 'cj';
  const mode = getShipmentSupplierOrderMode(shipment);
  const status = getShipmentSupplierOrderStatus(shipment);
  const compatibilityKey = getShipmentCompatibilityKey(shipment);

  if (provider !== 'cj') {
    return { eligible: false, reason: 'Only CJ provider rows can be grouped manually' };
  }
  if (!compatibilityKey) {
    return { eligible: false, reason: 'Missing CJ product or variant details on this shipment' };
  }
  if (shipment.manual_supplier_order_id || mode === 'manual') {
    return { eligible: false, reason: 'Already linked to a manual supplier order' };
  }
  if (shipment.cj_order_id) {
    return { eligible: false, reason: 'Already has a supplier order reference' };
  }
  if (status !== 'awaiting_supplier_order') {
    return { eligible: false, reason: `Not awaiting supplier ordering (${formatReadableStatus(status)})` };
  }
  if (shipment.inbound_status === 'received_at_hub' || shipment.received_at_hub_at) {
    return { eligible: false, reason: 'Shipment is already marked received at hub' };
  }

  return { eligible: true, compatibilityKey };
}

function buildManualSelectionSummary(selectedShipments: InboundShipment[]) {
  if (selectedShipments.length === 0) {
    return { valid: false as const, error: 'Select one or more compatible inbound rows' };
  }

  let compatibilityKey: string | null = null;
  let totalQuantity = 0;
  let snapshot: ReturnType<typeof getShipmentSnapshot> | null = null;

  for (const shipment of selectedShipments) {
    const eligibility = getManualShipmentEligibility(shipment);
    if (!eligibility.eligible) {
      return { valid: false as const, error: eligibility.reason || 'Selection is not eligible' };
    }
    if (compatibilityKey && eligibility.compatibilityKey !== compatibilityKey) {
      return {
        valid: false as const,
        error: 'Selected rows must share the same CJ product and variant before saving one manual order',
      };
    }
    compatibilityKey = eligibility.compatibilityKey || null;
    const nextSnapshot = getShipmentSnapshot(shipment);
    totalQuantity += nextSnapshot.quantity;
    if (!snapshot) snapshot = nextSnapshot;
  }

  return {
    valid: true as const,
    selectedCount: selectedShipments.length,
    totalQuantity,
    compatibilityKey,
    snapshot,
    cjUrl: snapshot ? buildCjProductUrl(snapshot.title, snapshot.cjPid) : null,
  };
}

function matchesShipmentFilter(shipment: InboundShipment, filter: ShipmentFilter) {
  if (filter === 'all') return true;

  const mode = getShipmentSupplierOrderMode(shipment);
  const status = getShipmentSupplierOrderStatus(shipment);

  if (filter === 'awaiting_supplier_order') {
    return status === 'awaiting_supplier_order';
  }
  if (filter === 'manual_ordered') {
    return mode === 'manual' && status !== 'received_at_hub';
  }
  if (filter === 'auto_ordered') {
    return mode === 'automatic' && status !== 'awaiting_supplier_order' && status !== 'received_at_hub';
  }
  if (filter === 'received_at_hub') {
    return status === 'received_at_hub' || shipment.inbound_status === 'received_at_hub';
  }

  return true;
}

function formatImportJobProgress(job: ImportJobData | null) {
  if (!job) return null;

  const stage = String(job.progress_stage || 'queued')
    .replace(/[_:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const total = Number(job.progress_total || 0);
  const current = Number(job.progress_current || 0);

  if (total > 0) {
    return `${stage} (${Math.min(current, total)}/${total})`;
  }

  return stage;
}

function formatImportJobError(job: ImportJobData) {
  const stage =
    typeof job.error_details?.stage === 'string' && job.error_details.stage.trim()
      ? ` [stage: ${job.error_details.stage.trim()}]`
      : '';
  return `${job.error_message || 'Unable to import product'}${stage}`;
}

function endpointCandidates(endpoint: string) {
  const urls = [`/api/${endpoint}`, `${functionsBase}/${endpoint}`];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888/api/${endpoint}`);
    urls.push(`http://localhost:8888${functionsBase}/${endpoint}`);
  }
  return Array.from(new Set(urls));
}

function readStoredSelection(key: string) {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function persistSelection(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore local storage failures in private or restricted browsers.
  }
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
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = raw ? { raw } : {};
      }
      if (!response.ok) {
        const detail =
          typeof body?.details === 'object' && body?.details && 'stage' in body.details
            ? ` [stage: ${String((body.details as { stage?: unknown }).stage || 'unknown')}]`
            : '';
        throw new Error(
          String(body?.message || body?.error || body?.raw || `Request failed (${response.status})`) +
            detail
        );
      }
      return body as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Request failed');
      if (isLast) throw lastError;
    }
  }

  throw lastError || new Error('Request failed');
}

async function loadImportJobStatus(accessToken: string, jobId: string) {
  return callAdmin<{ data: ImportJobData }>(
    `global-sourcing-import-jobs?job_id=${encodeURIComponent(jobId)}`,
    accessToken,
    { method: 'GET' }
  );
}

export function GlobalSourcingPage() {
  const { session } = useAuth();
  const notification = useNotification();

  const [activeTab, setActiveTab] = useState<TabKey>('cj-products');
  const [loadingReferenceData, setLoadingReferenceData] = useState(true);
  const [referenceDataError, setReferenceDataError] = useState<string | null>(null);
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [hubCount, setHubCount] = useState<number | null>(null);
  const [vendorCount, setVendorCount] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [loadingMoreResults, setLoadingMoreResults] = useState(false);
  const [sourceLinkUrl, setSourceLinkUrl] = useState('');
  const [sourceLinkHtml, setSourceLinkHtml] = useState('');
  const [showSourceHtmlFallback, setShowSourceHtmlFallback] = useState(false);
  const [sourceLinkErrorHint, setSourceLinkErrorHint] = useState<string | null>(null);
  const [submittingSourceLink, setSubmittingSourceLink] = useState(false);
  const [sourceRequests, setSourceRequests] = useState<SourceLinkRequest[]>([]);
  const [, setLoadingSourceRequests] = useState(false);
  const [sourceRequestCount, setSourceRequestCount] = useState<number | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [inspectingProductId, setInspectingProductId] = useState<string | null>(null);
  const [pricingPreview, setPricingPreview] = useState<PricingPreview | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [manualWooVendorId, setManualWooVendorId] = useState('');
  const [manualWooVendorName, setManualWooVendorName] = useState('');
  const [selectedHubId, setSelectedHubId] = useState('');
  const [price, setPrice] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourcingTag, setSourcingTag] = useState('Ships from Abroad');
  const [importBufferUsd, setImportBufferUsd] = useState('');
  const [markupPercent, setMarkupPercent] = useState('');
  const [markupFlatNgn, setMarkupFlatNgn] = useState('');
  const [importing, setImporting] = useState(false);
  const [activeImportJob, setActiveImportJob] = useState<ImportJobData | null>(null);
  const [importedProducts, setImportedProducts] = useState<ImportedProduct[]>([]);
  const [loadingImported, setLoadingImported] = useState(false);
  const [deletingImportedProductId, setDeletingImportedProductId] = useState<string | null>(null);
  const [importedProductsCount, setImportedProductsCount] = useState<number | null>(null);
  const [shipments, setShipments] = useState<InboundShipment[]>([]);
  const [loadingShipments, setLoadingShipments] = useState(false);
  const [shipmentActionId, setShipmentActionId] = useState<string | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentFilter>('all');
  const [selectedManualShipmentIds, setSelectedManualShipmentIds] = useState<string[]>([]);
  const [manualSupplierOrderId, setManualSupplierOrderId] = useState('');
  const [manualOrderedAt, setManualOrderedAt] = useState(() => {
    const now = new Date();
    const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
    return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
  });
  const [manualSupplierNotes, setManualSupplierNotes] = useState('');
  const [savingManualSupplierOrder, setSavingManualSupplierOrder] = useState(false);
  const [pricingSettings, setPricingSettings] = useState<GlobalSourcingSettingsData | null>(null);
  const [loadingPricingSettings, setLoadingPricingSettings] = useState(false);
  const [savingPricingSettings, setSavingPricingSettings] = useState(false);
  const [refreshingFxRate, setRefreshingFxRate] = useState(false);
  const [fxManualOverrideEnabled, setFxManualOverrideEnabled] = useState(false);
  const [fxManualRate, setFxManualRate] = useState('');
  const [fxManualRateNote, setFxManualRateNote] = useState('');
  const [fxLiveApiEnabled, setFxLiveApiEnabled] = useState(true);
  const [fxSyncStatus, setFxSyncStatus] = useState<FxSyncStatusData | null>(null);
  const [loadingFxSyncStatus, setLoadingFxSyncStatus] = useState(false);
  const [runningManualSync, setRunningManualSync] = useState(false);

  const selectedVariant = useMemo(
    () => productDetails?.variants.find((variant) => variant.external_variant_id === selectedVariantId) || null,
    [productDetails, selectedVariantId]
  );
  const previewImage = selectedVariant?.image || productDetails?.images?.[0] || null;
  const inspectedFlags = useMemo(() => getInspectedProductFlags(productDetails), [productDetails]);
  const selectedManualShipments = useMemo(
    () => shipments.filter((shipment) => selectedManualShipmentIds.includes(shipment.id)),
    [selectedManualShipmentIds, shipments]
  );
  const manualSelectionSummary = useMemo(
    () => buildManualSelectionSummary(selectedManualShipments),
    [selectedManualShipments]
  );
  const filteredShipments = useMemo(
    () => shipments.filter((shipment) => matchesShipmentFilter(shipment, shipmentFilter)),
    [shipmentFilter, shipments]
  );

  const parsedImportBufferUsd = useMemo(() => {
    const trimmed = importBufferUsd.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }, [importBufferUsd]);
  const parsedMarkupPercent = useMemo(() => {
    const trimmed = markupPercent.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }, [markupPercent]);
  const parsedMarkupFlatNgn = useMemo(() => {
    const trimmed = markupFlatNgn.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }, [markupFlatNgn]);
  const parsedFxManualRate = useMemo(() => {
    const trimmed = fxManualRate.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }, [fxManualRate]);
  const effectiveImportBufferUsd =
    parsedImportBufferUsd ?? pricingSettings?.values?.import_buffer_usd ?? null;
  const effectiveMarkupPercent =
    parsedMarkupPercent ?? pricingSettings?.values?.markup_percent ?? null;
  const effectiveMarkupFlatNgn =
    parsedMarkupFlatNgn ?? pricingSettings?.values?.markup_flat_ngn ?? null;
  const effectiveFxRate = pricingSettings?.fx?.effective_rate ?? pricingSettings?.fx?.last_fetched_rate ?? null;
  const effectiveFxSource = pricingSettings?.fx?.effective_source ?? 'Not set';

  const pickDefaultInboundHub = useCallback((hubRows: HubOption[]) => {
    return (
      hubRows.find((hub) => {
        if (hub.is_default === true) return true;
        const metadata =
          hub.metadata && typeof hub.metadata === 'object' ? hub.metadata : {};
        return (
          metadata.default_inbound === true ||
          metadata.is_default_inbound === true ||
          metadata.defaultInbound === true ||
          metadata.isDefaultInbound === true
        );
      }) || hubRows[0]
    );
  }, []);

  const applyPricingDefaultsToForm = useCallback(
    (settings: GlobalSourcingSettingsData, force = false) => {
      const values = settings.values || {
        import_buffer_usd: null,
        markup_percent: null,
        markup_flat_ngn: null,
        usd_to_ngn_rate: null,
      };

      setImportBufferUsd((current) =>
        force || !current.trim()
          ? values.import_buffer_usd !== null
            ? String(values.import_buffer_usd)
            : ''
          : current
      );
      setMarkupPercent((current) =>
        force || !current.trim()
          ? values.markup_percent !== null
            ? String(values.markup_percent)
            : ''
          : current
      );
      setMarkupFlatNgn((current) =>
        force || !current.trim()
          ? values.markup_flat_ngn !== null
            ? String(values.markup_flat_ngn)
            : ''
          : current
      );
    },
    []
  );

  const applyFxSettingsToForm = useCallback(
    (settings: GlobalSourcingSettingsData, force = false) => {
      const fx = settings.fx || null;
      if (!fx) return;

      setFxManualOverrideEnabled(fx.manual_override_enabled);
      setFxManualRate((current) =>
        force || !current.trim()
          ? fx.manual_rate !== null
            ? String(fx.manual_rate)
            : ''
          : current
      );
      setFxManualRateNote((current) =>
        force || !current.trim()
          ? fx.manual_rate_note !== null
            ? String(fx.manual_rate_note)
            : ''
          : current
      );
      setFxLiveApiEnabled(fx.live_api_enabled);
    },
    []
  );

  const loadReferenceData = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingReferenceData(true);
    setReferenceDataError(null);
    try {
      const response = await callAdmin<{ data: ReferenceDataResponse }>(
        'global-sourcing-reference-data',
        session.access_token,
        { method: 'GET' }
      );
      const nextHubs = response.data?.hubs || [];
      const nextVendors = response.data?.vendors || [];
      const storedHubId = readStoredSelection(sourcingHubStorageKey);
      const storedVendorId = readStoredSelection(sourcingVendorStorageKey);
      setManualWooVendorId(readStoredSelection(sourcingWooVendorStorageKey));
      setManualWooVendorName(readStoredSelection(sourcingWooVendorNameStorageKey));
      const defaultHubId =
        nextHubs.find((hub) => hub.id === storedHubId)?.id ||
        pickDefaultInboundHub(nextHubs)?.id ||
        '';
      const defaultVendorId =
        nextVendors.find((vendor) => vendor.id === storedVendorId)?.id ||
        nextVendors[0]?.id ||
        '';

      setHubs(nextHubs);
      setVendors(nextVendors);
      setHubCount(response.data?.counts?.hubs ?? nextHubs.length);
      setVendorCount(response.data?.counts?.vendors ?? nextVendors.length);
      setSelectedHubId(defaultHubId);
      setSelectedVendorId(defaultVendorId);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unable to load hubs and vendors');
      setReferenceDataError(message);
      setHubs([]);
      setVendors([]);
      setHubCount(0);
      setVendorCount(0);
      notification.error('Load failed', message);
    } finally {
      setLoadingReferenceData(false);
    }
  }, [notification, pickDefaultInboundHub, session?.access_token]);

  useEffect(() => {
    persistSelection(sourcingVendorStorageKey, selectedVendorId);
  }, [selectedVendorId]);

  useEffect(() => {
    persistSelection(sourcingWooVendorStorageKey, manualWooVendorId);
  }, [manualWooVendorId]);

  useEffect(() => {
    persistSelection(sourcingWooVendorNameStorageKey, manualWooVendorName);
  }, [manualWooVendorName]);

  useEffect(() => {
    persistSelection(sourcingHubStorageKey, selectedHubId);
  }, [selectedHubId]);

  const loadSourceRequests = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingSourceRequests(true);
    try {
      const response = await callAdmin<{ data: SourceLinkRequest[] }>(
        'global-sourcing-source-link',
        session.access_token,
        { method: 'GET' }
      );
      const requests = response.data || [];
      setSourceRequests(requests);
      setSourceRequestCount(requests.length);
    } catch (error: unknown) {
      notification.error(
        'Load failed',
        getErrorMessage(error, 'Unable to load Source by Link requests')
      );
    } finally {
      setLoadingSourceRequests(false);
    }
  }, [notification, session?.access_token]);

  const hydrateProductForImport = useCallback(
    async ({
      product,
      externalProductId,
      fallbackTitle,
      fallbackDescription = '',
      fallbackImages = [],
      fallbackSourcePrice = null,
      fallbackCurrency = 'USD',
    }: {
      product?: ProductDetails | null;
      externalProductId: string;
      fallbackTitle?: string;
      fallbackDescription?: string;
      fallbackImages?: string[];
      fallbackSourcePrice?: number | null;
      fallbackCurrency?: string;
    }) => {
      if (!session?.access_token) {
        throw new Error('Admin session is missing');
      }

      if (product) {
        const candidateImages = Array.isArray(product.images)
          ? product.images.filter(Boolean)
          : [];
        const descriptionImages = Array.isArray(product.description_images)
          ? product.description_images.filter(Boolean)
          : [];

        return {
          ...product,
          external_product_id: product.external_product_id || externalProductId,
          title: product.title?.trim() || fallbackTitle || 'Supplier product',
          description: product.description?.trim() || fallbackDescription,
          description_images: descriptionImages,
          images: candidateImages.length > 0 ? candidateImages : fallbackImages,
          source_price: product.source_price ?? fallbackSourcePrice,
          currency: product.currency || fallbackCurrency || 'USD',
          supplier_source: product.supplier_source || product.provider,
          supplier_product_id:
            product.supplier_product_id || product.external_product_id || externalProductId,
          supplier_url: product.supplier_url || null,
          inbound_shipping_usd: product.inbound_shipping_usd ?? null,
          variants: Array.isArray(product.variants)
            ? product.variants.map((variant) => ({
                ...variant,
                inbound_shipping_usd: variant.inbound_shipping_usd ?? product.inbound_shipping_usd ?? null,
              }))
            : [],
        } as ProductDetails;
      }

      const response = await callAdmin<{ data: { product: ProductDetails } }>(
        'cj-product-details',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({ external_product_id: externalProductId }),
        }
      );

      const candidateImages = Array.isArray(response.data.product.images)
        ? response.data.product.images.filter(Boolean)
        : [];
      const descriptionImages = Array.isArray(response.data.product.description_images)
        ? response.data.product.description_images.filter(Boolean)
        : [];

      return {
        ...response.data.product,
        external_product_id: response.data.product.external_product_id || externalProductId,
        title: response.data.product.title?.trim() || fallbackTitle || 'CJ product',
        description: response.data.product.description?.trim() || fallbackDescription,
        description_images: descriptionImages,
        images: candidateImages.length > 0 ? candidateImages : fallbackImages,
        source_price: response.data.product.source_price ?? fallbackSourcePrice,
        currency: response.data.product.currency || fallbackCurrency || 'USD',
      } as ProductDetails;
    },
    [session?.access_token]
  );

  const loadImportedProducts = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingImported(true);
    try {
      const response = await callAdmin<{ data: ImportedProduct[] }>('global-sourcing-products', session.access_token, { method: 'GET' });
      setImportedProducts(response.data || []);
      setImportedProductsCount(response.data?.length || 0);
    } catch (error: unknown) {
      notification.error('Load failed', getErrorMessage(error, 'Unable to load imported products'));
    } finally {
      setLoadingImported(false);
    }
  }, [notification, session?.access_token]);

  const deleteImportedProduct = async (wooProductId: string, productName: string) => {
    if (!session?.access_token) return;

    const confirmed = window.confirm(
      `Delete imported product "${productName}" (Woo #${wooProductId}) permanently? This will remove it from WooCommerce.`
    );
    if (!confirmed) return;

    setDeletingImportedProductId(wooProductId);
    try {
      await callAdmin(
        `global-sourcing-products?woo_product_id=${encodeURIComponent(wooProductId)}`,
        session.access_token,
        { method: 'DELETE' }
      );
      notification.success('Deleted', `Imported product Woo #${wooProductId} was deleted`);
      setImportedProducts((current) =>
        current.filter((product) => product.woo_product_id !== wooProductId)
      );
      setImportedProductsCount((current) =>
        current === null ? current : Math.max(0, current - 1)
      );
    } catch (error: unknown) {
      notification.error(
        'Delete failed',
        getErrorMessage(error, 'Unable to delete imported product')
      );
    } finally {
      setDeletingImportedProductId(null);
    }
  };

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

  const loadPricingSettings = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingPricingSettings(true);
    try {
      const response = await callAdmin<{ data: GlobalSourcingSettingsData }>(
        'global-sourcing-settings',
        session.access_token,
        { method: 'GET' }
      );
      setPricingSettings(response.data);
      applyPricingDefaultsToForm(response.data, false);
      applyFxSettingsToForm(response.data, false);
    } catch (error: unknown) {
      notification.error(
        'Pricing defaults failed',
        getErrorMessage(error, 'Unable to load Global Sourcing pricing defaults')
      );
    } finally {
      setLoadingPricingSettings(false);
    }
  }, [applyFxSettingsToForm, applyPricingDefaultsToForm, notification, session?.access_token]);

  const loadFxSyncStatus = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingFxSyncStatus(true);
    try {
      const response = await callAdmin<{ data: FxSyncStatusData }>('fx-price-sync', session.access_token);
      setFxSyncStatus(response.data);
    } catch {
      // non-critical — leave existing state
    } finally {
      setLoadingFxSyncStatus(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    void loadReferenceData();
    void loadSourceRequests();
    void loadPricingSettings();
  }, [loadPricingSettings, loadReferenceData, loadSourceRequests, session?.access_token]);

  useEffect(() => {
    if (!productDetails) return;
    setTitle(productDetails.title);
    setDescription(productDetails.description);
    setPrice('');
    if (!selectedVariantId && productDetails.variants[0]) {
      setSelectedVariantId(productDetails.variants[0].external_variant_id);
    }
  }, [productDetails, selectedVariant, selectedVariantId]);

  useEffect(() => {
    setPricingPreview(null);
    setPrice('');
  }, [
    selectedVariantId,
    selectedHubId,
    productDetails?.external_product_id,
    importBufferUsd,
    markupPercent,
    markupFlatNgn,
  ]);

  useEffect(() => {
    if (!session?.access_token) return;
    if (activeTab === 'source-by-link' && sourceRequests.length === 0) void loadSourceRequests();
    if (activeTab === 'imported-products' && importedProducts.length === 0) void loadImportedProducts();
    if (activeTab === 'inbound-shipments' && shipments.length === 0) void loadShipments();
    if (activeTab === 'settings' && !pricingSettings && !loadingPricingSettings) void loadPricingSettings();
    if (activeTab === 'settings' && !fxSyncStatus && !loadingFxSyncStatus) void loadFxSyncStatus();
  }, [
    activeTab,
    loadSourceRequests,
    importedProducts.length,
    loadImportedProducts,
    loadPricingSettings,
    loadFxSyncStatus,
    loadShipments,
    loadingPricingSettings,
    loadingFxSyncStatus,
    sourceRequests.length,
    session?.access_token,
    pricingSettings,
    fxSyncStatus,
    shipments.length,
  ]);

  useEffect(() => {
    setSelectedManualShipmentIds((current) =>
      current.filter((shipmentId) => shipments.some((shipment) => shipment.id === shipmentId))
    );
  }, [shipments]);

  const savePricingSettings = async () => {
    if (!session?.access_token) return;
    if (fxManualOverrideEnabled && parsedFxManualRate === null) {
      notification.error(
        'FX settings required',
        'Enter a manual USD → NGN rate before enabling manual override'
      );
      return;
    }
    setSavingPricingSettings(true);
    try {
      const response = await callAdmin<{ data: GlobalSourcingSettingsData }>(
        'global-sourcing-settings',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({
            import_buffer_usd: parsedImportBufferUsd,
            markup_percent: parsedMarkupPercent,
            markup_flat_ngn: parsedMarkupFlatNgn,
            usd_to_ngn_rate: pricingSettings?.values?.usd_to_ngn_rate ?? null,
            manual_override_enabled: fxManualOverrideEnabled,
            manual_rate: parsedFxManualRate,
            manual_rate_note: fxManualRateNote.trim() || null,
            live_api_enabled: fxLiveApiEnabled,
          }),
        }
      );
      setPricingSettings(response.data);
      applyPricingDefaultsToForm(response.data, true);
      applyFxSettingsToForm(response.data, true);
      notification.success('Saved', 'Global Sourcing settings updated');
    } catch (error: unknown) {
      notification.error(
        'Save failed',
        getErrorMessage(error, 'Unable to save Global Sourcing pricing defaults')
      );
    } finally {
      setSavingPricingSettings(false);
    }
  };

  const refreshFxRate = async () => {
    if (!session?.access_token) return;
    setRefreshingFxRate(true);
    try {
      const response = await callAdmin<{
        data: GlobalSourcingSettingsData;
        note?: string | null;
        price_sync?: { synced: boolean; reason?: string; updatedSimple?: number; updatedVariations?: number } | null;
      }>(
        'global-sourcing-settings',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'refresh_fx_rate' }),
        }
      );
      setPricingSettings(response.data);
      applyPricingDefaultsToForm(response.data, true);
      applyFxSettingsToForm(response.data, true);

      const sync = response.price_sync;
      if (response.note) {
        notification.warning('FX refreshed with cache warning', response.note);
      } else if (sync?.synced) {
        const total = (sync.updatedSimple ?? 0) + (sync.updatedVariations ?? 0);
        notification.success(
          'FX refreshed & prices updated',
          `Rate changed ≥3% — ${total} product price${total !== 1 ? 's' : ''} re-synced`
        );
      } else {
        notification.success('FX refreshed', 'Rate is within 3% of last sync — no price update needed');
      }

      void loadFxSyncStatus();
    } catch (error: unknown) {
      notification.error('FX refresh failed', getErrorMessage(error, 'Unable to fetch the latest live rate'));
    } finally {
      setRefreshingFxRate(false);
    }
  };

  const runManualSync = async () => {
    if (!session?.access_token) return;
    setRunningManualSync(true);
    try {
      const response = await callAdmin<{
        data: { synced: boolean; updatedSimple: number; updatedVariations: number; skipped: number; errors: string[] | null };
      }>(
        'fx-price-sync',
        session.access_token,
        { method: 'POST', body: JSON.stringify({ action: 'run_sync' }) }
      );
      const d = response.data;
      const total = d.updatedSimple + d.updatedVariations;
      notification.success(
        'Price sync complete',
        `${total} product price${total !== 1 ? 's' : ''} updated (${d.updatedSimple} simple, ${d.updatedVariations} variations)`
      );
      void loadFxSyncStatus();
    } catch (error: unknown) {
      notification.error('Sync failed', getErrorMessage(error, 'Unable to run price sync'));
    } finally {
      setRunningManualSync(false);
    }
  };

  const runProductSearch = async (page: number, append = false) => {
    if (!session?.access_token) return;
    if (!searchQuery.trim()) {
      notification.error('Search required', 'Enter a CJ product query');
      return;
    }

    if (append) {
      setLoadingMoreResults(true);
    } else {
      setSearching(true);
      setSearchAttempted(true);
      setSearchError(null);
      setInspectError(null);
      setProductDetails(null);
      setSearchPage(1);
      setHasMoreResults(false);
    }

    try {
      const response = await callAdmin<{ data: { results: SearchProduct[] } }>('cj-search-products', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery.trim(), page, pageSize: cjSearchPageSize }),
      });
      const nextResults = response.data?.results || [];
      setResults((current) => (append ? [...current, ...nextResults] : nextResults));
      setSearchPage(page);
      setHasMoreResults(nextResults.length === cjSearchPageSize);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unable to search CJ products');
      if (!append) {
        setResults([]);
      }
      setSearchError(message);
      notification.error('CJ search failed', message);
    } finally {
      if (append) {
        setLoadingMoreResults(false);
      } else {
        setSearching(false);
      }
    }
  };

  const searchProducts = async (event: FormEvent) => {
    event.preventDefault();
    await runProductSearch(1, false);
  };

  const loadMoreProducts = async () => {
    if (loadingMoreResults || searching || !hasMoreResults) return;
    await runProductSearch(searchPage + 1, true);
  };

  const inspectProduct = async (product: SearchProduct) => {
    if (!session?.access_token) return;
    setInspectingProductId(product.external_product_id);
    setInspectError(null);
    setPricingPreview(null);
    try {
      const fallbackImages = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
      const hydratedProduct = await hydrateProductForImport({
        externalProductId: product.external_product_id,
        fallbackTitle: product.title,
        fallbackImages,
        fallbackSourcePrice: product.source_price,
        fallbackCurrency: product.currency || 'USD',
      });
      setProductDetails(hydratedProduct);
      setSelectedVariantId(hydratedProduct.variants[0]?.external_variant_id || null);
      setTitle(hydratedProduct.title);
      setDescription(hydratedProduct.description);
      setPrice('');
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unable to load product details');
      setInspectError(message);
      notification.error('Inspect failed', message);
    } finally {
      setInspectingProductId(null);
    }
  };

  const submitSourceLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.access_token) return;
    if (!sourceLinkUrl.trim()) {
      notification.error('Supplier URL required', 'Paste an AliExpress product URL');
      return;
    }

    setSubmittingSourceLink(true);
    setSourceLinkErrorHint(null);
    try {
      const response = await callAdmin<{ data: { product: ProductDetails; source_mode?: string } }>(
        'global-sourcing-aliexpress-ingest',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({
            product_url: sourceLinkUrl.trim(),
            ...(sourceLinkHtml.trim() ? { product_html: sourceLinkHtml } : {}),
          }),
        }
      );

      const hydratedProduct = await hydrateProductForImport({
        product: response.data.product,
        externalProductId:
          response.data.product.external_product_id ||
          response.data.product.supplier_product_id ||
          sourceLinkUrl.trim(),
        fallbackTitle: response.data.product.title,
        fallbackDescription: response.data.product.description || '',
        fallbackImages: response.data.product.images || [],
        fallbackSourcePrice: response.data.product.source_price,
        fallbackCurrency: response.data.product.currency || 'USD',
      });

      setProductDetails(hydratedProduct);
      setSelectedVariantId(hydratedProduct.variants[0]?.external_variant_id || null);
      setTitle(hydratedProduct.title);
      setDescription(hydratedProduct.description);
      setPricingPreview(null);
      setPrice('');
      setSourceLinkErrorHint(null);
      setActiveTab('cj-products');
      notification.success(
        'Supplier product loaded',
        response.data.source_mode === 'pasted_html'
          ? 'Parsed from pasted page HTML. Review the variant, quote landed price, then continue into the existing import flow'
          : 'Review the variant, quote landed price, then continue into the existing import flow'
      );
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Unable to ingest the supplier product');
      setShowSourceHtmlFallback(true);
      setSourceLinkErrorHint(message);
      notification.error(
        'Ingestion failed',
        message
      );
    } finally {
      setSubmittingSourceLink(false);
    }
  };

  const runImportJob = async (accessToken: string, jobId: string) => {
    let attempts = 0;

    for (;;) {
      attempts += 1;
      let job: ImportJobData;

      try {
        const response = await callAdmin<{ data: ImportJobData }>(
          'global-sourcing-import-jobs',
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({ job_id: jobId }),
          }
        );
        job = response.data;
      } catch (error) {
        const fallbackResponse = await loadImportJobStatus(accessToken, jobId).catch(() => null);
        if (!fallbackResponse?.data) {
          throw error;
        }
        job = fallbackResponse.data;
      }

      setActiveImportJob(job);

      if (job.status === 'completed') {
        return job;
      }

      if (job.status === 'failed') {
        throw new Error(formatImportJobError(job));
      }

      if (attempts >= 120) {
        throw new Error('Import job exceeded 120 processing steps without completing');
      }

      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  };

  const importProduct = async () => {
    if (!session?.access_token || !productDetails) return;
    if ((!selectedVendorId && !manualWooVendorId.trim()) || !selectedHubId) {
      notification.error(
        'Missing mapping',
        'Select a target vendor or enter a Woo/WCFM vendor id, and choose a receiving hub'
      );
      return;
    }
    if (!pricingPreview) {
      notification.error('Quote required', 'Generate a landed price quote before importing');
      return;
    }
    setImporting(true);
    setActiveImportJob(null);
    try {
      const accessToken = session.access_token;
      const payload = {
        provider: productDetails.provider || 'cj',
        external_product_id: productDetails.external_product_id,
        external_variant_id: selectedVariant?.external_variant_id || null,
        supplier_source: productDetails.supplier_source || productDetails.provider || 'cj',
        supplier_product_id:
          productDetails.supplier_product_id || productDetails.external_product_id,
        supplier_variant_id: selectedVariant?.external_variant_id || null,
        supplier_url: productDetails.supplier_url || null,
        title: title.trim() || productDetails.title,
        description: description.trim(),
        description_images: productDetails.description_images || [],
        images: productDetails.images,
        selected_attributes: selectedVariant?.attributes || {},
        selected_variant: selectedVariant
          ? {
              external_variant_id: selectedVariant.external_variant_id,
              title: selectedVariant.title,
              image: selectedVariant.image || null,
              source_price: selectedVariant.source_price,
              currency: selectedVariant.currency,
              inbound_shipping_usd:
                selectedVariant.inbound_shipping_usd ?? productDetails.inbound_shipping_usd ?? null,
              attributes: selectedVariant.attributes,
            }
          : null,
        variants: productDetails.variants.map((variant) => ({
          external_variant_id: variant.external_variant_id,
          title: variant.title,
          image: variant.image || null,
          source_price: variant.source_price,
          currency: variant.currency,
          inbound_shipping_usd:
            variant.inbound_shipping_usd ?? productDetails.inbound_shipping_usd ?? null,
          attributes: variant.attributes,
        })),
        regular_price: price,
        currency: selectedVariant?.currency || productDetails.currency || 'USD',
        sourcing_tag_label_suggestion: sourcingTag,
        fulfillment_mode: 'cj_hub',
        receiving_hub_id: selectedHubId,
        pricing_preview: pricingPreview,
        target_vendor_mapping: {
          ...(selectedVendorId ? { vendor_id: selectedVendorId } : {}),
          ...(manualWooVendorId.trim()
            ? {
                woocommerce_vendor_id: manualWooVendorId.trim(),
                store_name: manualWooVendorName.trim() || `Woo Vendor ${manualWooVendorId.trim()}`,
              }
            : {}),
        },
        supplier_price_snapshot: selectedVariant?.source_price ?? productDetails.source_price ?? null,
        inbound_shipping_usd:
          selectedVariant?.inbound_shipping_usd ?? productDetails.inbound_shipping_usd ?? null,
      };
      const queuedJob = await callAdmin<{ data: ImportJobData }>('global-sourcing-import-product', accessToken, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setActiveImportJob(queuedJob.data);
      const completedJob = await runImportJob(accessToken, queuedJob.data.job_id);
      const result = completedJob.result;
      if (!result) {
        throw new Error('Import job completed without a result payload');
      }

      notification.success(
        'Imported',
        result.imported_variation_count
          ? `Woo product ${result.woo_product_id} updated with ${result.imported_variation_count} variant(s)`
          : `Woo product ${result.woo_product_id} updated`
      );
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        notification.warning(
          'Import warnings',
          result.warnings.slice(0, 2).join(' ')
        );
      }
      setActiveImportJob(null);
      setActiveTab('imported-products');
      await loadImportedProducts();
    } catch (error: unknown) {
      notification.error('Import failed', getErrorMessage(error, 'Unable to import product'));
    } finally {
      setActiveImportJob(null);
      setImporting(false);
    }
  };

  const quotePricing = async () => {
    if (!session?.access_token || !selectedVariant || !selectedHubId) {
      notification.error('Missing inputs', 'Select a hub and supplier variant before quoting landed price');
      return;
    }

    setPricingLoading(true);
    try {
      const response = await callAdmin<{ data: PricingPreview }>(
        'global-sourcing-price-preview',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({
            provider: productDetails?.provider || 'cj',
            receiving_hub_id: selectedHubId,
            external_variant_id: selectedVariant.external_variant_id,
            source_price: selectedVariant.source_price,
            currency: selectedVariant.currency,
            inbound_shipping_usd:
              selectedVariant.inbound_shipping_usd ?? productDetails?.inbound_shipping_usd ?? null,
            ...(effectiveImportBufferUsd !== null
              ? { import_buffer_usd: effectiveImportBufferUsd }
              : {}),
            ...(effectiveMarkupPercent !== null
              ? { markup_percent: effectiveMarkupPercent }
              : {}),
            ...(effectiveMarkupFlatNgn !== null
              ? { markup_flat_ngn: effectiveMarkupFlatNgn }
              : {}),
          }),
        }
      );

      setPricingPreview(response.data);
      setPrice(response.data.final_price_ngn);
    } catch (error: unknown) {
      setPricingPreview(null);
      notification.error('Quote failed', getErrorMessage(error, 'Unable to quote landed pricing'));
    } finally {
      setPricingLoading(false);
    }
  };

  const resetManualSupplierOrderForm = () => {
    const now = new Date();
    const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
    setSelectedManualShipmentIds([]);
    setManualSupplierOrderId('');
    setManualOrderedAt(new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16));
    setManualSupplierNotes('');
  };

  const toggleManualShipmentSelection = (shipment: InboundShipment) => {
    const eligibility = getManualShipmentEligibility(shipment);
    if (!eligibility.eligible) {
      notification.error('Selection blocked', eligibility.reason || 'Shipment cannot be grouped manually');
      return;
    }

    setSelectedManualShipmentIds((current) => {
      if (current.includes(shipment.id)) {
        return current.filter((shipmentId) => shipmentId !== shipment.id);
      }

      const nextIds = [...current, shipment.id];
      const nextSelection = shipments.filter((entry) => nextIds.includes(entry.id));
      const nextSummary = buildManualSelectionSummary(nextSelection);

      if (!nextSummary.valid) {
        notification.error('Selection blocked', nextSummary.error);
        return current;
      }

      return nextIds;
    });
  };

  const saveManualSupplierOrder = async (event: FormEvent) => {
    event.preventDefault();
    if (!session?.access_token) return;
    if (!manualSelectionSummary.valid) {
      notification.error('Selection required', manualSelectionSummary.error);
      return;
    }
    if (!manualSupplierOrderId.trim()) {
      notification.error('CJ order required', 'Enter the manual CJ order ID before saving');
      return;
    }

    setSavingManualSupplierOrder(true);
    try {
      await callAdmin('global-sourcing-inbound-shipments', session.access_token, {
        method: 'POST',
        body: JSON.stringify({
          action: 'create_manual_supplier_order',
          shipment_ids: selectedManualShipmentIds,
          cj_order_id: manualSupplierOrderId.trim(),
          ordered_at: manualOrderedAt ? new Date(manualOrderedAt).toISOString() : null,
          notes: manualSupplierNotes.trim() || null,
        }),
      });
      notification.success(
        'Manual CJ order saved',
        `Linked ${manualSelectionSummary.selectedCount} inbound row(s) to CJ order ${manualSupplierOrderId.trim()}`
      );
      resetManualSupplierOrderForm();
      await loadShipments();
    } catch (error: unknown) {
      notification.error(
        'Manual order failed',
        getErrorMessage(error, 'Unable to save the manual supplier order')
      );
    } finally {
      setSavingManualSupplierOrder(false);
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

  const createSupplierOrder = async (shipmentId: string) => {
    if (!session?.access_token) return;
    setShipmentActionId(shipmentId);
    try {
      await callAdmin('global-sourcing-inbound-shipments', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ action: 'create_supplier_order', shipment_id: shipmentId }),
      });
      notification.success('Supplier order created', 'CJ order placement completed');
      await loadShipments();
    } catch (error: unknown) {
      notification.error(
        'Supplier order failed',
        getErrorMessage(error, 'Unable to create supplier order')
      );
    } finally {
      setShipmentActionId(null);
    }
  };

  const refreshCjTracking = async (shipmentId: string) => {
    if (!session?.access_token) return;
    setShipmentActionId(shipmentId);
    try {
      await callAdmin('global-sourcing-inbound-shipments', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh_cj_tracking', shipment_id: shipmentId }),
      });
      notification.success('Tracking refreshed', 'Fetched the latest CJ tracking status');
      await loadShipments();
    } catch (error: unknown) {
      notification.error(
        'Tracking refresh failed',
        getErrorMessage(error, 'Unable to refresh CJ tracking')
      );
    } finally {
      setShipmentActionId(null);
    }
  };

  const deleteInboundTestOrder = async (
    shipmentId: string,
    orderReference: string | null,
    hasSupplierOrder: boolean
  ) => {
    if (!session?.access_token) return;
    if (hasSupplierOrder) {
      notification.error(
        'Delete blocked',
        'This inbound shipment already has a supplier order and cannot be deleted from the test cleanup action'
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete test inbound order ${orderReference || shipmentId}? This will remove the inbound shipment and its linked app order records.`
    );
    if (!confirmed) return;

    setShipmentActionId(shipmentId);
    try {
      await callAdmin('global-sourcing-inbound-shipments', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_test_inbound', shipment_id: shipmentId }),
      });
      notification.success('Deleted', 'Test inbound order was removed');
      await loadShipments();
    } catch (error: unknown) {
      notification.error(
        'Delete failed',
        getErrorMessage(error, 'Unable to delete test inbound order')
      );
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
          <p>Hubs: {hubCount ?? '—'}</p>
          <p>Vendors: {vendorCount ?? '—'}</p>
          <p>Source requests: {sourceRequestCount ?? '—'}</p>
          <p>Imported products: {importedProductsCount ?? '—'}</p>
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

      {referenceDataError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to load hubs/vendors: {referenceDataError}
        </div>
      ) : null}

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
              {results.length > 0 ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  Loaded {results.length} CJ product result{results.length === 1 ? '' : 's'}
                  {hasMoreResults ? ` / page ${searchPage} / 100 per batch` : ''}
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
                  <div
                    key={product.external_product_id}
                    className={`rounded-lg border p-4 ${
                      productDetails?.external_product_id === product.external_product_id
                        ? 'border-primary-400 bg-primary-50'
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-gray-900">{product.title}</p>
                        <p className="text-sm text-gray-500">
                          {product.category || 'Uncategorized'} · PID {product.external_product_id}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          {product.source_price !== null ? `${product.currency} ${product.source_price}` : 'No source price'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {getSearchResultFlags(product).map((flag) => (
                            <span
                              key={`${product.external_product_id}-${flag.label}`}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses(flag.tone)}`}
                            >
                              {flag.label}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {buildCjProductUrl(product.title, product.external_product_id) ? (
                          <a
                            href={buildCjProductUrl(product.title, product.external_product_id) || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary inline-flex items-center gap-2"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open on CJ
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void inspectProduct(product)}
                          disabled={inspectingProductId === product.external_product_id}
                          className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
                        >
                          {inspectingProductId === product.external_product_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {productDetails?.external_product_id === product.external_product_id
                            ? 'Inspected'
                            : 'Inspect'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {results.length > 0 && hasMoreResults ? (
                <button
                  type="button"
                  onClick={() => void loadMoreProducts()}
                  disabled={loadingMoreResults || searching}
                  className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {loadingMoreResults ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Load More
                </button>
              ) : null}
            </div>
          </div>

          <div className="card space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Import to Woo</h2>
              <p className="text-sm text-gray-600">Woo remains the product source of truth.</p>
            </div>

            {inspectError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                Inspect failed: {inspectError}
              </div>
            ) : null}

            {inspectingProductId && !productDetails ? (
              <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary-600" />
                <p className="mt-3">Loading CJ product details...</p>
              </div>
            ) : null}

            {!productDetails ? (
              <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
                Inspect a CJ product to continue.
              </div>
            ) : (
              <>
                <div className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-[140px_1fr]">
                  <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {previewImage ? (
                      <img
                        src={previewImage}
                        alt={productDetails.title || 'CJ product'}
                        className="h-36 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-36 items-center justify-center text-gray-400">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                  </div>
	                  <div className="space-y-2 text-sm text-gray-700">
	                    <p className="font-semibold text-gray-900">
	                      {productDetails.title || 'Supplier product ready for import'}
	                    </p>
	                    <p>
	                      {productDetails.provider === 'aliexpress' ? 'Supplier ID' : 'PID'}{' '}
	                      {productDetails.external_product_id}
	                    </p>
	                    {productDetails.provider === 'cj' &&
	                    buildCjProductUrl(productDetails.title, productDetails.external_product_id) ? (
	                      <a
	                        href={buildCjProductUrl(productDetails.title, productDetails.external_product_id) || '#'}
	                        target="_blank"
	                        rel="noreferrer"
	                        className="inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800"
	                      >
	                        <ExternalLink className="h-4 w-4" />
	                        Open on CJ
	                      </a>
	                    ) : productDetails.supplier_url ? (
	                      <a
	                        href={productDetails.supplier_url}
	                        target="_blank"
	                        rel="noreferrer"
	                        className="inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800"
	                      >
	                        <ExternalLink className="h-4 w-4" />
	                        Open Supplier Page
	                      </a>
	                    ) : null}
                    <p>Variants: {productDetails.variants.length}</p>
                    <p>
                      Base source price:{' '}
                      {productDetails.source_price !== null
                        ? `${productDetails.currency || 'USD'} ${productDetails.source_price}`
                        : 'Not provided'}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(productDetails.images || []).slice(0, 4).map((image, index) => (
                        <img
                          key={`${image}-${index}`}
                          src={image}
                          alt={`CJ product ${index + 1}`}
                          className="h-12 w-12 rounded-md border border-gray-200 object-cover"
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {inspectedFlags.map((flag) => (
                        <span
                          key={`inspected-${flag.label}`}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses(flag.tone)}`}
                        >
                          {flag.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

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
                    <option
                      key={`${variant.external_variant_id || 'default'}-${index}`}
                      value={variant.external_variant_id || ''}
                    >
                      {getVariantOptionLabel(variant, index, productDetails.title)}
                    </option>
                  ))}
                </select>

                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                  placeholder="Woo title"
                />
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                  rows={4}
                  placeholder="Description"
                />
                <input
                  value={price}
                  readOnly
                  className="w-full rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 text-gray-700"
                  placeholder="Final Woo regular price (NGN)"
                />
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Import Buffer (USD)</span>
                    <input
                      value={importBufferUsd}
                      onChange={(event) => setImportBufferUsd(event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3"
                      inputMode="decimal"
                      placeholder="Optional buffer"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Markup %</span>
                    <input
                      value={markupPercent}
                      onChange={(event) => setMarkupPercent(event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3"
                      inputMode="decimal"
                      placeholder="Percent margin"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">Flat Markup (NGN)</span>
                    <input
                      value={markupFlatNgn}
                      onChange={(event) => setMarkupFlatNgn(event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3"
                      inputMode="decimal"
                      placeholder="Flat uplift"
                    />
                  </label>
                </div>
                <input
                  value={sourcingTag}
                  onChange={(event) => setSourcingTag(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                  placeholder="Customer label"
                />

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">Target Vendor</span>
                  <select
                    value={selectedVendorId}
                    onChange={(event) => setSelectedVendorId(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3"
                    disabled={vendors.length === 0}
                  >
                    {vendors.length === 0 ? (
                      <option value="">No active vendors found</option>
                    ) : (
                      vendors.map((vendor) => (
                        <option key={`vendor-visible-${vendor.id}`} value={vendor.id}>
                          {vendor.store_name} � Woo vendor {vendor.woocommerce_vendor_id}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">
                      Woo/WCFM Vendor ID
                    </span>
                    <input
                      value={manualWooVendorId}
                      onChange={(event) => setManualWooVendorId(event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3"
                      placeholder="Optional fallback vendor id"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">
                      Vendor Store Name
                    </span>
                    <input
                      value={manualWooVendorName}
                      onChange={(event) => setManualWooVendorName(event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3"
                      placeholder="Optional store name for auto-created mapping"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">Receiving Hub</span>
                  <select
                    value={selectedHubId}
                    onChange={(event) => setSelectedHubId(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3"
                    disabled={hubs.length === 0}
                  >
                    {hubs.length === 0 ? (
                      <option value="">No active hubs found</option>
                    ) : (
                      hubs.map((hub) => (
                        <option key={`hub-visible-${hub.id}`} value={hub.id}>
                          {hub.name} � {hub.code}
                          {hub.is_default ? ' � Default' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => void quotePricing()}
                  className="btn-secondary inline-flex w-full items-center justify-center gap-2"
                  disabled={pricingLoading || !selectedVariant?.external_variant_id}
                >
                  {pricingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Quote Selected Variant
                </button>

                <p className="text-xs text-gray-500">
                  The quoted variant is used as the pricing anchor. Import will create the parent product and all
                  importable supplier variants with the same landed-pricing rules.
                </p>

                {pricingPreview ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                    <p className="font-semibold text-gray-900">Landed Pricing</p>
                    <p className="mt-2">Supplier price: USD {pricingPreview.supplier_price_usd}</p>
                    <p className="mt-1">Inbound shipping: USD {pricingPreview.inbound_shipping_quote_usd}</p>
                    <p className="mt-1">Import buffer: USD {pricingPreview.import_buffer_usd}</p>
                    <p className="mt-1">Landed cost: USD {pricingPreview.landed_cost_usd}</p>
                    <p className="mt-1">Exchange rate: {pricingPreview.usd_to_ngn_rate_used ?? pricingPreview.exchange_rate}</p>
                    <p className="mt-1">FX source: {formatFxSourceLabel(pricingPreview.usd_to_ngn_rate_source)}</p>
                    <p className="mt-1">FX fetched: {formatDate(pricingPreview.fx_rate_fetched_at)}</p>
                    {pricingPreview.fx_rate_note ? (
                      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        FX note: {pricingPreview.fx_rate_note}
                      </p>
                    ) : null}
                    <p className="mt-1">Final NGN price: ₦{pricingPreview.final_price_ngn}</p>
                    <p className="mt-1 font-medium text-green-700">
                      Estimated profit: ₦
                      {(
                        (Number(pricingPreview.final_price_ngn) || 0) -
                        (Number(pricingPreview.landed_cost_usd) || 0) *
                          (Number(pricingPreview.exchange_rate) || 0)
                      ).toFixed(2)}
                    </p>
                    <p className="mt-1">
                      ETA:{' '}
                      {pricingPreview.estimated_inbound_days_min && pricingPreview.estimated_inbound_days_max
                        ? `${pricingPreview.estimated_inbound_days_min}-${pricingPreview.estimated_inbound_days_max} days`
                        : 'Not provided'}
                    </p>
                    <p className="mt-1">Carrier: {pricingPreview.carrier_name || 'Not provided'}</p>
                  </div>
                ) : null}

                <button type="button" onClick={() => void importProduct()} className="btn-primary inline-flex w-full items-center justify-center gap-2" disabled={importing}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Import Product + Variants
                </button>
                {importing && activeImportJob ? (
                  <p className="text-xs text-gray-500">
                    Import stage: {formatImportJobProgress(activeImportJob)}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {!loadingReferenceData && activeTab === 'source-by-link' ? (
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="card space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Import from Supplier URL</h2>
              <p className="text-sm text-gray-600">
                Paste one AliExpress product URL, ingest it directly, then continue through the
                existing landed-price and Woo import flow.
              </p>
            </div>

            <form onSubmit={submitSourceLink} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">AliExpress Product URL</span>
                <input
                  value={sourceLinkUrl}
                  onChange={(event) => setSourceLinkUrl(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3"
                  placeholder="https://www.aliexpress.com/item/..."
                />
                <span className="mt-2 block text-xs text-gray-500">
                  The page is fetched once, normalized, then sent into the shared Global Sourcing import path.
                </span>
              </label>

              {sourceLinkErrorHint ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-medium">AliExpress fetch fallback needed</p>
                  <p className="mt-1">{sourceLinkErrorHint}</p>
                </div>
              ) : null}

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Paste AliExpress page HTML</p>
                    <p className="mt-1 text-xs text-gray-500">
                      Use this when AliExpress blocks the server fetch. Open the product page in your browser, view page source, copy all HTML, then paste it here.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-2"
                    onClick={() => setShowSourceHtmlFallback((current) => !current)}
                  >
                    {showSourceHtmlFallback ? 'Hide HTML Paste' : 'Use HTML Paste'}
                  </button>
                </div>

                {showSourceHtmlFallback ? (
                  <label className="mt-4 block">
                    <span className="mb-2 block text-sm font-medium text-gray-700">AliExpress Page HTML</span>
                    <textarea
                      value={sourceLinkHtml}
                      onChange={(event) => setSourceLinkHtml(event.target.value)}
                      className="min-h-[220px] w-full rounded-lg border border-gray-300 px-4 py-3 font-mono text-xs"
                      placeholder="<html>...</html>"
                    />
                    <span className="mt-2 block text-xs text-gray-500">
                      JLO will skip the remote fetch and parse this pasted HTML directly.
                    </span>
                  </label>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">Receiving Hub</span>
                  <select
                    value={selectedHubId}
                    onChange={(event) => setSelectedHubId(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3"
                    disabled={hubs.length === 0}
                  >
                    {hubs.length === 0 ? (
                      <option value="">No active hubs found</option>
                    ) : (
                      hubs.map((hub) => (
                        <option key={`source-link-hub-${hub.id}`} value={hub.id}>
                          {hub.name} - {hub.code}
                          {hub.is_default ? ' - Default' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">Target Vendor</span>
                  <select
                    value={selectedVendorId}
                    onChange={(event) => setSelectedVendorId(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3"
                    disabled={vendors.length === 0}
                  >
                    {vendors.length === 0 ? (
                      <option value="">No active vendors found</option>
                    ) : (
                      vendors.map((vendor) => (
                        <option key={`source-link-vendor-${vendor.id}`} value={vendor.id}>
                          {vendor.store_name} - Woo vendor {vendor.woocommerce_vendor_id}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>

              <button
                type="submit"
                className="btn-primary inline-flex w-full items-center justify-center gap-2"
                disabled={submittingSourceLink}
              >
                {submittingSourceLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Ingest Supplier Product
              </button>
            </form>
          </div>

          <div className="card space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">How It Flows</h2>
              <p className="text-sm text-gray-600">
                This keeps the existing pricing preview, Woo import jobs, and hub routing logic in place.
              </p>
            </div>

            <div className="space-y-3 text-sm text-gray-700">
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                1. Paste a single AliExpress product URL.
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                2. JLO fetches the page once and normalizes title, description, images, and variants.
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                3. If AliExpress blocks the server fetch, paste the browser page HTML and retry.
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                4. You review the selected variant and quote landed price using the existing pricing engine.
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                5. Import continues through the same Woo job pipeline already used for CJ products.
              </div>
            </div>
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
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900">{product.name}</p>
                      <p className="mt-1">Woo #{product.woo_product_id} · CJ PID {product.external_product_id || 'n/a'}</p>
                      <p className="mt-1">Vendor: {product.vendor?.store_name || 'Not set'} · Hub: {product.receiving_hub?.name || 'Not set'}</p>
                      <p className="mt-1">Mode: {product.fulfillment_mode || 'Not set'} · Status: {product.status}</p>
                      <p className="mt-1">Updated: {formatDate(product.updated_at)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {buildCjProductUrl(product.name, product.external_product_id) ? (
                        <a
                          href={buildCjProductUrl(product.name, product.external_product_id) || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-secondary inline-flex items-center gap-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Open on CJ
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void deleteImportedProduct(product.woo_product_id, product.name)}
                        disabled={deletingImportedProductId === product.woo_product_id}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingImportedProductId === product.woo_product_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!loadingReferenceData && activeTab === 'inbound-shipments' ? (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Inbound Shipments</h2>
              <p className="text-sm text-gray-600">Supplier to hub movement is separate from last-mile delivery.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'all', label: 'All' },
                { key: 'awaiting_supplier_order', label: 'Awaiting Supplier Order' },
                { key: 'manual_ordered', label: 'Manual Ordered' },
                { key: 'auto_ordered', label: 'Auto Ordered' },
                { key: 'received_at_hub', label: 'Received at Hub' },
              ].map((filterOption) => (
                <button
                  key={filterOption.key}
                  type="button"
                  onClick={() => setShipmentFilter(filterOption.key as ShipmentFilter)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    shipmentFilter === filterOption.key
                      ? 'border-primary-200 bg-primary-50 text-primary-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {filterOption.label}
                </button>
              ))}
              <button type="button" onClick={() => void loadShipments()} className="btn-secondary inline-flex items-center gap-2">
                {loadingShipments ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </button>
            </div>
          </div>

          <form onSubmit={saveManualSupplierOrder} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Manual Supplier Order</h3>
                <p className="text-sm text-gray-600">
                  Select compatible pending CJ inbound rows, place one batched order on CJ, then save the shared order reference here.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
                  Selected: {selectedManualShipmentIds.length}
                </span>
                <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700">
                  Qty: {manualSelectionSummary.valid ? manualSelectionSummary.totalQuantity : 0}
                </span>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-white bg-white p-3 text-sm text-gray-700 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Product</p>
                <p className="mt-1 font-medium text-gray-900">
                  {manualSelectionSummary.valid
                    ? manualSelectionSummary.snapshot?.title || 'CJ product'
                    : 'Select compatible rows'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {manualSelectionSummary.valid
                    ? `CJ PID ${manualSelectionSummary.snapshot?.cjPid || 'n/a'} / CJ VID ${manualSelectionSummary.snapshot?.cjVid || 'n/a'}`
                    : 'Rows must share one CJ product and variant'}
                </p>
              </div>
              <div className="rounded-lg border border-white bg-white p-3 text-sm text-gray-700 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer Orders</p>
                <p className="mt-1 font-medium text-gray-900">
                  {manualSelectionSummary.valid ? manualSelectionSummary.selectedCount : 0} row(s)
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Total supplier quantity: {manualSelectionSummary.valid ? manualSelectionSummary.totalQuantity : 0}
                </p>
              </div>
              <div className="rounded-lg border border-white bg-white p-3 text-sm text-gray-700 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Provider</p>
                <p className="mt-1 font-medium text-gray-900">CJ</p>
                <p className="mt-1 text-xs text-gray-500">Automatic and manual supplier ordering remain available side by side.</p>
              </div>
              <div className="rounded-lg border border-white bg-white p-3 text-sm text-gray-700 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Open CJ</p>
                {manualSelectionSummary.valid && manualSelectionSummary.cjUrl ? (
                  <a
                    href={manualSelectionSummary.cjUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-2 text-sm font-medium text-primary-700 hover:text-primary-800"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open on CJ
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">A CJ product link appears after you select compatible rows.</p>
                )}
              </div>
            </div>

            {!manualSelectionSummary.valid && selectedManualShipmentIds.length > 0 ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {manualSelectionSummary.error}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">CJ Order ID</span>
                <input
                  value={manualSupplierOrderId}
                  onChange={(event) => setManualSupplierOrderId(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
                  placeholder="Enter the manual CJ order reference"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-700">Date Ordered</span>
                <input
                  type="datetime-local"
                  value={manualOrderedAt}
                  onChange={(event) => setManualOrderedAt(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
                />
              </label>
            </div>

            <label className="mt-3 block">
              <span className="mb-2 block text-sm font-medium text-gray-700">Notes</span>
              <textarea
                value={manualSupplierNotes}
                onChange={(event) => setManualSupplierNotes(event.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
                rows={3}
                placeholder="Optional ops note for this batched CJ order"
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={!manualSelectionSummary.valid || savingManualSupplierOrder}
                className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
              >
                {savingManualSupplierOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Save Manual Supplier Order
              </button>
              <button type="button" onClick={resetManualSupplierOrderForm} className="btn-secondary inline-flex items-center gap-2">
                Cancel Selection
              </button>
            </div>
          </form>

          {filteredShipments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
              No inbound shipments found for this filter.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredShipments.map((shipment) => {
                const orderMode = getShipmentSupplierOrderMode(shipment);
                const orderStatus = getShipmentSupplierOrderStatus(shipment);
                const snapshot = getShipmentSnapshot(shipment);
                const openCjUrl = getShipmentOpenCjUrl(shipment);
                const eligibility = getManualShipmentEligibility(shipment);
                const manualOrder = shipment.manual_supplier_orders;
                const isSelected = selectedManualShipmentIds.includes(shipment.id);
                const canUseAutomaticCreate =
                  !shipment.cj_order_id &&
                  orderMode !== 'manual' &&
                  orderStatus === 'awaiting_supplier_order';

                return (
                  <div key={shipment.id} className="rounded-lg border border-gray-200 p-4 text-sm text-gray-700">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-900">
                            {shipment.provider.toUpperCase()} / {shipment.cj_order_id || 'Awaiting CJ order ID'}
                          </p>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                              orderMode === 'manual' ? badgeToneClasses('blue') : badgeToneClasses('gray')
                            }`}
                          >
                            {orderMode === 'manual' ? 'Manual' : 'Automatic'}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                              orderStatus === 'received_at_hub'
                                ? badgeToneClasses('green')
                                : orderStatus === 'awaiting_supplier_order'
                                  ? badgeToneClasses('amber')
                                  : badgeToneClasses('blue')
                            }`}
                          >
                            {formatReadableStatus(orderStatus)}
                          </span>
                        </div>
                        <p>Woo order: {shipment.woo_order_id ? `#${shipment.woo_order_id}` : 'Not linked'}</p>
                        <p>Created: {formatDate(shipment.created_at)}</p>
                        <p>Hub: {shipment.hubs?.name || 'Not linked'} / Sub-order: {shipment.sub_orders?.tracking_number || 'Not linked'}</p>
                        <p>
                          Product: {snapshot.title || 'CJ product'}
                          {snapshot.variationLabel ? ` — ${snapshot.variationLabel}` : ''} / Qty: {snapshot.quantity} / CJ PID{' '}
                          {snapshot.cjPid || 'n/a'} / CJ VID {snapshot.cjVid || 'n/a'}
                          {snapshot.sku ? ` / SKU ${snapshot.sku}` : ''}
                        </p>
                        <p>
                          Inbound status: {formatReadableStatus(shipment.inbound_status)} / Tracking: {shipment.inbound_tracking_number || 'Not set'}
                        </p>
                        <p>CJ tracking status: {shipment.supplier_status || 'Not set'}</p>
                        <p>Carrier: {shipment.carrier_name || 'Not set'}</p>
                        <p>Ordered: {formatDate(shipment.supplier_ordered_at || manualOrder?.ordered_at || null)}</p>
                        <p>ETA: {formatDate(shipment.estimated_arrival_at)} / Received: {formatDate(shipment.received_at_hub_at)}</p>
                        {manualOrder ? (
                          <p>
                            Manual supplier order: {manualOrder.cj_order_id || manualOrder.id} / Status: {formatReadableStatus(manualOrder.status)}
                            {manualOrder.notes ? ` / Notes: ${manualOrder.notes}` : ''}
                          </p>
                        ) : null}
                        {!eligibility.eligible && orderStatus === 'awaiting_supplier_order' ? (
                          <p className="text-xs text-gray-500">Manual grouping unavailable: {eligibility.reason}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-col items-start gap-2 xl:items-end">
                        {openCjUrl ? (
                          <a
                            href={openCjUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary inline-flex items-center gap-2"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open on CJ
                          </a>
                        ) : null}

                        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleManualShipmentSelection(shipment)}
                            disabled={!eligibility.eligible || savingManualSupplierOrder}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          Add to Manual CJ Order
                        </label>

                        {canUseAutomaticCreate ? (
                          <button
                            type="button"
                            onClick={() => void createSupplierOrder(shipment.id)}
                            disabled={shipmentActionId === shipment.id}
                            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
                          >
                            {shipmentActionId === shipment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                            Create Supplier Order
                          </button>
                        ) : null}

                        {shipment.cj_order_id ? (
                          <button
                            type="button"
                            onClick={() => void refreshCjTracking(shipment.id)}
                            disabled={shipmentActionId === shipment.id}
                            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60"
                          >
                            {shipmentActionId === shipment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Refresh CJ Tracking
                          </button>
                        ) : null}

                        {!shipment.cj_order_id && !shipment.manual_supplier_order_id ? (
                          <button
                            type="button"
                            onClick={() =>
                              void deleteInboundTestOrder(
                                shipment.id,
                                shipment.sub_orders?.tracking_number || shipment.woo_order_id || null,
                                Boolean(shipment.cj_order_id || shipment.manual_supplier_order_id)
                              )
                            }
                            disabled={shipmentActionId === shipment.id}
                            className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {shipmentActionId === shipment.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Delete Test Order
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => void markReceived(shipment.id)}
                          disabled={shipment.inbound_status === 'received_at_hub' || shipmentActionId === shipment.id}
                          className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
                        >
                          {shipmentActionId === shipment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                          Mark Received at Hub
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {!loadingReferenceData && activeTab === 'settings' ? (
        <div className="space-y-6">
          <div className="card space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Admin-Only Diagnostics</h2>

            <div className="rounded-lg border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-600">
              Provider health and CJ backend authentication checks now live on the Admin Settings page.
            </div>
          </div>

          <div className="card space-y-4 text-sm text-gray-700">
            <h2 className="text-lg font-semibold text-gray-900">Operational Notes</h2>
            <p>Products remain in WooCommerce. Vendor ownership is resolved from the existing JLO vendors table.</p>
            <p>Inbound shipment state is stored in JLO without changing the existing last-mile delivery enum.</p>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Global Pricing Defaults</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    These values prefill the import form and act as the default pricing rule when you do not override a product manually.
                  </p>
                  {pricingSettings?.updated_at ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Last saved: {formatDate(pricingSettings.updated_at)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void loadPricingSettings()}
                  className="btn-secondary inline-flex items-center gap-2"
                  disabled={loadingPricingSettings}
                >
                  {loadingPricingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">Default Buffer (USD)</span>
                  <input
                    value={importBufferUsd}
                    onChange={(event) => setImportBufferUsd(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3"
                    inputMode="decimal"
                    placeholder="Cover FX swings"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">Default Markup %</span>
                  <input
                    value={markupPercent}
                    onChange={(event) => setMarkupPercent(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3"
                    inputMode="decimal"
                    placeholder="Margin rule"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-gray-700">Default Flat Markup (NGN)</span>
                  <input
                    value={markupFlatNgn}
                    onChange={(event) => setMarkupFlatNgn(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-3"
                    inputMode="decimal"
                    placeholder="Optional uplift"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">FX Rate Control</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Manual override takes precedence over the provider rate. If live FX fetch is disabled, the quote flow falls back to cache, env, or the project default.
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Current provider: exchangerate.host
                  </p>
                  {pricingSettings?.fx?.effective_note ? (
                    <p className="mt-1 text-xs text-amber-700">{pricingSettings.fx.effective_note}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void refreshFxRate()}
                  className="btn-secondary inline-flex items-center gap-2"
                  disabled={refreshingFxRate}
                >
                  {refreshingFxRate ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Fetch latest live rate
                </button>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <div className="flex items-start gap-3">
                      <input
                        id="fx-manual-override"
                        type="checkbox"
                        checked={fxManualOverrideEnabled}
                        onChange={(event) => setFxManualOverrideEnabled(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <label htmlFor="fx-manual-override" className="block">
                        <span className="block text-sm font-medium text-gray-900">Enable manual USD → NGN override</span>
                        <span className="mt-1 block text-xs text-gray-500">
                          Use this when operational pricing should follow a business rate instead of the live market rate.
                        </span>
                      </label>
                    </div>
                    <div className="mt-4">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-gray-700">Manual USD → NGN rate</span>
                        <input
                          value={fxManualRate}
                          onChange={(event) => setFxManualRate(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-4 py-3"
                          inputMode="decimal"
                          placeholder="Enter override rate"
                          required={fxManualOverrideEnabled}
                        />
                      </label>
                    </div>
                    <div className="mt-4">
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-gray-700">Override note</span>
                        <textarea
                          value={fxManualRateNote}
                          onChange={(event) => setFxManualRateNote(event.target.value)}
                          className="min-h-[92px] w-full rounded-lg border border-gray-300 px-4 py-3"
                          placeholder="Parallel market rate / bank rate / emergency pricing override"
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex items-start gap-3">
                      <input
                        id="fx-live-api-enabled"
                        type="checkbox"
                        checked={fxLiveApiEnabled}
                        onChange={(event) => setFxLiveApiEnabled(event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <label htmlFor="fx-live-api-enabled" className="block">
                        <span className="block text-sm font-medium text-gray-900">Enable live FX fetch</span>
                        <span className="mt-1 block text-xs text-gray-500">
                          Disable this to keep the system in manual-only or cached-only mode.
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-900">Live rate</p>
                    <div className="mt-2 space-y-1 text-sm text-gray-700">
                      <p>Last fetched rate: {pricingSettings?.fx?.last_fetched_rate ?? 'Not fetched yet'}</p>
                      <p>Last fetched time: {formatDate(pricingSettings?.fx?.last_fetched_at)}</p>
                      <p>Cache expiry: {formatDate(pricingSettings?.fx?.cache_expires_at)}</p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-900">Effective rate</p>
                    <div className="mt-2 space-y-1 text-sm text-gray-700">
                      <p>Current effective rate: {effectiveFxRate ?? 'Not set'}</p>
                      <p>Source: {formatFxSourceLabel(effectiveFxSource)}</p>
                      <p>Effective fetched at: {formatDate(pricingSettings?.fx?.effective_fetched_at)}</p>
                    </div>
                  </div>

                  {fxManualOverrideEnabled ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      Manual override is enabled, so it takes precedence over cached and live FX rates.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void savePricingSettings()}
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={savingPricingSettings}
                >
                  {savingPricingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Save Settings
                </button>
                <button
                  type="button"
                  onClick={() => pricingSettings && applyPricingDefaultsToForm(pricingSettings, true)}
                  className="btn-secondary inline-flex items-center gap-2"
                  disabled={!pricingSettings}
                >
                  Use Saved Defaults
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <div className="flex gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <p>
                  Landed pricing now includes CJ freight-to-hub quoting, and sourced sub-orders can place
                  supplier orders into CJ automatically. Final-mile delivery still stays in JLO.
                </p>
              </div>
            </div>
          </div>

          {/* ── Price Sync Log ─────────────────────────────────────── */}
          <div className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-gray-500" />
                <h2 className="text-lg font-semibold text-gray-900">Price Sync Log</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadFxSyncStatus()}
                  disabled={loadingFxSyncStatus}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  {loadingFxSyncStatus
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => void runManualSync()}
                  disabled={runningManualSync}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  {runningManualSync
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Play className="h-4 w-4" />}
                  {runningManualSync ? 'Syncing…' : 'Run Sync Now'}
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600">
              Prices auto-update when the USD/NGN rate moves ≥ 3% or weekly. Use "Run Sync Now" to force an immediate reprice.
            </p>

            {fxSyncStatus && (
              <div className="flex flex-wrap gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                <div>
                  <span className="text-gray-500">Last sync rate:</span>{' '}
                  <span className="font-semibold text-gray-900">
                    {fxSyncStatus.last_sync_rate != null ? `₦${Number(fxSyncStatus.last_sync_rate).toLocaleString()}` : 'Never run'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Last run:</span>{' '}
                  <span className="font-semibold text-gray-900">{formatDate(fxSyncStatus.last_sync_at)}</span>
                </div>
              </div>
            )}

            {loadingFxSyncStatus && !fxSyncStatus ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : fxSyncStatus?.logs && fxSyncStatus.logs.length > 0 ? (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                        <th className="pb-2 pr-4">Date / Time</th>
                        <th className="pb-2 pr-4">Trigger</th>
                        <th className="pb-2 pr-4">Rate Used</th>
                        <th className="pb-2 pr-4">Change</th>
                        <th className="pb-2 pr-4">Products</th>
                        <th className="pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {fxSyncStatus.logs.map((entry) => {
                        const total = entry.updated_simple + entry.updated_variations;
                        const hasErrors = entry.errors && entry.errors.length > 0;
                        return (
                          <tr key={entry.id} className="text-gray-700">
                            <td className="py-2.5 pr-4 text-xs text-gray-500 whitespace-nowrap">
                              {formatDate(entry.created_at)}
                            </td>
                            <td className="py-2.5 pr-4 whitespace-nowrap">
                              <span className="inline-flex items-center rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                                {formatSyncReason(entry.reason)}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 font-medium whitespace-nowrap">
                              ₦{Number(entry.rate_used).toLocaleString()}
                            </td>
                            <td className="py-2.5 pr-4 whitespace-nowrap">
                              {entry.change_pct != null
                                ? <span className={entry.change_pct >= 3 ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                                    {entry.change_pct > 0 ? '+' : ''}{entry.change_pct.toFixed(2)}%
                                  </span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="py-2.5 pr-4 whitespace-nowrap">
                              <span className="font-semibold">{total}</span>
                              <span className="ml-1 text-xs text-gray-400">
                                ({entry.updated_simple}S / {entry.updated_variations}V)
                              </span>
                            </td>
                            <td className="py-2.5 whitespace-nowrap">
                              {hasErrors
                                ? <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                    <AlertCircle className="h-3.5 w-3.5" /> Errors
                                  </span>
                                : <span className="inline-flex items-center gap-1 text-xs text-green-600">
                                    <CheckCircle className="h-3.5 w-3.5" /> OK
                                  </span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="space-y-2 sm:hidden">
                  {fxSyncStatus.logs.map((entry) => {
                    const total = entry.updated_simple + entry.updated_variations;
                    const hasErrors = entry.errors && entry.errors.length > 0;
                    return (
                      <div key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                              {formatSyncReason(entry.reason)}
                            </span>
                            <p className="mt-1 text-xs text-gray-500">{formatDate(entry.created_at)}</p>
                          </div>
                          {hasErrors
                            ? <span className="inline-flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3.5 w-3.5" /> Errors</span>
                            : <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle className="h-3.5 w-3.5" /> OK</span>}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
                          <span><span className="text-gray-500">Rate:</span> ₦{Number(entry.rate_used).toLocaleString()}</span>
                          {entry.change_pct != null && (
                            <span><span className="text-gray-500">Δ:</span> {entry.change_pct > 0 ? '+' : ''}{entry.change_pct.toFixed(2)}%</span>
                          )}
                          <span><span className="text-gray-500">Updated:</span> <strong>{total}</strong> ({entry.updated_simple}S / {entry.updated_variations}V)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : !loadingFxSyncStatus ? (
              <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
                No sync runs yet. Prices will auto-update the next time the rate moves ≥ 3% or the weekly cron fires.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}



