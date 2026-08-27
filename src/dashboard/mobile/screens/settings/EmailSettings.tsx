import { useCallback, useEffect, useState } from 'react';
import { Bell, Key, Loader, Mail, Plus, RefreshCw, Save, Send, Shield, Trash2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { PullToRefresh } from '../../PullToRefresh';
import {
  Field,
  SectionCard,
  SettingsGroup,
  SettingsRow,
  SettingsSubpage,
  StatusPill,
  inputCls,
} from '../../components/SettingsParts';
import { fetchEmailConfig, saveEmailConfig, sendTestEmail, type EmailConfig } from '../../lib/settingsApi';

const defaultConfig: EmailConfig = {
  provider: 'gmail',
  gmail_user: '',
  gmail_password: '',
  sendgrid_api_key: '',
  resend_api_key: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_password: '',
  email_from: '',
  email_enabled: true,
  portal_url: '',
  order_alert_emails: [],
};

const PROVIDERS: { value: EmailConfig['provider']; label: string }[] = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'sendgrid', label: 'SendGrid' },
  { value: 'smtp', label: 'SMTP' },
];

function providerSecretsConfigured(config: EmailConfig) {
  if (config.secrets_configured?.resend_api_key || config.resend_api_key) return true;
  switch (config.provider) {
    case 'gmail':
      return Boolean(config.secrets_configured?.gmail_password);
    case 'sendgrid':
      return Boolean(config.secrets_configured?.sendgrid_api_key);
    case 'smtp':
      return Boolean(config.secrets_configured?.smtp_password);
    default:
      return false;
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
  );
}

export default function MobileEmailSettings() {
  const { session } = useAuth();
  const notification = useNotification();
  const [config, setConfig] = useState<EmailConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [newAlertEmail, setNewAlertEmail] = useState('');

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      else setRefreshing(true);
      try {
        const data = await fetchEmailConfig();
        setConfig({
          ...defaultConfig,
          ...data,
          provider: data.provider === 'resend' ? 'smtp' : data.provider,
          order_alert_emails: Array.isArray(data.order_alert_emails) ? data.order_alert_emails : [],
        });
        if (data.gmail_user) setTestTo(data.gmail_user);
      } catch {
        notification.error('Load failed', 'Could not load email config');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notification],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    try {
      await saveEmailConfig(config, session.access_token);
      notification.success('Saved', 'Email configuration updated');
      void load(true);
    } catch (e) {
      notification.error('Save failed', e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!session?.access_token || !testTo.trim()) return;
    setTesting(true);
    try {
      await sendTestEmail(testTo.trim(), session.access_token);
      notification.success('Sent', `Test email sent to ${testTo}`);
    } catch (e) {
      notification.error('Send failed', e instanceof Error ? e.message : 'Test email failed');
    } finally {
      setTesting(false);
    }
  };

  const addAlertEmail = () => {
    const email = newAlertEmail.trim().toLowerCase();
    if (!email) return;
    if (config.order_alert_emails.includes(email)) {
      notification.error('Duplicate', 'That address is already on the list');
      return;
    }
    setConfig((c) => ({ ...c, order_alert_emails: [...c.order_alert_emails, email] }));
    setNewAlertEmail('');
  };

  const removeAlertEmail = (index: number) => {
    setConfig((c) => ({
      ...c,
      order_alert_emails: c.order_alert_emails.filter((_, i) => i !== index),
    }));
  };

  const secretsReady = providerSecretsConfigured(config);
  const alertCount = config.order_alert_emails?.length ?? 0;

  return (
    <SettingsSubpage title="Email" subtitle="Provider, alerts & test send">
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
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50">
                    <Mail className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold capitalize text-gray-900">
                      {config.secrets_configured?.resend_api_key ? 'Resend (operational)' : `${config.provider} fallback`}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {config.email_enabled ? 'Outbound email enabled' : 'Outbound email disabled'}
                      {secretsReady ? ' · credentials saved' : ' · credentials needed'}
                      {' · auth stays on Supabase SMTP'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void load(true)}
                    disabled={refreshing}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-gray-50"
                    aria-label="Refresh email config"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              <SettingsRow label="Delivery">
                <div className="flex items-center gap-2">
                  <StatusPill ok={config.email_enabled} label={config.email_enabled ? 'On' : 'Off'} />
                  <MobileToggle
                    checked={config.email_enabled}
                    label="Toggle outbound email"
                    onChange={(enabled) => setConfig((c) => ({ ...c, email_enabled: enabled }))}
                  />
                </div>
              </SettingsRow>
              <SettingsRow label="Secrets">
                <StatusPill ok={secretsReady} tone={secretsReady ? 'ok' : 'warn'} label={secretsReady ? 'Saved' : 'Missing'} />
              </SettingsRow>
              <SettingsRow label="Order alerts">
                <StatusPill ok={alertCount > 0} tone={alertCount > 0 ? 'ok' : 'neutral'} label={`${alertCount} recipient${alertCount === 1 ? '' : 's'}`} />
              </SettingsRow>
            </SettingsGroup>

            <SectionCard title="Provider & credentials">
              <div className="space-y-3 px-4 py-3.5">
                <p className="text-xs text-gray-500">
                  Resend key below sends operational mail (orders, vendor activation, Skola bulk).
                  Auth invites and password resets stay on Supabase Custom SMTP.
                </p>
                <Field label="Fallback provider">
                  <div className="grid grid-cols-2 gap-2">
                    {PROVIDERS.map(({ value, label }) => {
                      const active = config.provider === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setConfig((c) => ({ ...c, provider: value }))}
                          className={`rounded-xl border py-2.5 text-sm font-semibold transition-colors ${
                            active
                              ? 'border-primary-600 bg-primary-50 text-primary-800 ring-1 ring-primary-100'
                              : 'border-gray-200 bg-white text-gray-700 active:bg-gray-50'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <div className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-xs text-gray-600">
                  <Key className="h-4 w-4 shrink-0" />
                  Leave secret fields blank to keep existing values
                </div>

                <Field label="From address">
                  <input
                    type="email"
                    value={config.email_from}
                    onChange={(e) => setConfig((c) => ({ ...c, email_from: e.target.value }))}
                    className={inputCls}
                    placeholder="noreply@julinemart.com"
                  />
                </Field>

                {config.provider === 'gmail' && (
                  <>
                    <Field label="Gmail address">
                      <input
                        type="email"
                        value={config.gmail_user}
                        onChange={(e) => setConfig((c) => ({ ...c, gmail_user: e.target.value }))}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="App password">
                      <input
                        type="password"
                        value={config.gmail_password}
                        onChange={(e) => setConfig((c) => ({ ...c, gmail_password: e.target.value }))}
                        className={inputCls}
                        placeholder={config.secrets_configured?.gmail_password ? 'Leave blank to keep existing' : ''}
                        autoComplete="new-password"
                      />
                    </Field>
                  </>
                )}

                {config.provider === 'sendgrid' && (
                  <Field label="SendGrid API key">
                    <input
                      type="password"
                      value={config.sendgrid_api_key}
                      onChange={(e) => setConfig((c) => ({ ...c, sendgrid_api_key: e.target.value }))}
                      className={inputCls}
                      placeholder={config.secrets_configured?.sendgrid_api_key ? 'Leave blank to keep existing' : ''}
                      autoComplete="new-password"
                    />
                  </Field>
                )}

                <Field label="Resend API key (operational mail)">
                  <input
                    type="password"
                    value={config.resend_api_key}
                    onChange={(e) => setConfig((c) => ({ ...c, resend_api_key: e.target.value }))}
                    className={inputCls}
                    placeholder={config.secrets_configured?.resend_api_key ? 'Leave blank to keep existing' : 're_…'}
                    autoComplete="new-password"
                  />
                </Field>

                {config.provider === 'smtp' && (
                  <>
                    <Field label="SMTP host">
                      <input
                        value={config.smtp_host}
                        onChange={(e) => setConfig((c) => ({ ...c, smtp_host: e.target.value }))}
                        className={inputCls}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Port">
                        <input
                          type="number"
                          value={config.smtp_port}
                          onChange={(e) => setConfig((c) => ({ ...c, smtp_port: Number(e.target.value) }))}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="User">
                        <input
                          value={config.smtp_user}
                          onChange={(e) => setConfig((c) => ({ ...c, smtp_user: e.target.value }))}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                    <Field label="SMTP password">
                      <input
                        type="password"
                        value={config.smtp_password}
                        onChange={(e) => setConfig((c) => ({ ...c, smtp_password: e.target.value }))}
                        className={inputCls}
                        placeholder={config.secrets_configured?.smtp_password ? 'Leave blank to keep existing' : ''}
                        autoComplete="new-password"
                      />
                    </Field>
                  </>
                )}

                <Field label="Portal URL">
                  <input
                    value={config.portal_url}
                    onChange={(e) => setConfig((c) => ({ ...c, portal_url: e.target.value }))}
                    className={inputCls}
                    placeholder="https://…"
                  />
                </Field>
              </div>
            </SectionCard>

            <SectionCard title="Order alert recipients" subtitle="Notified on new customer orders">
              <div className="space-y-3 px-4 py-3.5">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Bell className="h-4 w-4 shrink-0 text-primary-600" />
                  Staff inboxes for new order notifications
                </div>

                {(config.order_alert_emails ?? []).length === 0 ? (
                  <p className="rounded-xl border border-dashed border-gray-200 py-5 text-center text-xs text-gray-400">
                    No recipients yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {config.order_alert_emails.map((email, idx) => (
                      <div
                        key={`${email}-${idx}`}
                        className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2.5 ring-1 ring-gray-100"
                      >
                        <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{email}</span>
                        <button
                          type="button"
                          onClick={() => removeAlertEmail(idx)}
                          className="rounded-lg p-2 text-gray-400 active:bg-red-50 active:text-red-600"
                          aria-label={`Remove ${email}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="email"
                    value={newAlertEmail}
                    onChange={(e) => setNewAlertEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addAlertEmail();
                      }
                    }}
                    placeholder="staff@julinemart.com"
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                  <button
                    type="button"
                    onClick={addAlertEmail}
                    className="flex shrink-0 items-center gap-1 rounded-xl bg-primary-600 px-3 py-3 text-sm font-semibold text-white active:bg-primary-700"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Send test email">
              <div className="space-y-3 px-4 py-3.5">
                <Field label="Recipient">
                  <input
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    className={inputCls}
                    placeholder="you@company.com"
                  />
                </Field>
                <button
                  type="button"
                  onClick={sendTest}
                  disabled={testing || !testTo.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-800 active:bg-gray-50 disabled:opacity-60"
                >
                  {testing ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send test
                </button>
              </div>
            </SectionCard>

            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white active:bg-primary-700 disabled:opacity-60"
            >
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save configuration
            </button>

            {config.email_secrets_encryption_active === false && (
              <div className="flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-100">
                <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Email secrets encryption is not active. Set EMAIL_SECRETS_ENCRYPTION_KEY in production.</p>
              </div>
            )}
          </div>
        </PullToRefresh>
      )}
    </SettingsSubpage>
  );
}
