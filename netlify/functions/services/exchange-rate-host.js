const DEFAULT_BASE_URL = 'https://api.exchangerate.host';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SOURCE = 'USD';
const DEFAULT_CURRENCY = 'NGN';
const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sanitizeBaseUrl(value) {
  const raw = String(value || '').trim();
  return raw ? raw.replace(/\/+$/, '') : DEFAULT_BASE_URL;
}

function pickString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
}

function isTransientFetchError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  if (TRANSIENT_STATUS_CODES.has(status)) return true;

  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('socket') ||
    message.includes('econnreset') ||
    message.includes('enotfound')
  );
}

function buildLatestRateUrl({ baseUrl, apiKey, source = DEFAULT_SOURCE, currencies = DEFAULT_CURRENCY }) {
  const url = new URL(`${sanitizeBaseUrl(baseUrl)}/live`);
  url.searchParams.set('source', String(source || DEFAULT_SOURCE).trim().toUpperCase());
  url.searchParams.set('currencies', String(currencies || DEFAULT_CURRENCY).trim().toUpperCase());

  const normalizedKey = pickString(apiKey);
  if (normalizedKey) {
    url.searchParams.set('access_key', normalizedKey);
  }

  return url;
}

async function readResponseBody(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractRatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('ExchangeRate Host returned a malformed response body');
  }

  if (payload.success === false) {
    const providerMessage =
      pickString(payload.error?.info, payload.error?.message, payload.message, payload.error) ||
      'ExchangeRate Host reported a failure';
    throw new Error(providerMessage);
  }

  const source = String(payload.source || DEFAULT_SOURCE).trim().toUpperCase() || DEFAULT_SOURCE;
  const quotes = payload.quotes && typeof payload.quotes === 'object' ? payload.quotes : null;
  const pairKey = `${source}${DEFAULT_CURRENCY}`;
  const quoteValue = quotes?.[pairKey];
  const rate = Number(quoteValue);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('ExchangeRate Host did not return a usable USD to NGN quote');
  }

  const timestampSeconds = Number(payload.timestamp || payload.info?.timestamp || 0);
  const fetchedAt =
    Number.isFinite(timestampSeconds) && timestampSeconds > 0
      ? new Date(timestampSeconds * 1000).toISOString()
      : new Date().toISOString();

  return {
    rate,
    fetchedAt,
    source,
    raw: payload,
  };
}

async function fetchOnce({ baseUrl, apiKey, timeoutMs }) {
  const url = buildLatestRateUrl({ baseUrl, apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await readResponseBody(response).catch(() => null);
      const message =
        pickString(body?.error?.info, body?.error?.message, body?.message) ||
        `ExchangeRate Host request failed with HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.details = body;
      throw error;
    }

    const body = await readResponseBody(response);
    return {
      endpoint: url.toString(),
      ...extractRatePayload(body),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLatestUsdToNgnRate({
  apiKey = process.env.EXCHANGERATE_API_KEY || '',
  baseUrl = process.env.EXCHANGERATE_API_BASE_URL || DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  try {
    return await fetchOnce({ baseUrl, apiKey, timeoutMs });
  } catch (error) {
    if (!isTransientFetchError(error)) {
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    return fetchOnce({ baseUrl, apiKey, timeoutMs });
  }
}

