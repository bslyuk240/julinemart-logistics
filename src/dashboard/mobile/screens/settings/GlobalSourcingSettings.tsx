import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Loader,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { Field, SectionCard, SettingsGroup, SettingsRow, SettingsSubpage, StatusPill, formatEnvKey, inputCls } from '../../components/SettingsParts';
import {
  fetchCjSettingsStatus,
  fetchFxSyncStatus,
  fetchGlobalSourcingPricingSettings,
  formatFxSourceLabel,
  formatSettingsDate,
  formatSyncReason,
  getErrorMessage,
  refreshGlobalSourcingFxRate,
  runFxPriceSync,
  sanitizeSettingsError,
  saveGlobalSourcingPricingSettings,
  testCjSettingsAuth,
  type FxSyncLogEntry,
  type FxSyncStatusData,
  type GlobalSourcingPricingSettings,
  type SettingsStatus,
} from '../../lib/settingsApi';

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function applyPricingToForm(settings: GlobalSourcingPricingSettings) {
  const values = settings.values || {
    import_buffer_usd: null,
    markup_percent: null,
    markup_flat_ngn: null,
    usd_to_ngn_rate: null,
  };
  const fx = settings.fx;
  return {
    importBufferUsd: values.import_buffer_usd !== null ? String(values.import_buffer_usd) : '',
    markupPercent: values.markup_percent !== null ? String(values.markup_percent) : '',
    markupFlatNgn: values.markup_flat_ngn !== null ? String(values.markup_flat_ngn) : '',
    fxManualOverrideEnabled: fx?.manual_override_enabled ?? false,
    fxManualRate: fx?.manual_rate !== null && fx?.manual_rate !== undefined ? String(fx.manual_rate) : '',
    fxManualRateNote: fx?.manual_rate_note ?? '',
    fxLiveApiEnabled: fx?.live_api_enabled ?? true,
  };
}

function syncChangePct(entry: FxSyncLogEntry, older?: FxSyncLogEntry) {
  if (entry.change_pct != null) return Number(entry.change_pct);
  if (entry.previous_rate != null && Number(entry.previous_rate) > 0) {
    return ((Number(entry.rate_used) - Number(entry.previous_rate)) / Number(entry.previous_rate)) * 100;
  }
  if (older?.rate_used != null && Number(older.rate_used) > 0) {
    return ((Number(entry.rate_used) - Number(older.rate_used)) / Number(older.rate_used)) * 100;
  }
  return null;
}

export default function MobileGlobalSourcingSettings() {
  const { session } = useAuth();
  const notification = useNotification();
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [pricing, setPricing] = useState<GlobalSourcingPricingSettings | null>(null);
  const [fxSync, setFxSync] = useState<FxSyncStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testingAuth, setTestingAuth] = useState(false);
  const [loadingPricing, setLoadingPricing] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [refreshingFx, setRefreshingFx] = useState(false);
  const [runningSync, setRunningSync] = useState(false);
  const [loadingSync, setLoadingSync] = useState(false);

  const [importBufferUsd, setImportBufferUsd] = useState('');
  const [markupPercent, setMarkupPercent] = useState('');
  const [markupFlatNgn, setMarkupFlatNgn] = useState('');
  const [fxManualOverrideEnabled, setFxManualOverrideEnabled] = useState(false);
  const [fxManualRate, setFxManualRate] = useState('');
  const [fxManualRateNote, setFxManualRateNote] = useState('');
  const [fxLiveApiEnabled, setFxLiveApiEnabled] = useState(true);

  const applyForm = useCallback((settings: GlobalSourcingPricingSettings) => {
    const next = applyPricingToForm(settings);
    setImportBufferUsd(next.importBufferUsd);
    setMarkupPercent(next.markupPercent);
    setMarkupFlatNgn(next.markupFlatNgn);
    setFxManualOverrideEnabled(next.fxManualOverrideEnabled);
    setFxManualRate(next.fxManualRate);
    setFxManualRateNote(next.fxManualRateNote);
    setFxLiveApiEnabled(next.fxLiveApiEnabled);
  }, []);

  const loadAuth = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      setStatus(await fetchCjSettingsStatus(session.access_token));
    } catch (e) {
      notification.error('Auth status failed', getErrorMessage(e, 'Could not load CJ status'));
    }
  }, [notification, session?.access_token]);

  const loadPricing = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingPricing(true);
    try {
      const data = await fetchGlobalSourcingPricingSettings(session.access_token);
      setPricing(data);
      applyForm(data);
    } catch (e) {
      notification.error('Pricing load failed', getErrorMessage(e, 'Could not load pricing defaults'));
    } finally {
      setLoadingPricing(false);
    }
  }, [applyForm, notification, session?.access_token]);

  const loadSync = useCallback(async () => {
    if (!session?.access_token) return;
    setLoadingSync(true);
    try {
      setFxSync(await fetchFxSyncStatus(session.access_token));
    } catch {
      // non-critical
    } finally {
      setLoadingSync(false);
    }
  }, [session?.access_token]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadAuth(), loadPricing(), loadSync()]);
    setLoading(false);
  }, [loadAuth, loadPricing, loadSync]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const runTestAuth = async () => {
    if (!session?.access_token) return;
    setTestingAuth(true);
    try {
      const data = await testCjSettingsAuth(session.access_token);
      setStatus((prev) => ({ ...(prev || { configured: false, checks: {} }), ...data }));
      if (data.cj_connected) {
        notification.success('CJ connected', 'Backend authentication succeeded');
      } else {
        notification.error('CJ unreachable', sanitizeSettingsError(data.cj_connection_error, 'Authentication failed'));
      }
    } catch (e) {
      notification.error('Test failed', getErrorMessage(e, 'Connection test failed'));
    } finally {
      setTestingAuth(false);
    }
  };

  const connectionTone = (value: boolean | null | undefined): 'ok' | 'bad' | 'neutral' => {
    if (value === true) return 'ok';
    if (value === false) return 'bad';
    return 'neutral';
  };

  const connectionLabel = (value: boolean | null | undefined) => {
    if (value === true) return 'Connected';
    if (value === false) return 'Unreachable';
    return 'Not tested';
  };

  const savePricing = async () => {
    if (!session?.access_token) return;
    const parsedFxManualRate = parseOptionalNumber(fxManualRate);
    if (fxManualOverrideEnabled && parsedFxManualRate === null) {
      notification.error('FX required', 'Enter a manual USD → NGN rate before enabling override');
      return;
    }
    setSavingPricing(true);
    try {
      const data = await saveGlobalSourcingPricingSettings(session.access_token, {
        import_buffer_usd: parseOptionalNumber(importBufferUsd),
        markup_percent: parseOptionalNumber(markupPercent),
        markup_flat_ngn: parseOptionalNumber(markupFlatNgn),
        usd_to_ngn_rate: pricing?.values?.usd_to_ngn_rate ?? null,
        manual_override_enabled: fxManualOverrideEnabled,
        manual_rate: parsedFxManualRate,
        manual_rate_note: fxManualRateNote.trim() || null,
        live_api_enabled: fxLiveApiEnabled,
      });
      setPricing(data);
      applyForm(data);
      notification.success('Saved', 'Global Sourcing settings updated');
    } catch (e) {
      notification.error('Save failed', getErrorMessage(e, 'Could not save settings'));
    } finally {
      setSavingPricing(false);
    }
  };

  const refreshFx = async () => {
    if (!session?.access_token) return;
    setRefreshingFx(true);
    try {
      const response = await refreshGlobalSourcingFxRate(session.access_token);
      setPricing(response.data);
      applyForm(response.data);
      const sync = response.price_sync;
      if (response.note) {
        notification.warning('FX refreshed', response.note);
      } else if (sync?.synced) {
        const total = (sync.updatedSimple ?? 0) + (sync.updatedVariations ?? 0);
        notification.success('FX refreshed', `${total} product price${total !== 1 ? 's' : ''} re-synced`);
      } else {
        notification.success('FX refreshed', 'Live rate updated');
      }
      void loadSync();
    } catch (e) {
      notification.error('FX refresh failed', getErrorMessage(e, 'Could not fetch live rate'));
    } finally {
      setRefreshingFx(false);
    }
  };

  const runSync = async () => {
    if (!session?.access_token) return;
    setRunningSync(true);
    try {
      const data = await runFxPriceSync(session.access_token);
      const total = data.updatedSimple + data.updatedVariations;
      notification.success(
        'Price sync complete',
        `${total} product price${total !== 1 ? 's' : ''} updated`,
      );
      void loadSync();
    } catch (e) {
      notification.error('Sync failed', getErrorMessage(e, 'Could not run price sync'));
    } finally {
      setRunningSync(false);
    }
  };

  const allEnvVarsSet = status ? Object.values(status.checks || {}).every(Boolean) : false;
  const effectiveFxRate = pricing?.fx?.effective_rate ?? pricing?.fx?.last_fetched_rate ?? null;
  const effectiveFxSource = pricing?.fx?.effective_source ?? 'Not set';
  const healthSummary = status?.connection_tested_at
    ? status.cj_connected
      ? 'CJ API is reachable'
      : 'CJ connection failed — check credentials'
    : status?.configured
      ? 'Credentials configured — run a live test'
      : 'Missing CJ env vars on the server';

  const initialLoad = loading && !status && !pricing;

  return (
    <SettingsSubpage title="Global Sourcing" subtitle="Pricing, FX & provider health">
      {initialLoad ? (
        <div className="flex justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : (
        <div className="space-y-5">
          <SettingsGroup title="Provider health">
            <div className="border-b border-gray-50 px-4 py-3.5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900">{healthSummary}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {allEnvVarsSet ? 'CJ_API_KEY and CJ_API_BASE_URL are set' : 'Set both CJ env vars in Netlify'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={runTestAuth}
                  disabled={testingAuth}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white active:bg-primary-700 disabled:opacity-60"
                >
                  {testingAuth ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Test connection
                </button>
                <button
                  type="button"
                  onClick={() => void loadAuth()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 active:bg-gray-50"
                  aria-label="Refresh status"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>

            {status && (
              <>
                <SettingsRow label="CJ API">
                  <StatusPill tone={connectionTone(status.cj_connected)} label={connectionLabel(status.cj_connected)} />
                </SettingsRow>
                {Object.entries(status.checks || {}).map(([key, ok]) => (
                  <SettingsRow key={key} label={formatEnvKey(key)}>
                    <StatusPill ok={ok} tone={ok ? 'ok' : 'bad'} label={ok ? 'Set' : 'Missing'} />
                  </SettingsRow>
                ))}
                {status.authenticated !== undefined && status.connection_tested_at && (
                  <SettingsRow label="CJ token">
                    <StatusPill ok={!!status.authenticated} label={status.authenticated ? 'Valid' : 'Invalid'} />
                  </SettingsRow>
                )}
                {(status.cj_connection_error && status.cj_connected === false) ||
                status.connection_tested_at ||
                status.expires_at ? (
                  <div className="space-y-1 border-t border-gray-50 px-4 py-3 text-xs text-gray-500">
                    {status.cj_connection_error && status.cj_connected === false && (
                      <p className="text-red-600">{sanitizeSettingsError(status.cj_connection_error)}</p>
                    )}
                    {status.connection_tested_at && (
                      <p>Last tested {formatSettingsDate(status.connection_tested_at)}</p>
                    )}
                    {status.expires_at && <p>Token expires {formatSettingsDate(status.expires_at)}</p>}
                  </div>
                ) : null}
              </>
            )}
          </SettingsGroup>

          <SectionCard
            title="Global pricing defaults"
            subtitle={
              pricing?.updated_at
                ? `Last saved ${formatSettingsDate(pricing.updated_at)}`
                : 'Prefill import form & default pricing rules'
            }
            action={
              <button
                type="button"
                onClick={() => void loadPricing()}
                disabled={loadingPricing}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 active:bg-gray-50"
                aria-label="Refresh pricing"
              >
                <RefreshCw className={`h-4 w-4 ${loadingPricing ? 'animate-spin' : ''}`} />
              </button>
            }
          >
            <div className="space-y-3 px-4 py-3.5">
              <Field label="Default buffer (USD)">
                <input
                  value={importBufferUsd}
                  onChange={(e) => setImportBufferUsd(e.target.value)}
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="Cover FX swings"
                />
              </Field>
              <Field label="Default markup %">
                <input
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(e.target.value)}
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="Margin rule"
                />
              </Field>
              <Field label="Default flat markup (NGN)">
                <input
                  value={markupFlatNgn}
                  onChange={(e) => setMarkupFlatNgn(e.target.value)}
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="Optional uplift"
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="FX rate control"
            subtitle="Provider: exchangerate.host"
            action={
              <button
                type="button"
                onClick={refreshFx}
                disabled={refreshingFx}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 active:bg-gray-50 disabled:opacity-60"
              >
                {refreshingFx ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Fetch live
              </button>
            }
          >
            {pricing?.fx?.effective_note && (
              <p className="border-b border-gray-50 px-4 py-2 text-xs text-amber-700">{pricing.fx.effective_note}</p>
            )}

            <div className="grid grid-cols-2 gap-px bg-gray-100">
              <div className="bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Effective rate</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{effectiveFxRate ?? '—'}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{formatFxSourceLabel(effectiveFxSource)}</p>
              </div>
              <div className="bg-white px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Live fetch</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{pricing?.fx?.last_fetched_rate ?? 'Not fetched'}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{formatSettingsDate(pricing?.fx?.last_fetched_at)}</p>
              </div>
            </div>

            <div className="space-y-3 px-4 py-3.5">
              <label className="flex items-start gap-3 rounded-xl bg-gray-50 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={fxManualOverrideEnabled}
                  onChange={(e) => setFxManualOverrideEnabled(e.target.checked)}
                  className="mt-0.5 h-5 w-5 rounded accent-primary-600"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">Manual USD → NGN override</span>
                  <span className="mt-0.5 block text-xs text-gray-500">Takes precedence over live &amp; cached rates</span>
                </span>
              </label>

              <Field label="Manual rate">
                <input
                  value={fxManualRate}
                  onChange={(e) => setFxManualRate(e.target.value)}
                  className={inputCls}
                  inputMode="decimal"
                  placeholder="Override rate"
                  disabled={!fxManualOverrideEnabled}
                />
              </Field>
              <Field label="Override note">
                <textarea
                  value={fxManualRateNote}
                  onChange={(e) => setFxManualRateNote(e.target.value)}
                  className={`${inputCls} min-h-[72px] resize-y`}
                  placeholder="Parallel market / bank rate note"
                />
              </Field>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={fxLiveApiEnabled}
                  onChange={(e) => setFxLiveApiEnabled(e.target.checked)}
                  className="mt-0.5 h-5 w-5 rounded accent-primary-600"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">Enable live FX fetch</span>
                  <span className="mt-0.5 block text-xs text-gray-500">Disable for manual-only or cached mode</span>
                </span>
              </label>

              {fxManualOverrideEnabled && (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-100">
                  Manual override is enabled — it overrides cached and live FX rates.
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={savePricing}
                  disabled={savingPricing}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white active:bg-primary-700 disabled:opacity-60"
                >
                  {savingPricing ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => pricing && applyForm(pricing)}
                  disabled={!pricing}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 active:bg-gray-50"
                >
                  Reset
                </button>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Price sync log"
            subtitle="Auto-updates when USD/NGN moves ≥3%"
            action={
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => void loadSync()}
                  disabled={loadingSync}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 active:bg-gray-50"
                  aria-label="Refresh sync log"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingSync ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={runSync}
                  disabled={runningSync}
                  className="flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white active:bg-primary-700 disabled:opacity-60"
                >
                  {runningSync ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Sync
                </button>
              </div>
            }
          >
            <div className="space-y-3 px-4 py-3.5">
              {fxSync && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Last sync rate</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">
                      {fxSync.last_sync_rate != null ? `₦${Number(fxSync.last_sync_rate).toLocaleString()}` : 'Never'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Last run</p>
                    <p className="mt-1 text-xs font-semibold text-gray-900">{formatSettingsDate(fxSync.last_sync_at)}</p>
                  </div>
                </div>
              )}

              {loadingSync && !fxSync?.logs?.length ? (
                <div className="flex justify-center py-6">
                  <Loader className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : fxSync?.logs && fxSync.logs.length > 0 ? (
                <div className="space-y-2">
                  {fxSync.logs.map((entry, index) => {
                    const total = entry.updated_simple + entry.updated_variations;
                    const hasErrors = entry.errors && entry.errors.length > 0;
                    const changePct = syncChangePct(entry, fxSync.logs[index + 1]);
                    return (
                      <div key={entry.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
                              {formatSyncReason(entry.reason)}
                            </span>
                            <p className="mt-1 text-[11px] text-gray-500">{formatSettingsDate(entry.created_at)}</p>
                          </div>
                          {hasErrors ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-red-600">
                              <XCircle className="h-3.5 w-3.5" /> Errors
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                              <CheckCircle className="h-3.5 w-3.5" /> OK
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700">
                          <span>
                            <span className="text-gray-500">Rate:</span> ₦{Number(entry.rate_used).toLocaleString()}
                          </span>
                          {changePct != null && Number.isFinite(changePct) && (
                            <span className={Math.abs(changePct) >= 3 ? 'font-medium text-amber-600' : ''}>
                              Δ {changePct > 0 ? '+' : ''}
                              {changePct.toFixed(2)}%
                            </span>
                          )}
                          <span>
                            <span className="text-gray-500">Updated:</span> {total} ({entry.updated_simple}S /{' '}
                            {entry.updated_variations}V)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-xs text-gray-400">
                  No sync runs yet
                </p>
              )}
            </div>
          </SectionCard>

          <div className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Landed pricing includes CJ freight-to-hub quoting. Sourced sub-orders can auto-place supplier orders in CJ;
              final-mile delivery stays in JLO.
            </p>
          </div>
        </div>
      )}
    </SettingsSubpage>
  );
}
