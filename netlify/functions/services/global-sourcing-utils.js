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

function buildWordPressMediaUrl(wooBaseUrl) {
  const sanitized = sanitizeBaseUrl(wooBaseUrl);
  const wpJsonIndex = sanitized.toLowerCase().indexOf('/wp-json/');
  if (wpJsonIndex >= 0) {
    return `${sanitized.slice(0, wpJsonIndex)}/wp-json/wp/v2/media`;
  }
  return `${sanitized}/wp-json/wp/v2/media`;
}

async function readResponseBody(response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { raw };
  }
}

function sanitizeFilenamePart(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'image';
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  switch (normalized) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/avif':
      return 'avif';
    case 'image/bmp':
      return 'bmp';
    case 'image/tiff':
      return 'tif';
    default:
      return '';
  }
}

function extractExtensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

function buildMediaFilename(remoteUrl, filenameBase, contentType) {
  const extension =
    extensionFromContentType(contentType) || extractExtensionFromUrl(remoteUrl) || 'jpg';
  return `${sanitizeFilenamePart(filenameBase)}.${extension}`;
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

  const body = await readResponseBody(response);

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

export async function uploadRemoteImageToWordPress(remoteUrl, options = {}) {
  const sourceUrl = String(remoteUrl || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error('Image source must be an absolute http(s) URL');
  }

  const remoteResponse = await fetch(sourceUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'JulineMart-Global-Sourcing/1.0',
      Accept: 'image/*,*/*;q=0.8',
    },
  });

  if (!remoteResponse.ok) {
    throw new Error(`Remote image download failed (${remoteResponse.status})`);
  }

  const contentType = String(remoteResponse.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  if (/^(text\/html|text\/plain|application\/json)\b/i.test(contentType)) {
    throw new Error(`Remote image returned unsupported content type ${contentType}`);
  }

  const bytes = Buffer.from(await remoteResponse.arrayBuffer());
  if (!bytes.length) {
    throw new Error('Remote image download returned an empty file');
  }

  const { baseUrl, authHeader } = getWooConfig();
  const filename = buildMediaFilename(sourceUrl, options.filenameBase, contentType);
  const uploadResponse = await fetch(buildWordPressMediaUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: bytes,
  });

  const body = await readResponseBody(uploadResponse);
  if (!uploadResponse.ok) {
    const message =
      body?.message ||
      body?.error ||
      body?.raw ||
      `WordPress media upload failed (${uploadResponse.status})`;
    const error = new Error(message);
    error.statusCode = uploadResponse.status;
    error.responseBody = body;
    throw error;
  }

  return {
    id: body?.id ? String(body.id) : null,
    source_url: body?.source_url || body?.guid?.rendered || null,
    filename,
    raw: body,
  };
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

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function dedupeDelimitedSegments(value) {
  const segments = String(value || '')
    .split(/\s*[-|,/]+\s*/g)
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

function slugifyStoreName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function normalizeProductDescription(value, title = '') {
  const raw = decodeHtmlEntities(
    String(value || '')
      .replace(/<img[^>]*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
      .replace(/<\/?(b|strong)[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '\n')
  );

  const titleKey = collapseWhitespace(title).toLowerCase();
  const lines = raw
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .map((line) => line.replace(/^[-*\u2022]+\s*/, '- '))
    .map((line) => line.replace(/\s*:\s*/g, ': '))
    .filter(Boolean);

  const seen = new Set();
  const next = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (titleKey && key === titleKey) continue;
    if (
      key === 'product information:' ||
      key === 'product information' ||
      key === 'size information:' ||
      key === 'size information' ||
      key === 'packing list:' ||
      key === 'packing list'
    ) {
      continue;
    }
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

export async function loadGlobalSourcingPricingDefaults(client, provider = 'cj') {
  const envDefaults = getGlobalSourcingPricingConfig();

  if (!client) {
    return {
      provider,
      saved: false,
      updated_at: null,
      values: {
        import_buffer_usd: envDefaults.importBufferUsd,
        markup_percent: envDefaults.markupPercent,
        markup_flat_ngn: envDefaults.markupFlatNgn,
        usd_to_ngn_rate: envDefaults.usdToNgnRate,
      },
    };
  }

  try {
    const { data, error } = await client
      .from('global_sourcing_settings')
      .select(
        'provider, default_import_buffer_usd, default_markup_percent, default_markup_flat_ngn, default_usd_to_ngn_rate, updated_at'
      )
      .eq('provider', provider)
      .maybeSingle();

    if (error) {
      if (/global_sourcing_settings/i.test(String(error.message || ''))) {
        return {
          provider,
          saved: false,
          updated_at: null,
          values: {
            import_buffer_usd: envDefaults.importBufferUsd,
            markup_percent: envDefaults.markupPercent,
            markup_flat_ngn: envDefaults.markupFlatNgn,
            usd_to_ngn_rate: envDefaults.usdToNgnRate,
          },
        };
      }

      throw error;
    }

    return {
      provider,
      saved: Boolean(data),
      updated_at: data?.updated_at || null,
      values: {
        import_buffer_usd:
          asFiniteNumber(data?.default_import_buffer_usd) ?? envDefaults.importBufferUsd,
        markup_percent:
          asFiniteNumber(data?.default_markup_percent) ?? envDefaults.markupPercent,
        markup_flat_ngn:
          asFiniteNumber(data?.default_markup_flat_ngn) ?? envDefaults.markupFlatNgn,
        usd_to_ngn_rate:
          asFiniteNumber(data?.default_usd_to_ngn_rate) ?? envDefaults.usdToNgnRate,
      },
    };
  } catch {
    return {
      provider,
      saved: false,
      updated_at: null,
      values: {
        import_buffer_usd: envDefaults.importBufferUsd,
        markup_percent: envDefaults.markupPercent,
        markup_flat_ngn: envDefaults.markupFlatNgn,
        usd_to_ngn_rate: envDefaults.usdToNgnRate,
      },
    };
  }
}

export function computeWooNgnPricing({
  sourcePrice,
  sourceCurrency = 'USD',
  inboundShippingUsd = 0,
  importBufferUsd,
  usdToNgnRate,
  markupPercent,
  markupFlatNgn,
  explicitRegularPrice,
  explicitSalePrice,
}) {
  const parsedSourcePrice = asFiniteNumber(sourcePrice);
  if (parsedSourcePrice === null) {
    throw new Error('A valid supplier/source price is required for import');
  }

  const normalizedCurrency = String(sourceCurrency || 'USD').trim().toUpperCase();
  const pricingConfig = getGlobalSourcingPricingConfig();
  const exchangeRate = asFiniteNumber(usdToNgnRate) ?? pricingConfig.usdToNgnRate;
  const normalizedInboundShippingUsd = asFiniteNumber(inboundShippingUsd) || 0;
  const normalizedImportBufferUsd =
    asFiniteNumber(importBufferUsd) ?? pricingConfig.importBufferUsd;
  const normalizedMarkupPercent =
    asFiniteNumber(markupPercent) ?? pricingConfig.markupPercent;
  const normalizedMarkupFlatNgn =
    asFiniteNumber(markupFlatNgn) ?? pricingConfig.markupFlatNgn;

  let supplierPriceUsd;
  if (normalizedCurrency === 'USD') {
    supplierPriceUsd = parsedSourcePrice;
  } else if (normalizedCurrency === 'NGN') {
    supplierPriceUsd = parsedSourcePrice / exchangeRate;
  } else {
    throw new Error(`Unsupported supplier currency for landed pricing: ${normalizedCurrency}`);
  }

  const landedCostUsd =
    supplierPriceUsd + normalizedInboundShippingUsd + normalizedImportBufferUsd;
  const baseNgn = landedCostUsd * exchangeRate;
  const landedCostNgn = baseNgn + normalizedMarkupFlatNgn;
  const markedUpNgn = landedCostNgn * (1 + normalizedMarkupPercent / 100);
  const regularPriceNgn = asFiniteNumber(explicitRegularPrice) ?? markedUpNgn;
  const salePriceNgn = asFiniteNumber(explicitSalePrice);

  return {
    sourcePrice: parsedSourcePrice,
    sourceCurrency: normalizedCurrency,
    supplierPriceUsd,
    inboundShippingUsd: normalizedInboundShippingUsd,
    importBufferUsd: normalizedImportBufferUsd,
    landedCostUsd,
    exchangeRate,
    markupPercent: normalizedMarkupPercent,
    markupFlatNgn: normalizedMarkupFlatNgn,
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

export async function resolveVendorMapping(client, targetVendorId, targetVendorMapping = {}) {
  const normalizedTargetVendorId = String(targetVendorId || '').trim();
  const normalizedWooVendorId = String(
    targetVendorMapping?.woocommerce_vendor_id ||
      targetVendorMapping?.woo_vendor_id ||
      targetVendorMapping?.wcfm_vendor_id ||
      ''
  ).trim();

  if (normalizedTargetVendorId) {
    const { data: vendor, error } = await client
      .from('vendors')
      .select('id, store_name, store_slug, woocommerce_vendor_id, hub_id, is_active, email')
      .eq('id', normalizedTargetVendorId)
      .single();

    if (error || !vendor?.is_active) {
      throw new Error('Target vendor mapping is missing or inactive');
    }

    if (!vendor.woocommerce_vendor_id) {
      throw new Error('Target vendor mapping is missing woocommerce_vendor_id');
    }

    return vendor;
  }

  if (!normalizedWooVendorId) {
    throw new Error(
      'target_vendor_mapping.vendor_id or target_vendor_mapping.woocommerce_vendor_id is required'
    );
  }

  const { data: existingVendor } = await client
    .from('vendors')
    .select('id, store_name, store_slug, woocommerce_vendor_id, hub_id, is_active, email')
    .eq('woocommerce_vendor_id', normalizedWooVendorId)
    .maybeSingle();

  if (existingVendor?.id) {
    return existingVendor;
  }

  const storeName =
    String(targetVendorMapping?.store_name || '').trim() || `Woo Vendor ${normalizedWooVendorId}`;
  const storeSlug =
    String(targetVendorMapping?.store_slug || '').trim() ||
    slugifyStoreName(storeName) ||
    `woo-vendor-${normalizedWooVendorId}`;
  const email =
    String(targetVendorMapping?.email || '').trim() ||
    `vendor-${normalizedWooVendorId}@wcfm.local`;
  const hubId = String(targetVendorMapping?.hub_id || '').trim() || null;

  const { data: insertedVendor, error: insertError } = await client
    .from('vendors')
    .insert({
      store_name: storeName,
      store_slug: storeSlug,
      email,
      hub_id: hubId,
      is_active: true,
      woocommerce_vendor_id: normalizedWooVendorId,
      metadata: {
        source: 'global_sourcing',
        auto_created_from: 'woocommerce_vendor_id',
      },
    })
    .select('id, store_name, store_slug, woocommerce_vendor_id, hub_id, is_active, email')
    .single();

  if (insertError || !insertedVendor?.id) {
    throw new Error(
      insertError?.message ||
        'Unable to create a JLO vendor mapping from the provided Woo/WCFM vendor id'
    );
  }

  return insertedVendor;
}

