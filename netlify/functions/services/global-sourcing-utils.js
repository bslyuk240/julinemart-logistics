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

/** Service-role Supabase client — bypasses RLS. Use for public catalog reads. */
export { adminClient };

export const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

/** manager = scoped JLO role with full catalog API access (no catalog_access flag) */
export const GLOBAL_SOURCING_ALLOWED_ROLES = ['admin', 'agent', 'shop_manager', 'manager'];

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

function buildWordPressRootUrl(wooBaseUrl) {
  const sanitized = sanitizeBaseUrl(wooBaseUrl);
  const wpJsonIndex = sanitized.toLowerCase().indexOf('/wp-json/');
  if (wpJsonIndex >= 0) {
    return `${sanitized.slice(0, wpJsonIndex)}/wp-json/wp/v2`;
  }
  return `${sanitized}/wp-json/wp/v2`;
}

function getWordPressAuthConfig() {
  const { baseUrl, authHeader: wooAuthHeader } = getWooConfig();
  const mediaUsername =
    process.env.WP_MEDIA_USERNAME ||
    process.env.WORDPRESS_MEDIA_USERNAME ||
    process.env.WORDPRESS_USERNAME ||
    '';
  const mediaPassword =
    process.env.WP_MEDIA_APP_PASSWORD ||
    process.env.WORDPRESS_MEDIA_APP_PASSWORD ||
    process.env.WORDPRESS_APP_PASSWORD ||
    '';

  if (mediaUsername && mediaPassword) {
    return {
      rootUrl: buildWordPressRootUrl(baseUrl),
      mediaUrl: buildWordPressMediaUrl(baseUrl),
      authHeader: `Basic ${Buffer.from(`${mediaUsername}:${mediaPassword}`).toString('base64')}`,
      usingDedicatedWordPressAuth: true,
    };
  }

  return {
    rootUrl: buildWordPressRootUrl(baseUrl),
    mediaUrl: buildWordPressMediaUrl(baseUrl),
    authHeader: wooAuthHeader,
    usingDedicatedWordPressAuth: false,
  };
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

function bytesMatchSignature(bytes, signature, offset = 0) {
  if (!bytes || bytes.length < offset + signature.length) return false;

  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }

  return true;
}

function readPayloadTextSample(bytes, length = 512) {
  if (!bytes?.length) return '';
  return bytes.subarray(0, Math.min(bytes.length, length)).toString('utf8').trim().toLowerCase();
}

function detectImageContentType(bytes, contentType = '') {
  const normalizedContentType = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const sample = readPayloadTextSample(bytes);

  if (
    sample.startsWith('<!doctype html') ||
    sample.startsWith('<html') ||
    sample.includes('<html') ||
    sample.includes('inactivity timeout')
  ) {
    return null;
  }

  if (sample.includes('<svg')) return 'image/svg+xml';
  if (bytesMatchSignature(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (bytesMatchSignature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (bytesMatchSignature(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (
    bytesMatchSignature(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytesMatchSignature(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  if (bytesMatchSignature(bytes, [0x42, 0x4d])) return 'image/bmp';
  if (
    bytesMatchSignature(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    bytesMatchSignature(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return 'image/tiff';
  }
  if (
    bytes.length > 12 &&
    bytesMatchSignature(bytes, [0x66, 0x74, 0x79, 0x70], 4) &&
    ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii').toLowerCase())
  ) {
    return 'image/avif';
  }

  return normalizedContentType.startsWith('image/') ? normalizedContentType : null;
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
  const detectedContentType = detectImageContentType(bytes, contentType);
  if (!detectedContentType) {
    throw new Error('Remote image payload was not a valid image');
  }

  const { mediaUrl, authHeader, usingDedicatedWordPressAuth } = getWordPressAuthConfig();
  const filename = buildMediaFilename(sourceUrl, options.filenameBase, detectedContentType);
  const uploadResponse = await fetch(mediaUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': detectedContentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: bytes,
  });

  const body = await readResponseBody(uploadResponse);
  if (!uploadResponse.ok) {
    let message =
      body?.message ||
      body?.error ||
      body?.raw ||
      `WordPress media upload failed (${uploadResponse.status})`;
    if (
      !usingDedicatedWordPressAuth &&
      (uploadResponse.status === 401 || uploadResponse.status === 403)
    ) {
      message +=
        '. WordPress media auth likely needs a dedicated application password. Set WP_MEDIA_USERNAME and WORDPRESS_APP_PASSWORD.';
    }
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

export async function requestWordPress(path, init = {}) {
  const { rootUrl, authHeader, usingDedicatedWordPressAuth } = getWordPressAuthConfig();
  const url = path.startsWith('http') ? path : `${rootUrl}${path.startsWith('/') ? path : `/${path}`}`;

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
    let message =
      body?.message ||
      body?.error ||
      body?.raw ||
      `WordPress request failed (${response.status})`;
    if (
      !usingDedicatedWordPressAuth &&
      (response.status === 401 || response.status === 403)
    ) {
      message +=
        '. WordPress auth likely needs a dedicated application password. Set WP_MEDIA_USERNAME and WORDPRESS_APP_PASSWORD.';
    }
    const error = new Error(message);
    error.statusCode = response.status;
    error.responseBody = body;
    throw error;
  }

  return body;
}

export async function ensureWooProductTag(tagInput) {
  const normalizedName = String(
    typeof tagInput === 'object' && tagInput !== null ? tagInput.name : tagInput || ''
  ).trim();
  const normalizedSlug = String(
    typeof tagInput === 'object' && tagInput !== null ? tagInput.slug : ''
  ).trim();
  if (!normalizedName) return null;

  const existing = normalizedSlug
    ? await requestWoo(`/products/tags?slug=${encodeURIComponent(normalizedSlug)}&per_page=100`)
    : await requestWoo(`/products/tags?search=${encodeURIComponent(normalizedName)}&per_page=100`);
  const exactMatch = (Array.isArray(existing) ? existing : []).find(
    (tag) =>
      String(tag?.name || '').trim().toLowerCase() === normalizedName.toLowerCase() ||
      (normalizedSlug &&
        String(tag?.slug || '').trim().toLowerCase() === normalizedSlug.toLowerCase())
  );
  if (exactMatch?.id) {
    return {
      id: Number(exactMatch.id),
      name: exactMatch.name || normalizedName,
      slug: exactMatch.slug || normalizedSlug || null,
    };
  }

  const created = await requestWoo('/products/tags', {
    method: 'POST',
    body: JSON.stringify({
      name: normalizedName,
      ...(normalizedSlug ? { slug: normalizedSlug } : {}),
    }),
  });
  return created?.id
    ? {
        id: Number(created.id),
        name: created.name || normalizedName,
        slug: created.slug || normalizedSlug || null,
      }
    : null;
}

export async function updateWordPressProductAuthor(productId, authorId) {
  const normalizedProductId = String(productId || '').trim();
  const normalizedAuthorId = Number(authorId);
  if (!normalizedProductId || !Number.isFinite(normalizedAuthorId) || normalizedAuthorId <= 0) {
    return null;
  }

  // Use the dedicated JLO mu-plugin endpoint which directly calls wp_update_post()
  // to set post_author. The standard WP REST /wp/v2/product endpoint does not exist
  // because WooCommerce registers products with show_in_rest=false.
  //
  // requestWordPress() appends paths to its rootUrl which already ends in /wp/v2,
  // so we must pass the full absolute URL to avoid /wp-json/wp/v2/jlo/v1/...
  const { baseUrl } = getWooConfig();
  const wpJsonIndex = baseUrl.toLowerCase().indexOf('/wp-json/');
  const wpJsonBase =
    wpJsonIndex >= 0
      ? baseUrl.slice(0, wpJsonIndex) + '/wp-json'
      : baseUrl.replace(/\/+$/, '') + '/wp-json';
  const endpointUrl = `${wpJsonBase}/jlo/v1/set-product-author`;

  const responseBody = await requestWordPress(endpointUrl, {
    method: 'POST',
    body: JSON.stringify({
      product_id: Number(normalizedProductId),
      author_id: normalizedAuthorId,
    }),
  });

  if (!responseBody?.success) {
    const error = new Error(
      responseBody?.message || 'jlo/v1/set-product-author returned unexpected response'
    );
    error.statusCode = 500;
    throw error;
  }

  return responseBody;
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
    .select('id, email, role, is_active, catalog_access')
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

  // Agents with catalog_access unlock catalog endpoints that also allow shop_manager
  const catalogElevated = profile.catalog_access && profile.role === 'agent';
  const effectiveRole = catalogElevated ? 'agent_catalog' : profile.role;

  const allowedEffective = roles.flatMap((r) =>
    r === 'shop_manager' ? ['shop_manager', 'agent_catalog'] : [r]
  );

  if (!allowedEffective.includes(effectiveRole) && !roles.includes(profile.role)) {
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

export function extractDescriptionImageUrls(value) {
  const source = String(value || '');
  if (!source.trim()) return [];

  const matches = source.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'<>]+))/gi
  );
  const urls = [];
  const seen = new Set();

  for (const match of matches) {
    const candidate = decodeHtmlEntities(match[1] || match[2] || match[3] || '').trim();
    if (!candidate) continue;

    const normalized = candidate.startsWith('//') ? `https:${candidate}` : candidate;
    if (!/^https?:\/\//i.test(normalized)) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
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

function collectNormalizedImageEntries(entry, bucket) {
  if (Array.isArray(entry)) {
    entry.forEach((item) => collectNormalizedImageEntries(item, bucket));
    return;
  }

  if (isPlainObject(entry)) {
    if (typeof entry.src === 'string') {
      collectNormalizedImageEntries(entry.src, bucket);
      return;
    }
    if (typeof entry.url === 'string') {
      collectNormalizedImageEntries(entry.url, bucket);
    }
    return;
  }

  if (typeof entry !== 'string') return;

  const trimmed = entry.trim();
  if (!trimmed) return;

  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      collectNormalizedImageEntries(parsed, bucket);
      return;
    } catch {
      // Fall through to absolute URL extraction.
    }
  }

  const absoluteUrls = trimmed.match(/https?:\/\/[^\s"',\]]+/gi);
  if (Array.isArray(absoluteUrls) && absoluteUrls.length > 0) {
    absoluteUrls.forEach((url) => bucket.push(url.trim()));
    return;
  }

  bucket.push(trimmed);
}

export function normalizeImages(images) {
  if (!Array.isArray(images)) return [];

  const flattened = [];
  images.forEach((entry) => {
    collectNormalizedImageEntries(entry, flattened);
  });

  return Array.from(
    new Set(
      flattened
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  );
}

const SOURCE_LINK_TRACKING_PARAM_PREFIXES = ['utm_'];
const SOURCE_LINK_TRACKING_PARAMS = new Set([
  'aff_fcid',
  'aff_fsk',
  'aff_platform',
  'aff_trace_key',
  'algo_exp_id',
  'algo_pvid',
  'cv',
  'dp',
  'gatewayadapt',
  'scm',
  'scm_id',
  'scm-url',
  'scm_url',
  'scm_url_from',
  'sharetoken',
  'sk',
  'spm',
  'src',
  'terminal_id',
]);

const SOURCE_LINK_DOMAIN_MATCHERS = [
  { label: '1688', hosts: ['1688.com'] },
  { label: 'alibaba', hosts: ['alibaba.com'] },
  { label: 'aliexpress', hosts: ['aliexpress.com'] },
];

function extractSourceDomainFromHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return null;

  const match = SOURCE_LINK_DOMAIN_MATCHERS.find((entry) =>
    entry.hosts.some((host) => normalized === host || normalized.endsWith(`.${host}`))
  );

  return match?.label || null;
}

function sanitizeSourceUrlSearchParams(url) {
  const keys = Array.from(url.searchParams.keys());
  keys.forEach((key) => {
    const normalized = String(key || '').trim().toLowerCase();
    if (
      SOURCE_LINK_TRACKING_PARAMS.has(normalized) ||
      SOURCE_LINK_TRACKING_PARAM_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
      url.searchParams.delete(key);
    }
  });
}

export function normalizeSupportedSourceUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('source_url is required');
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Source URL must be a valid absolute http(s) URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Source URL must use http or https');
  }

  const sourceDomain = extractSourceDomainFromHostname(url.hostname);
  if (!sourceDomain) {
    throw new Error('Only 1688, Alibaba, and AliExpress source URLs are supported for this MVP');
  }

  url.hash = '';
  sanitizeSourceUrlSearchParams(url);

  return {
    sourceUrl: url.toString(),
    sourceDomain,
    hostname: url.hostname.toLowerCase(),
  };
}

function extractMetaContent(html, attributeName, attributeValue) {
  const escaped = String(attributeValue || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(
      `<meta[^>]*${attributeName}=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*${attributeName}=["']${escaped}["'][^>]*>`,
      'i'
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]).trim();
    }
  }

  return '';
}

export function extractTitleFromHtml(html) {
  const candidates = [
    extractMetaContent(html, 'property', 'og:title'),
    extractMetaContent(html, 'name', 'twitter:title'),
  ].filter(Boolean);

  if (candidates[0]) return candidates[0];

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1]).trim() : '';
}

function toAbsoluteUrl(url, baseUrl) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return '';
  }
}

function extractJsonLdBlocks(html) {
  const matches = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!Array.isArray(matches)) return [];

  return matches
    .map((block) => {
      const content = block.replace(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>|<\/script>/gi,
        ''
      );
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function flattenJsonLdNodes(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenJsonLdNodes(entry));
  }

  if (isPlainObject(value)) {
    const graph = Array.isArray(value['@graph']) ? value['@graph'] : [];
    return [value, ...graph.flatMap((entry) => flattenJsonLdNodes(entry))];
  }

  return [];
}

export function extractProductSnapshotFromJsonLd(html, baseUrl) {
  const nodes = extractJsonLdBlocks(html).flatMap((entry) => flattenJsonLdNodes(entry));
  const productNode = nodes.find((entry) => {
    const type = entry?.['@type'];
    if (Array.isArray(type)) {
      return type.some((candidate) => String(candidate).toLowerCase() === 'product');
    }
    return String(type || '').toLowerCase() === 'product';
  });

  if (!productNode) return null;

  const images = normalizeImages([
    productNode.image,
    ...(Array.isArray(productNode.images) ? productNode.images : []),
  ]).map((image) => toAbsoluteUrl(image, baseUrl));

  const offers = Array.isArray(productNode.offers)
    ? productNode.offers[0]
    : isPlainObject(productNode.offers)
    ? productNode.offers
    : null;

  return {
    title: decodeHtmlEntities(String(productNode.name || '')).trim(),
    image: images[0] || '',
    price: asFiniteNumber(offers?.price),
  };
}

function decodeEscapedUrl(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
}

export function extractImageCandidatesFromHtml(html, baseUrl) {
  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = toAbsoluteUrl(decodeEscapedUrl(value), baseUrl);
    if (normalized) {
      candidates.push(normalized);
    }
  };

  const imgTagPattern =
    /<img[^>]+(?:src|data-src|data-lazy-src|data-ks-lazyload|data-original)=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgTagPattern.exec(html))) {
    pushCandidate(match[1]);
  }

  const cssUrlPattern = /url\((['"]?)(https?:\/\/[^'")]+)\1\)/gi;
  while ((match = cssUrlPattern.exec(html))) {
    pushCandidate(match[2]);
  }

  const jsonImagePattern =
    /"(?:image|images|mainImage|productImage|imgUrl|imageUrl|originalImage|bigImage|picUrl|picURI|imageURI)"\s*:\s*(?:"([^"]+)"|\[([^\]]+)\])/gi;
  while ((match = jsonImagePattern.exec(html))) {
    if (match[1]) {
      pushCandidate(match[1]);
      continue;
    }

    const listBody = String(match[2] || '');
    const listMatches = listBody.match(/"([^"]+)"/g) || [];
    listMatches.forEach((entry) => pushCandidate(entry.replace(/^"|"$/g, '')));
  }

  const looseImageUrlPattern =
    /https?:\/\/[^"'\\\s<>]+?\.(?:jpg|jpeg|png|webp|gif|avif|bmp)(?:\?[^"'\\\s<>]*)?/gi;
  while ((match = looseImageUrlPattern.exec(decodeEscapedUrl(html)))) {
    pushCandidate(match[0]);
  }

  return normalizeImages(candidates);
}

export async function fetchSourceLinkProductSnapshot(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'JulineMart-Global-Sourcing/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch source URL (${response.status})`);
    }

    const html = await response.text();
    const finalUrl = response.url || sourceUrl;
    const jsonLdSnapshot = extractProductSnapshotFromJsonLd(html, finalUrl) || {};
    const imageCandidates = extractImageCandidatesFromHtml(html, finalUrl);
    const title = jsonLdSnapshot.title || extractTitleFromHtml(html) || null;
    const image =
      jsonLdSnapshot.image ||
      toAbsoluteUrl(extractMetaContent(html, 'property', 'og:image'), finalUrl) ||
      toAbsoluteUrl(extractMetaContent(html, 'name', 'twitter:image'), finalUrl) ||
      toAbsoluteUrl(extractMetaContent(html, 'itemprop', 'image'), finalUrl) ||
      imageCandidates[0] ||
      null;
    const price =
      jsonLdSnapshot.price ??
      asFiniteNumber(extractMetaContent(html, 'property', 'product:price:amount')) ??
      asFiniteNumber(extractMetaContent(html, 'name', 'price'));

    return {
      title: title ? title.slice(0, 200) : null,
      image: image || null,
      price,
      finalUrl,
      metadata_complete: Boolean(title && image),
      fetch_error: null,
    };
  } catch (error) {
    return {
      title: null,
      image: null,
      price: null,
      finalUrl: sourceUrl,
      metadata_complete: false,
      fetch_error: error instanceof Error ? error.message : 'Unable to fetch source metadata',
    };
  }
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
  supplierSource = null,
  supplierProductId = null,
  supplierVariantId = null,
  supplierUrl = null,
  fulfillmentMode = 'cj_hub',
  receivingHubId = null,
  receivingHubName = null,
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
  usdToNgnRateSourceSnapshot,
  fxRateFetchedAtSnapshot,
  finalPriceSnapshotNgn,
  pricingMode,
  vendorId,
  woocommerceVendorId,
}) {
  const normalizedProvider = String(provider || 'cj').trim().toLowerCase() || 'cj';
  const normalizedSupplierSource =
    String(supplierSource || (normalizedProvider !== 'cj' ? normalizedProvider : '')).trim() || null;
  const normalizedSupplierProductId =
    supplierProductId !== null && supplierProductId !== undefined && String(supplierProductId).trim()
      ? String(supplierProductId).trim()
      : normalizedProvider !== 'cj' && cjPid
      ? String(cjPid).trim()
      : null;
  const normalizedSupplierVariantId =
    supplierVariantId !== null && supplierVariantId !== undefined && String(supplierVariantId).trim()
      ? String(supplierVariantId).trim()
      : normalizedProvider !== 'cj' && cjVid
      ? String(cjVid).trim()
      : null;
  const normalizedSupplierUrl =
    supplierUrl !== null && supplierUrl !== undefined && String(supplierUrl).trim()
      ? String(supplierUrl).trim()
      : null;

  return {
    _global_sourcing_provider: normalizedProvider,
    _cj_pid: cjPid,
    _cj_vid: cjVid,
    ...(normalizedSupplierSource ? { _supplier_source: normalizedSupplierSource } : {}),
    ...(normalizedSupplierProductId ? { _supplier_product_id: normalizedSupplierProductId } : {}),
    ...(normalizedSupplierVariantId ? { _supplier_variant_id: normalizedSupplierVariantId } : {}),
    ...(normalizedSupplierUrl ? { _supplier_url: normalizedSupplierUrl } : {}),
    _fulfillment_mode: fulfillmentMode,
    _receiving_hub_id: receivingHubId,
    ...(receivingHubId
      ? {
          _julinemart_hub_id: String(receivingHubId),
          _hub_id: String(receivingHubId),
          hub_id: String(receivingHubId),
        }
      : {}),
    ...(receivingHubName
      ? {
          _julinemart_hub_name: String(receivingHubName),
          _hub_name: String(receivingHubName),
          hub_name: String(receivingHubName),
        }
      : {}),
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
    ...(usdToNgnRateSourceSnapshot !== undefined
      ? { _usd_to_ngn_rate_source_snapshot: String(usdToNgnRateSourceSnapshot) }
      : {}),
    ...(fxRateFetchedAtSnapshot !== undefined
      ? { _fx_rate_fetched_at_snapshot: String(fxRateFetchedAtSnapshot) }
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
          _wcfm_product_author: String(woocommerceVendorId),
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
  const supplierSource = extractMetaValue(metaData, ['_supplier_source', 'supplier_source']);
  const supplierProductId = extractMetaValue(metaData, [
    '_supplier_product_id',
    'supplier_product_id',
  ]);
  const supplierVariantId = extractMetaValue(metaData, [
    '_supplier_variant_id',
    'supplier_variant_id',
  ]);
  const supplierUrl = extractMetaValue(metaData, ['_supplier_url', 'supplier_url']);
  const receivingHubId = extractMetaValue(metaData, [
    '_receiving_hub_id',
    'receiving_hub_id',
    '_julinemart_hub_id',
    '_hub_id',
    'hub_id',
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
  const normalizedProvider = String(provider || 'cj').trim().toLowerCase() || 'cj';
  const isSupportedProvider = ['cj', 'aliexpress'].includes(normalizedProvider);
  const hasCoreSourcingFields = Boolean(
    receivingHubId &&
      (cjPid ||
        cjVid ||
        supplierProductId ||
        supplierVariantId ||
        shipsFromAbroad === 'yes')
  );

  if (!isCjHub || !isSupportedProvider || !hasCoreSourcingFields) return null;

  return {
    provider: normalizedProvider,
    fulfillmentMode,
    cjPid: cjPid || null,
    cjVid: cjVid || null,
    supplierSource: supplierSource || (normalizedProvider !== 'cj' ? normalizedProvider : null),
    supplierProductId: supplierProductId || null,
    supplierVariantId: supplierVariantId || null,
    supplierUrl: supplierUrl || null,
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

