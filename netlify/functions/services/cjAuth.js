import { sanitizeBaseUrl } from './global-sourcing-utils.js';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_TOKEN_TTL_MS = 45 * 60 * 1000;
const PROVIDER = 'cj';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

const tokenStoreClient =
  SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;

function getCjConfig() {
  const apiKey = process.env.CJ_API_KEY || '';
  const baseUrl = sanitizeBaseUrl(process.env.CJ_API_BASE_URL || '');
  const authPathOverride = sanitizeBaseUrl(process.env.CJ_AUTH_PATH || '');

  if (!apiKey || !baseUrl) {
    throw new Error('CJ API credentials are not fully configured');
  }

  return { apiKey, baseUrl, authPathOverride };
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

function buildTokenResponse(accessToken, expiresAt, cached) {
  return {
    accessToken,
    expiresAt,
    cached,
  };
}

function isTokenUsable(expiresAt) {
  const timestamp = Date.parse(String(expiresAt || ''));
  return !Number.isNaN(timestamp) && timestamp > Date.now() + 30 * 1000;
}

async function loadStoredToken() {
  if (!tokenStoreClient) return null;

  const { data, error } = await tokenStoreClient
    .from('provider_auth_tokens')
    .select('access_token, expires_at')
    .eq('provider', PROVIDER)
    .maybeSingle();

  if (error || !data?.access_token || !isTokenUsable(data.expires_at)) {
    return null;
  }

  cachedToken = data.access_token;
  cachedTokenExpiresAt = Date.parse(data.expires_at);

  return buildTokenResponse(data.access_token, data.expires_at, true);
}

async function saveStoredToken(accessToken, expiresAt, metadata = {}) {
  if (!tokenStoreClient) return;

  await tokenStoreClient.from('provider_auth_tokens').upsert(
    {
      provider: PROVIDER,
      access_token: accessToken,
      expires_at: expiresAt,
      metadata,
    },
    { onConflict: 'provider' }
  );
}

function extractCjFailure(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const success = payload.success;
  const result = payload.result;
  const code = payload.code;
  const message = payload.message || payload.msg || payload.error_description || payload.error;

  const explicitFailure =
    success === false ||
    result === false ||
    (typeof code === 'number' && code !== 200 && code !== 0) ||
    (typeof code === 'string' && code !== '200' && code !== '0');

  if (!explicitFailure) return null;

  return {
    code: code ?? null,
    message: message || 'CJ API returned an application-level error',
    payload,
  };
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
    return buildTokenResponse(
      cachedToken,
      new Date(cachedTokenExpiresAt).toISOString(),
      true
    );
  }

  if (!forceRefresh) {
    const storedToken = await loadStoredToken();
    if (storedToken) {
      return storedToken;
    }
  }

  const { apiKey, baseUrl, authPathOverride } = getCjConfig();

  const attempts = [
    ...(authPathOverride
      ? [
          {
            path: authPathOverride.startsWith('/') ? authPathOverride : `/${authPathOverride}`,
            method: 'POST',
            body: { apiKey },
          },
        ]
      : []),
    {
      path: '/v1/authentication/getAccessToken',
      method: 'POST',
      body: { apiKey },
    },
    {
      path: '/v1/authentication/getAccessToken',
      method: 'GET',
    },
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
        baseUrl,
        path: attempt.path,
        method: attempt.method,
        status: response.status,
        body,
      });
      if (response.status === 429 && !forceRefresh) {
        const storedToken = await loadStoredToken();
        if (storedToken) {
          return storedToken;
        }
      }

      if (![400, 404, 405].includes(response.status)) {
        break;
      }
      continue;
    }

    const accessToken = resolveAccessToken(body);
    if (!accessToken) {
      failures.push({
        baseUrl,
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
    const expiresAt = new Date(cachedTokenExpiresAt).toISOString();

    await saveStoredToken(accessToken, expiresAt, {
      base_url: baseUrl,
      token_path: attempt.path,
    });

    return buildTokenResponse(accessToken, expiresAt, false);
  }

  const error = new Error('Unable to acquire CJ access token');
  error.details = failures;
  throw error;
}

export async function requestCjJson({
  pathCandidates,
  method = 'GET',
  bodyCandidates = [undefined],
  queryCandidates = [undefined],
  accessToken,
}) {
  const { baseUrl } = getCjConfig();
  const failures = [];

  for (const path of pathCandidates) {
    for (const body of bodyCandidates) {
      for (const query of queryCandidates) {
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

        const cjFailure = extractCjFailure(parsed);

        if (!response.ok || cjFailure) {
          failures.push({
            path,
            method,
            status: response.status,
            body,
            query,
            response: parsed,
            cjError: cjFailure,
          });
          if (cjFailure || [400, 404, 405].includes(response.status)) {
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
  }

  const error = new Error('CJ request failed');
  error.details = failures;
  throw error;
}
