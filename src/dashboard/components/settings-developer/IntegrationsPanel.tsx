import { useEffect, useState, useCallback } from 'react';
import { Check, Copy, Plus, Trash2, AlertTriangle, Globe, Key, Webhook } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { buildApiUrl } from '../../lib/settingsDeveloperUtils';

const CAPABILITIES = ['orders:read', 'shipments:read', 'vendors:read', 'riders:read', 'shipment_notes:write'];
const EVENT_TYPES = ['order.updated', 'shipment.delayed'];

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  secret_configured: boolean;
  created_at: string;
}

async function callAdminApi(session: any, path: string, method: string, body?: object) {
  const token = session?.access_token || '';
  const res = await fetch(buildApiUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

interface IntegrationsPanelProps {
  compact?: boolean;
}

export function IntegrationsPanel({ compact = false }: IntegrationsPanelProps) {
  const { session } = useAuth();
  const notification = useNotification();
  const serviceApiBaseUrl = buildApiUrl('/api/v1');

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [mintedToken, setMintedToken] = useState<{ name: string; token: string } | null>(null);

  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookName, setWebhookName] = useState('skola_workforce');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [webhookEventTypes, setWebhookEventTypes] = useState<string[]>([]);
  const [savingWebhook, setSavingWebhook] = useState(false);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, hooksRes] = await Promise.all([
        callAdminApi(session, '/api/admin/service-api-keys', 'GET'),
        callAdminApi(session, '/api/admin/webhook-endpoints', 'GET'),
      ]);
      setKeys(keysRes.data || []);
      setWebhooks(hooksRes.data || []);
    } catch (e) {
      notification.error('Failed to load', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleScope = (scope: string) => {
    setNewKeyScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const toggleEventType = (evt: string) => {
    setWebhookEventTypes((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  };

  const createKey = async () => {
    if (!newKeyName.trim() || newKeyScopes.length === 0) {
      notification.error('Missing info', 'Name and at least one capability are required');
      return;
    }
    setCreatingKey(true);
    try {
      const res = await callAdminApi(session, '/api/admin/service-api-keys', 'POST', {
        name: newKeyName.trim(),
        scopes: newKeyScopes,
      });
      setMintedToken({ name: res.data.name, token: res.data.token });
      setNewKeyName('');
      setNewKeyScopes([]);
      await load();
    } catch (e) {
      notification.error('Failed to create key', e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeKey = async (id: string, name: string) => {
    if (!window.confirm(`Revoke "${name}"? Any integration using this key will lose access immediately.`)) return;
    try {
      await callAdminApi(session, `/api/admin/service-api-keys/${id}`, 'DELETE');
      notification.success('Revoked', `"${name}" can no longer authenticate`);
      await load();
    } catch (e) {
      notification.error('Failed to revoke', e instanceof Error ? e.message : String(e));
    }
  };

  const saveWebhook = async () => {
    if (!webhookName.trim() || !webhookUrl.trim() || !webhookSecret.trim()) {
      notification.error('Missing info', 'Name, URL, and secret are required');
      return;
    }
    setSavingWebhook(true);
    try {
      await callAdminApi(session, '/api/admin/webhook-endpoints', 'POST', {
        name: webhookName.trim(),
        url: webhookUrl.trim(),
        secret: webhookSecret.trim(),
        event_types: webhookEventTypes,
      });
      notification.success('Webhook saved', `Events will be pushed to ${webhookUrl.trim()}`);
      setShowWebhookForm(false);
      setWebhookUrl('');
      setWebhookSecret('');
      setWebhookEventTypes([]);
      await load();
    } catch (e) {
      notification.error('Failed to save webhook', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingWebhook(false);
    }
  };

  const toggleWebhookActive = async (row: WebhookRow) => {
    try {
      await callAdminApi(session, `/api/admin/webhook-endpoints/${row.id}`, 'PATCH', { is_active: !row.is_active });
      await load();
    } catch (e) {
      notification.error('Failed to update', e instanceof Error ? e.message : String(e));
    }
  };

  const deleteWebhook = async (row: WebhookRow) => {
    if (!window.confirm(`Delete the "${row.name}" webhook? This cannot be undone.`)) return;
    try {
      await callAdminApi(session, `/api/admin/webhook-endpoints/${row.id}`, 'DELETE');
      notification.success('Deleted', `"${row.name}" removed`);
      await load();
    } catch (e) {
      notification.error('Failed to delete', e instanceof Error ? e.message : String(e));
    }
  };

  const cardClass = compact ? 'overflow-hidden rounded-2xl bg-white ring-1 ring-gray-100' : 'card';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className={cardClass}>
        <div className={compact ? 'border-b border-gray-50 px-4 py-3' : 'mb-4'}>
          <h2 className="font-bold text-gray-900 flex items-center gap-2 text-sm sm:text-lg">
            <Key className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600" />
            Service API keys
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Bearer tokens for external Custom API integrations (e.g. Skola Workforce). Each key is scoped to specific
            capabilities and can be revoked independently at any time.
          </p>
        </div>

        <div className={compact ? 'p-4 space-y-3' : 'space-y-3'}>
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-gray-400" />
              Base URL — hand this to the integrator along with the token
            </p>
            <div className="mt-2 flex gap-2">
              <input readOnly value={serviceApiBaseUrl} className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded font-mono text-xs bg-white" />
              <button type="button" onClick={() => copy(serviceApiBaseUrl, 'base_url')} className="btn-secondary text-xs shrink-0">
                {copiedItem === 'base_url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">e.g. <code className="font-mono">{serviceApiBaseUrl}/orders</code></p>
          </div>

          {mintedToken ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Copy this token now — it will not be shown again
              </p>
              <p className="text-xs text-amber-800 mt-1">"{mintedToken.name}"</p>
              <div className="mt-2 flex gap-2">
                <input readOnly value={mintedToken.token} className="flex-1 min-w-0 px-2 py-1.5 border border-amber-300 rounded font-mono text-xs bg-white" />
                <button type="button" onClick={() => copy(mintedToken.token, 'token')} className="btn-secondary text-xs shrink-0">
                  {copiedItem === 'token' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button type="button" onClick={() => setMintedToken(null)} className="text-xs text-amber-700 underline mt-2">
                Done, dismiss
              </button>
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-gray-500">No API keys yet.</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {keys.map((k) => (
                <div key={k.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      {k.name}
                      {!k.is_active ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Revoked</span> : null}
                    </p>
                    <p className="text-xs font-mono text-gray-500 mt-0.5">{k.key_prefix}…</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 font-mono">{s}</span>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleString()}` : ' · never used'}
                    </p>
                  </div>
                  {k.is_active ? (
                    <button type="button" onClick={() => void revokeKey(k.id, k.name)} className="btn-secondary btn-sm text-xs text-red-600 shrink-0 flex items-center gap-1">
                      <Trash2 className="w-3.5 h-3.5" />
                      Revoke
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">New key</p>
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Skola Workforce"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <div className="flex flex-wrap gap-2">
              {CAPABILITIES.map((cap) => (
                <label key={cap} className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1">
                  <input type="checkbox" checked={newKeyScopes.includes(cap)} onChange={() => toggleScope(cap)} />
                  <span className="font-mono">{cap}</span>
                </label>
              ))}
            </div>
            <button type="button" onClick={() => void createKey()} disabled={creatingKey} className="btn-primary btn-sm text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" />
              {creatingKey ? 'Creating…' : 'Create key'}
            </button>
          </div>
        </div>
      </div>

      <div className={cardClass}>
        <div className={compact ? 'border-b border-gray-50 px-4 py-3' : 'mb-4'}>
          <h2 className="font-bold text-gray-900 flex items-center gap-2 text-sm sm:text-lg">
            <Webhook className="w-4 h-4 sm:w-5 sm:h-5 text-primary-600" />
            Outbound webhooks
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Push events (order.updated, shipment.delayed) to an external system. The secret is encrypted at rest and
            never shown again after saving.
          </p>
        </div>

        <div className={compact ? 'p-4 space-y-3' : 'space-y-3'}>
          {webhooks.length === 0 ? (
            <p className="text-sm text-gray-500">No webhook configured.</p>
          ) : (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {webhooks.map((w) => (
                <div key={w.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      {w.name}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${w.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {w.is_active ? 'Active' : 'Paused'}
                      </span>
                    </p>
                    <p className="text-xs font-mono text-gray-500 mt-0.5 break-all">{w.url}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Events: {w.event_types.length ? w.event_types.join(', ') : 'all'} · secret {w.secret_configured ? 'configured' : 'missing'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button type="button" onClick={() => void toggleWebhookActive(w)} className="btn-secondary btn-sm text-xs">
                      {w.is_active ? 'Pause' : 'Resume'}
                    </button>
                    <button type="button" onClick={() => void deleteWebhook(w)} className="btn-secondary btn-sm text-xs text-red-600">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showWebhookForm ? (
            <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2">
              <input value={webhookName} onChange={(e) => setWebhookName(e.target.value)} placeholder="Name (e.g. skola_workforce)" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://…" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
              <input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="Signing secret" type="password" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((evt) => (
                  <label key={evt} className="flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1">
                    <input type="checkbox" checked={webhookEventTypes.includes(evt)} onChange={() => toggleEventType(evt)} />
                    <span className="font-mono">{evt}</span>
                  </label>
                ))}
                <span className="text-[11px] text-gray-400 self-center">(none checked = subscribe to all)</span>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => void saveWebhook()} disabled={savingWebhook} className="btn-primary btn-sm text-xs">
                  {savingWebhook ? 'Saving…' : 'Save webhook'}
                </button>
                <button type="button" onClick={() => setShowWebhookForm(false)} className="btn-secondary btn-sm text-xs">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setShowWebhookForm(true)} className="btn-secondary btn-sm text-xs flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" />
              Add webhook
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
