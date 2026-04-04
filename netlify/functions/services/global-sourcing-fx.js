import { asFiniteNumber, getGlobalSourcingPricingConfig } from './global-sourcing-utils.js';
import { fetchLatestUsdToNgnRate } from './exchange-rate-host.js';

const DEFAULT_PROVIDER = 'cj';
const FX_PROVIDER = 'exchangerate_host';
const DEFAULT_CACHE_MINUTES = 60;

function pickString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return '';
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function getCacheMinutes() {
  const configured = asFiniteNumber(process.env.FX_RATE_CACHE_MINUTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CACHE_MINUTES;
}

function getCacheDurationMs() {
  return getCacheMinutes() * 60 * 1000;
}

function getEnvFallbackRate() {
  const explicitEnvRate =
    asFiniteNumber(process.env.GLOBAL_SOURCING_USD_TO_NGN_RATE) ??
    asFiniteNumber(process.env.USD_TO_NGN_RATE);
  return explicitEnvRate ?? null;
}

function hasExchangeRateApiKey() {
  return Boolean(String(process.env.EXCHANGERATE_API_KEY || '').trim());
}

function normalizeRow(data, provider = DEFAULT_PROVIDER) {
  return {
    provider,
    saved: Boolean(data),
    updated_at: data?.updated_at || null,
    fx: {
      provider: pickString(data?.fx_provider) || FX_PROVIDER,
      manual_override_enabled: toBoolean(data?.fx_manual_override_enabled, false),
      manual_rate: asFiniteNumber(data?.fx_manual_rate) ?? null,
      manual_rate_note: pickString(data?.fx_manual_rate_note) || null,
      live_api_enabled: toBoolean(data?.fx_live_api_enabled, true),
      last_fetched_rate: asFiniteNumber(data?.fx_last_fetched_rate) ?? null,
      last_fetched_at: data?.fx_last_fetched_at || null,
      cache_expires_at: data?.fx_cache_expires_at || null,
    },
  };
}

async function readFxSettingsRow(client, provider = DEFAULT_PROVIDER) {
  if (!client) return normalizeRow(null, provider);

  try {
    const { data, error } = await client
      .from('global_sourcing_settings')
      .select(
        'provider, fx_provider, fx_manual_override_enabled, fx_manual_rate, fx_manual_rate_note, fx_live_api_enabled, fx_last_fetched_rate, fx_last_fetched_at, fx_cache_expires_at, updated_at'
      )
      .eq('provider', provider)
      .maybeSingle();

    if (error) {
      if (/global_sourcing_settings/i.test(String(error.message || ''))) {
        return normalizeRow(null, provider);
      }
      throw error;
    }

    return normalizeRow(data, provider);
  } catch {
    return normalizeRow(null, provider);
  }
}

function getCacheExpiryDate(settings) {
  if (!settings?.fx?.cache_expires_at) return null;
  const parsed = Date.parse(String(settings.fx.cache_expires_at));
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function isCacheValid(settings, now = Date.now()) {
  const rate = asFiniteNumber(settings?.fx?.last_fetched_rate);
  const expiresAt = getCacheExpiryDate(settings);
  return Boolean(rate !== null && expiresAt && expiresAt.getTime() > now);
}

async function persistFxCache(client, provider, { rate, fetchedAt, cacheExpiresAt }) {
  if (!client) return;

  const row = {
    provider,
    fx_provider: FX_PROVIDER,
    fx_last_fetched_rate: rate,
    fx_last_fetched_at: fetchedAt,
    fx_cache_expires_at: cacheExpiresAt,
  };

  const { error } = await client.from('global_sourcing_settings').upsert(row, {
    onConflict: 'provider',
  });

  if (error) {
    throw error;
  }
}

export async function loadGlobalSourcingFxSettings(client, provider = DEFAULT_PROVIDER) {
  return readFxSettingsRow(client, provider);
}

export async function saveGlobalSourcingFxSettings(client, provider = DEFAULT_PROVIDER, payload = {}) {
  const current = await readFxSettingsRow(client, provider);
  const hasManualOverrideEnabled = Object.prototype.hasOwnProperty.call(
    payload,
    'manual_override_enabled'
  );
  const hasManualRate = Object.prototype.hasOwnProperty.call(payload, 'manual_rate');
  const hasManualRateNote = Object.prototype.hasOwnProperty.call(payload, 'manual_rate_note');
  const hasLiveApiEnabled = Object.prototype.hasOwnProperty.call(payload, 'live_api_enabled');

  const row = {
    provider,
    fx_provider: FX_PROVIDER,
    fx_manual_override_enabled: hasManualOverrideEnabled
      ? toBoolean(payload.manual_override_enabled, current.fx.manual_override_enabled)
      : current.fx.manual_override_enabled,
    fx_manual_rate: hasManualRate
      ? payload.manual_rate === '' || payload.manual_rate === null || payload.manual_rate === undefined
        ? null
        : asFiniteNumber(payload.manual_rate)
      : current.fx.manual_rate,
    fx_manual_rate_note: hasManualRateNote
      ? payload.manual_rate_note === '' || payload.manual_rate_note === null
        ? null
        : pickString(payload.manual_rate_note) || null
      : current.fx.manual_rate_note,
    fx_live_api_enabled: hasLiveApiEnabled
      ? toBoolean(payload.live_api_enabled, current.fx.live_api_enabled)
      : current.fx.live_api_enabled,
  };

  if (
    row.fx_manual_override_enabled &&
    (row.fx_manual_rate === null || !Number.isFinite(row.fx_manual_rate) || row.fx_manual_rate <= 0)
  ) {
    throw new Error('Manual USD to NGN override is enabled but no manual rate was provided');
  }

  if (row.fx_manual_rate !== null && (!Number.isFinite(row.fx_manual_rate) || row.fx_manual_rate <= 0)) {
    throw new Error('Manual USD to NGN rate must be greater than zero');
  }

  const { error } = await client.from('global_sourcing_settings').upsert(row, {
    onConflict: 'provider',
  });

  if (error) {
    throw error;
  }

  return readFxSettingsRow(client, provider);
}

async function tryFetchLiveRate() {
  return fetchLatestUsdToNgnRate();
}

export async function getEffectiveUsdToNgnRate(
  client,
  { provider = DEFAULT_PROVIDER, forceRefresh = false, requireFreshRate = false } = {}
) {
  const settings = await readFxSettingsRow(client, provider);
  const fx = settings.fx || {};
  const envFallbackRate = getEnvFallbackRate();
  const hardcodedFallbackRate = getGlobalSourcingPricingConfig().usdToNgnRate;
  const cacheDurationMs = getCacheDurationMs();
  const nowIso = new Date().toISOString();
  const manualRate = asFiniteNumber(fx.manual_rate);

  if (fx.manual_override_enabled && manualRate !== null) {
    return {
      rate: manualRate,
      source: 'manual_override',
      fetchedAt: null,
      note: pickString(fx.manual_rate_note) || null,
    };
  }

  const notes = [];
  if (fx.manual_override_enabled && manualRate === null) {
    notes.push('Manual override is enabled but no manual rate is configured.');
  }

  if (!hasExchangeRateApiKey()) {
    notes.push('ExchangeRate Host API key is not configured.');
  }

  if (!forceRefresh && isCacheValid(settings)) {
    return {
      rate: asFiniteNumber(fx.last_fetched_rate),
      source: 'cached_api',
      fetchedAt: fx.last_fetched_at || null,
      note: notes.length > 0 ? notes.join(' ') : null,
    };
  }

  const liveApiEnabled = toBoolean(fx.live_api_enabled, true);
  if (forceRefresh || liveApiEnabled) {
    try {
      const liveRate = await tryFetchLiveRate();
      const cacheExpiresAt = new Date(Date.now() + cacheDurationMs).toISOString();
      try {
        await persistFxCache(client, provider, {
          rate: liveRate.rate,
          fetchedAt: liveRate.fetchedAt,
          cacheExpiresAt,
        });
      } catch (persistError) {
        notes.push(persistError?.message || 'Unable to persist live FX cache');
      }

      return {
        rate: liveRate.rate,
        source: 'live_api',
        fetchedAt: liveRate.fetchedAt,
        note: notes.length > 0 ? notes.join(' ') : null,
      };
    } catch (error) {
      if (forceRefresh || requireFreshRate) {
        throw error;
      }

      notes.push(error?.message || 'Live FX fetch failed');
    }
  } else {
    notes.push('Live FX fetching is disabled in settings.');
  }

  if (envFallbackRate !== null) {
    return {
      rate: envFallbackRate,
      source: 'env_fallback',
      fetchedAt: nowIso,
      note: notes.length > 0 ? notes.join(' ') : null,
    };
  }

  return {
    rate: hardcodedFallbackRate,
    source: 'hardcoded_fallback',
    fetchedAt: nowIso,
    note: notes.length > 0 ? notes.join(' ') : null,
  };
}

export async function refreshGlobalSourcingUsdToNgnRate(client, provider = DEFAULT_PROVIDER) {
  if (!hasExchangeRateApiKey()) {
    const fallback = await getEffectiveUsdToNgnRate(client, {
      provider,
      forceRefresh: false,
      requireFreshRate: false,
    });

    return {
      ...fallback,
      note: [fallback.note, 'ExchangeRate Host API key is not configured.']
        .filter(Boolean)
        .join(' '),
    };
  }

  const liveRate = await tryFetchLiveRate();
  const cacheDurationMs = getCacheDurationMs();
  const cacheExpiresAt = new Date(Date.now() + cacheDurationMs).toISOString();
  const notes = [];

  if (client) {
    try {
      await persistFxCache(client, provider, {
        rate: liveRate.rate,
        fetchedAt: liveRate.fetchedAt,
        cacheExpiresAt,
      });
    } catch (persistError) {
      notes.push(persistError?.message || 'Unable to persist live FX cache');
    }
  }

  return {
    rate: liveRate.rate,
    source: 'live_api',
    fetchedAt: liveRate.fetchedAt,
    note: notes.length > 0 ? notes.join(' ') : null,
  };
}
