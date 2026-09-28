import { useEffect, useState } from 'react';
import {
  fetchShippingProviders,
  updateShippingProvider,
  type ShippingProvider,
} from '../lib/shippingQuotesApi';

type Props = {
  getAuthHeaders: () => HeadersInit | Promise<HeadersInit>;
  compact?: boolean;
};

export function ShippingProvidersPanel({ getAuthHeaders, compact }: Props) {
  const [rows, setRows] = useState<ShippingProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [sandboxKey, setSandboxKey] = useState('');
  const [liveKey, setLiveKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderPhone, setSenderPhone] = useState('');

  const load = async () => {
    try {
      const headers = await getAuthHeaders();
      const data = await fetchShippingProviders(headers);
      setRows(data);
      const shipbubble = data.find((row) => row.code === 'shipbubble');
      if (shipbubble) {
        setCategoryId(shipbubble.config?.category_id || '');
        setSenderEmail(shipbubble.config?.sender_email || '');
        setSenderPhone(shipbubble.config?.sender_phone || '');
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load shipping providers');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (code: string, payload: Parameters<typeof updateShippingProvider>[0]) => {
    setSaving(code);
    try {
      const headers = await getAuthHeaders();
      const updated = await updateShippingProvider({ code, ...payload }, headers);
      setRows((prev) => prev.map((row) => (row.code === code ? { ...row, ...updated } : row)));
      if (code === 'shipbubble') {
        setSandboxKey('');
        setLiveKey('');
        setWebhookSecret('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    } finally {
      setSaving(null);
    }
  };

  const saveShipbubble = async () => {
    await patch('shipbubble', {
      code: 'shipbubble',
      sandbox_api_key: sandboxKey,
      live_api_key: liveKey,
      webhook_secret: webhookSecret,
      category_id: categoryId,
      sender_email: senderEmail,
      sender_phone: senderPhone,
    });
  };

  return (
    <div className={`rounded-lg border border-gray-200 bg-white ${compact ? 'p-3' : 'p-5'} mb-6`}>
      <h2 className="text-lg font-bold text-gray-900">Shipping Providers</h2>
      <p className="mt-1 text-sm text-gray-600">
        Customers only see JLO Shipping. FEZ and Shipbubble credentials are stored encrypted in the database,
        the same way courier APIs are saved — they are never sent to the browser after save.
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.code} className="rounded-md border border-gray-100 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">{row.name}</p>
                <p className="text-xs text-gray-500">
                  Status: {row.enabled ? 'Enabled' : 'Disabled'} · Environment: {row.environment}
                  {row.has_credentials ? '' : ' · credentials missing'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={row.environment}
                  disabled={saving === row.code}
                  onChange={(e) => patch(row.code, { code: row.code, environment: e.target.value as 'sandbox' | 'production' })}
                  className="rounded border px-2 py-1 text-sm"
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
                <button
                  type="button"
                  disabled={saving === row.code}
                  onClick={() => patch(row.code, { code: row.code, enabled: !row.enabled })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    row.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {row.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>

            {row.code === 'shipbubble' && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-gray-700">
                  <span className="mb-1 block font-semibold">Sandbox API key {row.has_sandbox_key ? '(saved)' : ''}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={sandboxKey}
                    onChange={(e) => setSandboxKey(e.target.value)}
                    placeholder={row.has_sandbox_key ? '••••••••••••' : 'sb_sandbox_…'}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-700">
                  <span className="mb-1 block font-semibold">Production API key {row.has_live_key ? '(saved)' : ''}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={liveKey}
                    onChange={(e) => setLiveKey(e.target.value)}
                    placeholder={row.has_live_key ? '••••••••••••' : 'sb_prod_…'}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-700">
                  <span className="mb-1 block font-semibold">Webhook secret {row.has_webhook_secret ? '(saved)' : '(optional)'}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    placeholder="Leave blank to use the active API key"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-700">
                  <span className="mb-1 block font-semibold">Category ID (optional)</span>
                  <input
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    placeholder="Leave blank to auto-pick"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-700">
                  <span className="mb-1 block font-semibold">Sender email</span>
                  <input
                    type="email"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    placeholder="shipping@julinemart.com"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs text-gray-700">
                  <span className="mb-1 block font-semibold">Sender phone</span>
                  <input
                    value={senderPhone}
                    onChange={(e) => setSenderPhone(e.target.value)}
                    placeholder="080…"
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    disabled={saving === 'shipbubble'}
                    onClick={saveShipbubble}
                  >
                    {saving === 'shipbubble' ? 'Saving…' : 'Save Shipbubble credentials'}
                  </button>
                </div>
              </div>
            )}

            {row.code === 'fez' && (
              <p className="mt-2 text-xs text-gray-500">
                FEZ user ID, password and sandbox/production URL are still managed in the courier card below.
              </p>
            )}
          </div>
        ))}
        {rows.length === 0 && !error && (
          <p className="text-sm text-gray-500">No shipping providers found. Apply the multi-carrier migration first.</p>
        )}
      </div>
    </div>
  );
}
