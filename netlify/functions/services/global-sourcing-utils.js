import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';
const VERIFY_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_KEY ||
  SERVICE_ROLE_KEY ||
  '';

const authClient =
  SUPABASE_URL && VERIFY_KEY ? createClient(SUPABASE_URL, VERIFY_KEY) : null;
const adminClient =
  SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

export const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
};

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asFiniteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function parseJsonBody(rawBody) {
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

export function sanitizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

export function normalizeWooBaseUrl(url) {
  const trimmed = sanitizeBaseUrl(url);
  if (!trimmed) return '';
  if (trimmed.includes('/wp-json/')) return trimmed;
  return `${trimmed}/wp-json/wc/v3`;
}

export function getWooConfig() {
  const baseUrl = normalizeWooBaseUrl(
    process.env.WOO_BASE_URL || process.env.WOOCOMMERCE_URL || ''
  );
  const consumerKey =
    process.env.WOO_CONSUMER_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY || '';
  const consumerSecret =
    process.env.WOO_CONSUMER_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET || '';

  if (!baseUrl || !consumerKey || !consumerSecret) {
    throw new Error('WooCommerce credentials are not fully configured');
  }

  const authHeader = `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')}`;
  return { baseUrl, authHeader };
}

export async function requestWoo(path, init = {}) {
  const { baseUrl, authHeader } = getWooConfig();
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }

  if (!response.ok) {
    const message =
      body?.message ||
      body?.error ||
      body?.raw ||
      `WooCommerce request failed (${response.status})`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.responseBody = body;
    throw error;
  }

  return body;
}

export async function requireAdmin(event, roles = ['admin']) {
  if (!authClient || !adminClient || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return {
      errorResponse: jsonResponse(500, {
        success: false,
        error: 'Server not configured',
        message: 'Supabase credentials are missing for Global Sourcing',
      }),
    };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      errorResponse: jsonResponse(401, {
        success: false,
        error: 'unauthorized',
        message: 'Missing bearer token',
      }),
    };
  }

  const token = authHeader.slice('Bearer '.length);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user) {
    return {
      errorResponse: jsonResponse(401, {
        success: false,
        error: 'unauthorized',
        message: 'Invalid or expired token',
      }),
    };
  }

  const { data: profile, error: profileError } = await adminClient
    .from('users')
    .select('id, email, role, is_active')
    .eq('id', authData.user.id)
    .single();

  if (profileError || !profile?.is_active) {
    return {
      errorResponse: jsonResponse(403, {
        success: false,
        error: 'forbidden',
        message: 'User profile not found or inactive',
      }),
    };
  }

  if (!roles.includes(profile.role)) {
    return {
      errorResponse: jsonResponse(403, {
        success: false,
        error: 'forbidden',
        message: 'Insufficient permissions',
      }),
    };
  }

  return {
    authUser: authData.user,
    profile,
    adminClient,
  };
}

export function extractMetaValue(metaData, keys) {
  if (!Array.isArray(metaData)) return null;

  for (const key of keys) {
    const hit = metaData.find((entry) => entry?.key === key);
    if (hit?.value !== undefined && hit?.value !== null && hit?.value !== '') {
      return hit.value;
    }
  }

  return null;
}

export function upsertMetaValue(metaData, key, value) {
  if (value === undefined) return Array.isArray(metaData) ? [...metaData] : [];

  const next = Array.isArray(metaData) ? [...metaData] : [];
  const index = next.findIndex((entry) => entry?.key === key);
  const payload = { key, value };

  if (index >= 0) {
    next[index] = payload;
  } else {
    next.push(payload);
  }

  return next;
}

export function applyMetaUpdates(metaData, updates) {
  let next = Array.isArray(metaData) ? [...metaData] : [];
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      next = upsertMetaValue(next, key, value);
    }
  });
  return next;
}

function collapseWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function dedupeDelimitedSegments(value) {
  const segments = String(value || '')
    .split(/\s*[\-|,/]+\s*/g)
    .map((segment) => collapseWhitespace(segment))
    .filter(Boolean);

  const seen = new Set();
  const next = [];
  for (const segment of segments) {
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(segment);
  }

  return next.join(' - ');
}

function dedupeAdjacentWords(value) {
  const tokens = collapseWhitespace(value).split(' ').filter(Boolean);
  const next = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    const previous = next[next.length - 1]?.toLowerCase();
    if (previous === normalized) continue;
    next.push(token);
  }
  return next.join(' ');
}

export function normalizeProductTitle(value) {
  const trimmed = collapseWhitespace(value);
  const withoutEdgeDecorators = trimmed.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9)]+$/g, '');
  const dedupedSegments = dedupeDelimitedSegments(withoutEdgeDecorators);
  const dedupedWords = dedupeAdjacentWords(dedupedSegments);
  return dedupedWords.slice(0, 180).trim();
}

export function normalizeProductDescription(value, title = '') {
  const raw = String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n');

  const titleKey = collapseWhitespace(title).toLowerCase();
  const lines = raw
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .map((line) => line.replace(/^[-*•]+\s*/, ''))
    .filter(Boolean);

  const seen = new Set();
  const next = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (titleKey && key === titleKey) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(line);
  }

  return next.join('\n').slice(0, 5000).trim();
}

export function normalizeAttributeName(value) {
  const cleaned = collapseWhitespace(value).replace(/^pa_/i, '').replace(/^attribute_/i, '');
  return cleaned
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeAttributeOption(value) {
  return collapseWhitespace(value);
}

export function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return Array.from(
    new Set(
      images
        .map((entry) => {
          if (typeof entry === 'string') return entry.trim();
          if (isPlainObject(entry) && typeof entry.src === 'string') return entry.src.trim();
          if (isPlainObject(entry) && typeof entry.url === 'string') return entry.url.trim();
          return '';
        })
        .filter(Boolean)
    )
  );
}

export function getGlobalSourcingPricingConfig() {
  return {
    usdToNgnRate:
      asFiniteNumber(process.env.GLOBAL_SOURCING_USD_TO_NGN_RATE) ||
      asFiniteNumber(process.env.USD_TO_NGN_RATE) ||
      1650,
    importBufferUsd:
      asFiniteNumber(process.env.GLOBAL_SOURCING_IMPORT_BUFFER_USD) ||
      asFiniteNumber(process.env.GLOBAL_SOURCING_IMPORT_BUFFER) ||
      0,
    markupPercent:
      asFiniteNumber(process.env.GLOBAL_SOURCING_MARKUP_PERCENT) ||
      asFiniteNumber(process.env.GLOBAL_SOURCING_MARKUP_RATE_PERCENT) ||
      0,
    markupFlatNgn:
      asFiniteNumber(process.env.GLOBAL_SOURCING_MARKUP_FLAT_NGN) ||
      asFiniteNumber(process.env.GLOBAL_SOURCING_MARKUP_NGN) ||
      0,
  };
}

export function computeWooNgnPricing({
  sourcePrice,
  sourceCurrency = 'USD',
  inboundShippingUsd = 0,
  importBufferUsd,
  explicitRegularPrice,
  explicitSalePrice,
}) {
  const parsedSourcePrice = asFiniteNumber(sourcePrice);
  if (parsedSourcePrice === null) {
    throw new Error('A valid supplier/source price is required for import');
  }

  const normalizedCurrency = String(sourceCurrency || 'USD').trim().toUpperCase();
  const pricingConfig = getGlobalSourcingPricingConfig();
  const normalizedInboundShippingUsd = asFiniteNumber(inboundShippingUsd) || 0;
  const normalizedImportBufferUsd =
    asFiniteNumber(importBufferUsd) ?? pricingConfig.importBufferUsd;

  let supplierPriceUsd;
  if (normalizedCurrency === 'USD') {
    supplierPriceUsd = parsedSourcePrice;
  } else if (normalizedCurrency === 'NGN') {
    supplierPriceUsd = parsedSourcePrice / pricingConfig.usdToNgnRate;
  } else {
    throw new Error(`Unsupported supplier currency for landed pricing: ${normalizedCurrency}`);
  }

  const landedCostUsd =
    supplierPriceUsd + normalizedInboundShippingUsd + normalizedImportBufferUsd;
  const baseNgn = landedCostUsd * pricingConfig.usdToNgnRate;
  const landedCostNgn = baseNgn + pricingConfig.markupFlatNgn;
  const markedUpNgn = landedCostNgn * (1 + pricingConfig.markupPercent / 100);
  const regularPriceNgn = asFiniteNumber(explicitRegularPrice) ?? markedUpNgn;
  const salePriceNgn = asFiniteNumber(explicitSalePrice);

  return {
    sourcePrice: parsedSourcePrice,
    sourceCurrency: normalizedCurrency,
    supplierPriceUsd,
    inboundShippingUsd: normalizedInboundShippingUsd,
    importBufferUsd: normalizedImportBufferUsd,
    landedCostUsd,
    exchangeRate: pricingConfig.usdToNgnRate,
    markupPercent: pricingConfig.markupPercent,
    markupFlatNgn: pricingConfig.markupFlatNgn,
    landedCostNgn,
    regularPriceNgn,
    salePriceNgn,
    regularPriceWoo: regularPriceNgn.toFixed(2),
    salePriceWoo: salePriceNgn !== null ? salePriceNgn.toFixed(2) : null,
  };
}

export function buildGlobalSourcingMeta({
  provider = 'cj',
  cjPid = null,
  cjVid = null,
  fulfillmentMode = 'cj_hub',
  receivingHubId = null,
  sourcingTag = 'Ships from Abroad',
  originCountry = 'CN',
  shipsFromAbroad = 'yes',
  estimatedInboundDaysMin,
  estimatedInboundDaysMax,
  landedCostSnapshot,
  supplierPriceSnapshot,
  exchangeRateSnapshot,
  salePriceSnapshot,
  inboundShippingSnapshotUsd,
  landedCostSnapshotUsd,
  supplierPriceSnapshotUsd,
  usdToNgnRateSnapshot,
  finalPriceSnapshotNgn,
  pricingMode,
  vendorId,
  woocommerceVendorId,
}) {
  return {
    _global_sourcing_provider: provider,
    _cj_pid: cjPid,
    _cj_vid: cjVid,
    _fulfillment_mode: fulfillmentMode,
    _receiving_hub_id: receivingHubId,
    _origin_country: originCountry,
    _ships_from_abroad: shipsFromAbroad,
    _global_sourcing_tag: sourcingTag,
    ...(estimatedInboundDaysMin !== undefined
      ? { _estimated_inbound_days_min: String(estimatedInboundDaysMin) }
      : {}),
    ...(estimatedInboundDaysMax !== undefined
      ? { _estimated_inbound_days_max: String(estimatedInboundDaysMax) }
      : {}),
    ...(landedCostSnapshot !== undefined
      ? { _landed_cost_snapshot: String(landedCostSnapshot) }
      : {}),
    ...(supplierPriceSnapshot !== undefined
      ? { _supplier_price_snapshot: String(supplierPriceSnapshot) }
      : {}),
    ...(exchangeRateSnapshot !== undefined
      ? { _exchange_rate_snapshot: String(exchangeRateSnapshot) }
      : {}),
    ...(salePriceSnapshot !== undefined
      ? { _sale_price_snapshot: String(salePriceSnapshot) }
      : {}),
    ...(supplierPriceSnapshotUsd !== undefined
      ? { _supplier_price_snapshot_usd: String(supplierPriceSnapshotUsd) }
      : {}),
    ...(inboundShippingSnapshotUsd !== undefined
      ? { _inbound_shipping_snapshot_usd: String(inboundShippingSnapshotUsd) }
      : {}),
    ...(landedCostSnapshotUsd !== undefined
      ? { _landed_cost_snapshot_usd: String(landedCostSnapshotUsd) }
      : {}),
    ...(usdToNgnRateSnapshot !== undefined
      ? { _usd_to_ngn_rate_snapshot: String(usdToNgnRateSnapshot) }
      : {}),
    ...(finalPriceSnapshotNgn !== undefined
      ? { _final_price_snapshot_ngn: String(finalPriceSnapshotNgn) }
      : {}),
    ...(pricingMode !== undefined
      ? { _global_sourcing_pricing_mode: String(pricingMode) }
      : {}),
    ...(vendorId ? { _jlo_vendor_id: vendorId, vendor_id: vendorId, _vendor_id: vendorId } : {}),
    ...(woocommerceVendorId
      ? {
          _woocommerce_vendor_id: String(woocommerceVendorId),
          _wcfm_vendor_id: String(woocommerceVendorId),
          wcfm_vendor_id: String(woocommerceVendorId),
        }
      : {}),
  };
}

export function mergeGlobalSourcingMetadata(existingMetadata, patch) {
  const base = isPlainObject(existingMetadata) ? existingMetadata : {};
  const existingGlobal = isPlainObject(base.global_sourcing) ? base.global_sourcing : {};
  const incomingGlobal = isPlainObject(patch?.global_sourcing) ? patch.global_sourcing : {};

  return {
    ...base,
    ...patch,
    global_sourcing: {
      ...existingGlobal,
      ...incomingGlobal,
    },
  };
}

export function extractGlobalSourcingFromMeta(metaData) {
  const provider = extractMetaValue(metaData, [
    '_global_sourcing_provider',
    'global_sourcing_provider',
  ]);
  const fulfillmentMode = extractMetaValue(metaData, ['_fulfillment_mode', 'fulfillment_mode']);
  const cjPid = extractMetaValue(metaData, ['_cj_pid', 'cj_pid']);
  const cjVid = extractMetaValue(metaData, ['_cj_vid', 'cj_vid']);
  const receivingHubId = extractMetaValue(metaData, [
    '_receiving_hub_id',
    'receiving_hub_id',
  ]);
  const sourcingTag = extractMetaValue(metaData, ['_global_sourcing_tag', 'global_sourcing_tag']);
  const vendorId = extractMetaValue(metaData, ['vendor_id', '_vendor_id', '_jlo_vendor_id']);
  const woocommerceVendorId = extractMetaValue(metaData, [
    '_woocommerce_vendor_id',
    '_wcfm_vendor_id',
    'wcfm_vendor_id',
  ]);
  const shipsFromAbroad = extractMetaValue(metaData, ['_ships_from_abroad', 'ships_from_abroad']);

  const isCjHub = fulfillmentMode === 'cj_hub';
  const isSupportedProvider = !provider || String(provider).toLowerCase() === 'cj';
  const hasCoreSourcingFields = Boolean(receivingHubId && (cjPid || cjVid || shipsFromAbroad === 'yes'));

  if (!isCjHub || !isSupportedProvider || !hasCoreSourcingFields) return null;

  return {
    provider: provider || 'cj',
    fulfillmentMode,
    cjPid: cjPid || null,
    cjVid: cjVid || null,
    receivingHubId: receivingHubId || null,
    sourcingTag: sourcingTag || 'Ships from Abroad',
    vendorId: vendorId || null,
    woocommerceVendorId: woocommerceVendorId || null,
  };
}

const productSourcingCache = new Map();

export async function fetchWooProductSourcingContext({ productId, variationId }) {
  if (!productId) return null;

  const cacheKey = `${productId}:${variationId || ''}`;
  if (productSourcingCache.has(cacheKey)) {
    return productSourcingCache.get(cacheKey);
  }

  try {
    let variation = null;
    if (variationId) {
      variation = await requestWoo(`/products/${productId}/variations/${variationId}`);
    }

    const product = await requestWoo(`/products/${productId}`);
    const variationMeta = extractGlobalSourcingFromMeta(variation?.meta_data);
    const productMeta = extractGlobalSourcingFromMeta(product?.meta_data);
    const merged = {
      ...(productMeta || {}),
      ...(variationMeta || {}),
    };

    const value = Object.keys(merged).length > 0 ? merged : null;
    productSourcingCache.set(cacheKey, value);
    return value;
  } catch (error) {
    console.warn('Unable to fetch Woo product sourcing context', {
      productId,
      variationId,
      message: error?.message,
    });
    productSourcingCache.set(cacheKey, null);
    return null;
  }
}

export async function resolveVendorMapping(client, targetVendorId) {
  if (!targetVendorId) {
    throw new Error('target_vendor_mapping.vendor_id is required');
  }

  const { data: vendor, error } = await client
    .from('vendors')
    .select('id, store_name, store_slug, woocommerce_vendor_id, hub_id, is_active')
    .eq('id', targetVendorId)
    .single();

  if (error || !vendor?.is_active) {
    throw new Error('Target vendor mapping is missing or inactive');
  }

  if (!vendor.woocommerce_vendor_id) {
    throw new Error('Target vendor mapping is missing woocommerce_vendor_id');
  }

  return vendor;
}
