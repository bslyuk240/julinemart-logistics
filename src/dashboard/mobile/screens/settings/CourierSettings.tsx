import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle,
  ChevronRight,
  Key,
  Loader,
  RefreshCw,
  Save,
  Shield,
  Truck,
  Zap,
} from 'lucide-react';
import { useNotification } from '../../../contexts/NotificationContext';
import { PullToRefresh } from '../../PullToRefresh';
import { Sheet } from '../../Sheet';
import {
  Field,
  SectionCard,
  SettingsGroup,
  SettingsRow,
  SettingsSubpage,
  StatusPill,
  inputCls,
} from '../../components/SettingsParts';
import {
  fetchCourierSettings,
  saveCourierCredentials,
  type CourierSettingsRow,
} from '../../lib/settingsApi';

type CredForm = { api_user_id: string; api_password: string; api_base_url: string };

const FEZ_SANDBOX = 'https://apisandbox.fezdelivery.co/v1';
const FEZ_PRODUCTION = 'https://api.fezdelivery.co/v1';

function isProductionUrl(url: string) {
  return url.includes('api.fezdelivery.co') && !url.includes('sandbox');
}

function envLabel(url: string) {
  return isProductionUrl(url) ? 'Production' : 'Sandbox';
}

function hasStoredCredentials(courier: CourierSettingsRow) {
  return Boolean(courier.api_user_id?.trim() && courier.api_password);
}

function courierAccent(code: string) {
  switch (code) {
    case 'FEZ':
      return 'bg-gradient-to-br from-blue-500 to-indigo-600';
    case 'GIGL':
      return 'bg-gradient-to-br from-orange-500 to-amber-600';
    case 'KWIK':
      return 'bg-gradient-to-br from-violet-500 to-purple-600';
    default:
      return 'bg-gradient-to-br from-slate-500 to-slate-700';
  }
}

function MobileToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-gray-200'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
      <span className="text-xs font-medium text-gray-600">{checked ? 'API on' : 'API off'}</span>
    </label>
  );
}

export default function MobileCourierSettings() {
  const notification = useNotification();
  const [rows, setRows] = useState<CourierSettingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<CourierSettingsRow | null>(null);
  const [creds, setCreds] = useState<Record<string, CredForm>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await fetchCourierSettings();
      setRows(data);
      const initial: Record<string, CredForm> = {};
      for (const c of data) {
        initial[c.id] = {
          api_user_id: c.api_user_id || '',
          api_password: c.api_password ? '••••••••••••' : '',
          api_base_url: c.api_base_url || FEZ_SANDBOX,
        };
      }
      setCreds(initial);
    } catch {
      notification.error('Load failed', 'Unable to fetch courier settings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [notification]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleApi = async (courier: CourierSettingsRow, enabled: boolean) => {
    try {
      await saveCourierCredentials(courier.id, { api_enabled: enabled });
      notification.success(enabled ? 'API enabled' : 'API disabled', courier.name);
      void load(true);
    } catch (e) {
      notification.error('Update failed', e instanceof Error ? e.message : 'Could not update');
    }
  };

  const save = async () => {
    if (!selected) return;
    const form = creds[selected.id];
    setSaving(true);
    try {
      const payload: Record<string, string | boolean> = { api_base_url: form.api_base_url };
      if (form.api_user_id) payload.api_user_id = form.api_user_id;
      if (form.api_password && !form.api_password.includes('•')) payload.api_password = form.api_password;
      await saveCourierCredentials(selected.id, payload);
      notification.success('Saved', `${selected.name} credentials updated`);
      setSelected(null);
      void load(true);
    } catch (e) {
      notification.error('Save failed', e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!selected) return;
    const form = creds[selected.id];
    if (!form.api_user_id || !form.api_password || form.api_password.includes('•')) {
      notification.error('Missing credentials', 'Enter user ID and password first');
      return;
    }
    setTesting(true);
    try {
      const data = await saveCourierCredentials(
        selected.id,
        {
          action: 'test_connection',
          api_user_id: form.api_user_id,
          api_password: form.api_password,
          api_base_url: form.api_base_url,
        },
        'POST',
      );
      if (data.success) {
        notification.success('Connected', data.orgName ? `Linked to ${data.orgName}` : 'Connection OK');
      } else {
        notification.error('Failed', data.message || 'Could not connect');
      }
    } catch (e) {
      notification.error('Test failed', e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const enabledCount = rows.filter((r) => r.api_enabled).length;
  const configuredCount = rows.filter((r) => hasStoredCredentials(r)).length;

  return (
    <>
      <SettingsSubpage title="Courier APIs" subtitle="Fez, GIGL & partner integrations">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : (
          <PullToRefresh onRefresh={() => load(true)}>
            <div className="space-y-5">
              <SettingsGroup title="Overview">
                <div className="border-b border-gray-50 px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50">
                      <Truck className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {enabledCount} of {rows.length} couriers API-enabled
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {configuredCount} configured · credentials encrypted at rest
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void load(true)}
                      disabled={refreshing}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-gray-50"
                      aria-label="Refresh couriers"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              </SettingsGroup>

              <SettingsGroup title="Couriers">
                {rows.map((courier) => {
                  const configured = hasStoredCredentials(courier);
                  return (
                    <button
                      key={courier.id}
                      type="button"
                      onClick={() => setSelected(courier)}
                      className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3.5 text-left last:border-b-0 active:bg-gray-50"
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${courierAccent(courier.code)}`}
                      >
                        <Truck className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{courier.name}</p>
                          {courier.api_enabled && (
                            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {courier.code}
                          {courier.api_base_url ? ` · ${envLabel(courier.api_base_url)}` : ''}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {courier.supports_live_tracking && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                              Tracking
                            </span>
                          )}
                          {courier.supports_label_generation && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                              Labels
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <StatusPill
                          ok={courier.api_enabled}
                          tone={courier.api_enabled ? 'ok' : 'neutral'}
                          label={courier.api_enabled ? 'On' : 'Off'}
                        />
                        <StatusPill
                          ok={configured}
                          tone={configured ? 'ok' : 'warn'}
                          label={configured ? 'Ready' : 'Setup'}
                        />
                        <ChevronRight className="h-4 w-4 text-gray-300" />
                      </div>
                    </button>
                  );
                })}
              </SettingsGroup>

              <div className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-100">
                <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  API keys are encrypted before storage. Disable API access immediately if credentials may be
                  compromised.
                </p>
              </div>
            </div>
          </PullToRefresh>
        )}
      </SettingsSubpage>

      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Courier credentials">
        {selected && creds[selected.id] && (
          <div className="space-y-4 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${courierAccent(selected.code)}`}
                >
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                  <p className="text-xs text-gray-500">{selected.code}</p>
                </div>
              </div>
              <MobileToggle
                checked={selected.api_enabled}
                label={`Toggle ${selected.name} API`}
                onChange={(enabled) => {
                  void toggleApi(selected, enabled);
                  setSelected({ ...selected, api_enabled: enabled });
                }}
              />
            </div>

            <SectionCard title="Capabilities">
              <SettingsRow label="Live tracking">
                <StatusPill
                  ok={selected.supports_live_tracking}
                  label={selected.supports_live_tracking ? 'Supported' : 'No'}
                />
              </SettingsRow>
              <SettingsRow label="Label generation">
                <StatusPill
                  ok={selected.supports_label_generation}
                  label={selected.supports_label_generation ? 'Supported' : 'No'}
                />
              </SettingsRow>
              <SettingsRow label="Stored credentials">
                <StatusPill
                  ok={hasStoredCredentials(selected)}
                  tone={hasStoredCredentials(selected) ? 'ok' : 'warn'}
                  label={hasStoredCredentials(selected) ? 'Configured' : 'Not set'}
                />
              </SettingsRow>
            </SectionCard>

            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-xs text-gray-600">
                <Key className="h-4 w-4 shrink-0" />
                Encrypted storage · leave password blank to keep existing value
              </div>

              <Field label="Environment">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: FEZ_SANDBOX, label: 'Sandbox', hint: 'Testing' },
                    { value: FEZ_PRODUCTION, label: 'Production', hint: 'Live orders' },
                  ].map(({ value, label, hint }) => {
                    const active = creds[selected.id].api_base_url === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setCreds((prev) => ({
                            ...prev,
                            [selected.id]: { ...prev[selected.id], api_base_url: value },
                          }))
                        }
                        className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'border-primary-600 bg-primary-50 ring-1 ring-primary-100'
                            : 'border-gray-200 bg-white active:bg-gray-50'
                        }`}
                      >
                        <p className={`text-sm font-semibold ${active ? 'text-primary-800' : 'text-gray-900'}`}>
                          {label}
                        </p>
                        <p className="text-[11px] text-gray-500">{hint}</p>
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="User ID">
                <input
                  value={creds[selected.id].api_user_id}
                  onChange={(e) =>
                    setCreds((prev) => ({
                      ...prev,
                      [selected.id]: { ...prev[selected.id], api_user_id: e.target.value },
                    }))
                  }
                  placeholder="e.g. G-4568-3493"
                  className={inputCls}
                  autoComplete="off"
                />
                {selected.api_user_id && (
                  <p className="mt-1 text-[11px] text-gray-400">Saved: {selected.api_user_id}</p>
                )}
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  value={creds[selected.id].api_password}
                  onChange={(e) =>
                    setCreds((prev) => ({
                      ...prev,
                      [selected.id]: { ...prev[selected.id], api_password: e.target.value },
                    }))
                  }
                  placeholder={selected.api_password ? 'Enter new password to update' : 'API password'}
                  className={inputCls}
                  autoComplete="new-password"
                />
              </Field>
            </div>

            {selected.code === 'FEZ' && (
              <div className="rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-100">
                <p className="text-xs font-semibold text-gray-900">Getting Fez credentials</p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-gray-600">
                  <li>
                    Email{' '}
                    <a href="mailto:support@fezdelivery.co" className="font-medium text-primary-600">
                      support@fezdelivery.co
                    </a>
                  </li>
                  <li>Request corporate API credentials for integration</li>
                  <li>Test connection, then save</li>
                </ol>
              </div>
            )}

            <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-100 bg-white px-4 pt-3">
              <button
                type="button"
                onClick={testConnection}
                disabled={testing}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-800 active:bg-gray-50 disabled:opacity-60"
              >
                {testing ? <Loader className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Test
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white active:bg-primary-700 disabled:opacity-60"
              >
                {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
