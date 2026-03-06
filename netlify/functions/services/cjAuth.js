import { sanitizeBaseUrl } from './global-sourcing-utils.js';

const DEFAULT_TOKEN_TTL_MS = 45 * 60 * 1000;

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getCjConfig() {
  const apiKey = process.env.CJ_API_KEY || '';
  const baseUrl = sanitizeBaseUrl(process.env.CJ_API_BASE_URL || '');

  if (!apiKey || !baseUrl) {
    throw new Error('CJ API credentials are not fully configured');
  }

  return { apiKey, baseUrl };
}

function resolveAccessToken(payload) {
  const candidates = [
    payload?.accessToken,
    payload?.access_token,
    payload?.token,
    payload?.data?.accessToken,
    payload?.data?.access_token,
    payload?.data?.token,
    payload?.result?.accessToken,
    payload?.result?.access_token,
    payload?.result?.token,
  ];

  return candidates.find((value) => typeof value === 'string' && value.trim()) || null;
}

function resolveExpiryMs(payload) {
  const expiresIn =
    payload?.expiresIn ??
    payload?.expires_in ??
    payload?.data?.expiresIn ??
    payload?.data?.expires_in ??
    payload?.result?.expiresIn ??
    payload?.result?.expires_in;

  const numeric = Number(expiresIn);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric * 1000;
  }

  const expiresAt =
    payload?.expiresAt ||
    payload?.expires_at ||
    payload?.data?.expiresAt ||
    payload?.data?.expires_at ||
    payload?.result?.expiresAt ||
    payload?.result?.expires_at;

  if (expiresAt) {
    const timestamp = Date.parse(String(expiresAt));
    if (!Number.isNaN(timestamp)) {
      return Math.max(timestamp - Date.now(), 60 * 1000);
    }
  }

  return DEFAULT_TOKEN_TTL_MS;
}

async function requestTokenAttempt(baseUrl, apiKey, attempt) {
  const response = await fetch(`${baseUrl}${attempt.path}`, {
    method: attempt.method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'CJ-Access-Token': apiKey,
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      ...(attempt.headers || {}),
    },
    body: attempt.body !== undefined ? JSON.stringify(attempt.body) : undefined,
  });

  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }

  return { response, body, attempt };
}

export async function getCjAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedToken && cachedTokenExpiresAt > Date.now() + 30 * 1000) {
    return {
      accessToken: cachedToken,
      expiresAt: new Date(cachedTokenExpiresAt).toISOString(),
      cached: true,
    };
  }

  const { apiKey, baseUrl } = getCjConfig();

  const attempts = [
    {
      path: '/authentication/getAccessToken',
      method: 'POST',
      body: { apiKey },
    },
    {
      path: '/authentication/getAccessToken',
      method: 'GET',
    },
    {
      path: '/auth/token',
      method: 'POST',
      body: { apiKey },
    },
  ];

  const failures = [];

  for (const attempt of attempts) {
    const { response, body } = await requestTokenAttempt(baseUrl, apiKey, attempt);
    if (!response.ok) {
      failures.push({
        path: attempt.path,
        method: attempt.method,
        status: response.status,
        body,
      });
      if (![400, 404, 405].includes(response.status)) {
        break;
      }
      continue;
    }

    const accessToken = resolveAccessToken(body);
    if (!accessToken) {
      failures.push({
        path: attempt.path,
        method: attempt.method,
        status: response.status,
        body,
        message: 'Token field missing from response',
      });
      continue;
    }

    const ttlMs = resolveExpiryMs(body);
    cachedToken = accessToken;
    cachedTokenExpiresAt = Date.now() + ttlMs;

    return {
      accessToken,
      expiresAt: new Date(cachedTokenExpiresAt).toISOString(),
      cached: false,
    };
  }

  const error = new Error('Unable to acquire CJ access token');
  error.details = failures;
  throw error;
}

export async function requestCjJson({
  pathCandidates,
  method = 'GET',
  bodyCandidates = [undefined],
  accessToken,
  query,
}) {
  const { baseUrl } = getCjConfig();
  const failures = [];

  for (const path of pathCandidates) {
    for (const body of bodyCandidates) {
      const url = new URL(`${baseUrl}${path}`);
      if (query && typeof query === 'object') {
        Object.entries(query).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
          }
        });
      }

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'CJ-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      const raw = await response.text();
      let parsed = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = { raw };
      }

      if (!response.ok) {
        failures.push({
          path,
          method,
          status: response.status,
          body,
          response: parsed,
        });
        if ([400, 404, 405].includes(response.status)) {
          continue;
        }
        break;
      }

      return {
        data: parsed,
        endpoint: path,
      };
    }
  }

  const error = new Error('CJ request failed');
  error.details = failures;
  throw error;
}
