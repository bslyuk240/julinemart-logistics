import { useEffect, useState } from 'react';
import { fetchShippingProviders, updateShippingProvider } from '../lib/shippingQuotesApi';

type Provider = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  environment: 'sandbox' | 'production';
  has_credentials: boolean;
};

type Props = {
  getAuthHeaders: () => HeadersInit | Promise<HeadersInit>;
  compact?: boolean;
};

export function ShippingProvidersPanel({ getAuthHeaders, compact }: Props) {
  const [rows, setRows] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    try {
      const headers = await getAuthHeaders();
      setRows(await fetchShippingProviders(headers));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load shipping providers');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (code: string, payload: { enabled?: boolean; environment?: 'sandbox' | 'production' }) => {
    setSaving(code);
    try {
      const headers = await getAuthHeaders();
      const updated = await updateShippingProvider({ code, ...payload }, headers);
      setRows((prev) => prev.map((row) => (row.code === code ? { ...row, ...updated } : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className={`rounded-lg border border-gray-200 bg-white ${compact ? 'p-3' : 'p-5'} mb-6`}>
      <h2 className="text-lg font-bold text-gray-900">Shipping Providers</h2>
      <p className="mt-1 text-sm text-gray-600">
        Customers only see JLO Shipping. These providers are used internally after an order is placed.
        API keys stay in server environment variables.
      </p>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.code} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-100 p-3">
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
                onChange={(e) => patch(row.code, { environment: e.target.value as 'sandbox' | 'production' })}
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
              <button
                type="button"
                disabled={saving === row.code}
                onClick={() => patch(row.code, { enabled: !row.enabled })}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  row.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {row.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && !error && (
          <p className="text-sm text-gray-500">No shipping providers found. Apply the multi-carrier migration first.</p>
        )}
      </div>
    </div>
  );
}
