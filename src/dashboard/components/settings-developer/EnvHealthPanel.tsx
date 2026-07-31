import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { fetchSettingsHealth, type SettingsHealthCheck, type SettingsHealthData } from '../../mobile/lib/settingsApi';
import { getPublicApiBaseUrl } from '../../lib/settingsDeveloperUtils';

interface EnvHealthPanelProps {
  compact?: boolean;
}

export function EnvHealthPanel({ compact = false }: EnvHealthPanelProps) {
  const { session } = useAuth();
  const [data, setData] = useState<SettingsHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError('');
    try {
      setData(await fetchSettingsHealth(session.access_token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load health');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const deployUrl = data?.deployment?.site_url || getPublicApiBaseUrl();

  const wrapperClass = compact
    ? 'overflow-hidden rounded-2xl bg-white ring-1 ring-gray-100'
    : 'card';

  return (
    <div className={wrapperClass}>
      <div className={`flex flex-wrap items-start justify-between gap-3 ${compact ? 'border-b border-gray-50 px-4 py-3' : 'mb-4'}`}>
        <div>
          <h2 className={`font-bold text-gray-900 ${compact ? 'text-sm' : 'text-lg sm:text-xl'}`}>
            Integration health
          </h2>
          <p className={`text-gray-600 ${compact ? 'text-xs' : 'text-sm mt-0.5'}`}>
            Live Netlify env checks — secrets never displayed
          </p>
          {deployUrl ? (
            <p className="mt-1 font-mono text-[10px] text-gray-400 truncate max-w-md">{deployUrl}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={compact ? 'rounded-lg p-2 ring-1 ring-gray-200' : 'btn-secondary inline-flex items-center gap-2'}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {!compact && 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className={`text-sm text-red-700 ${compact ? 'px-4 py-3' : ''}`}>{error}</div>
      ) : loading && !data ? (
        <div className={`flex justify-center ${compact ? 'py-8' : 'py-12'}`}>
          <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        </div>
      ) : data ? (
        <>
          {summary ? (
            <div className={`grid grid-cols-3 gap-2 ${compact ? 'px-4 pb-3' : 'mb-4'}`}>
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase text-gray-500">OK</p>
                <p className="text-lg font-bold text-emerald-700">{summary.ok}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase text-gray-500">Attention</p>
                <p className="text-lg font-bold text-amber-700">{summary.needs_attention}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase text-gray-500">Total</p>
                <p className="text-lg font-bold text-gray-900">{summary.total}</p>
              </div>
            </div>
          ) : null}

          <div className={`space-y-2 ${compact ? 'px-4 pb-4' : ''}`}>
            {data.checks.map((check: SettingsHealthCheck) => (
              <div
                key={check.id}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                  check.ok ? 'border-emerald-100 bg-emerald-50/50' : 'border-amber-100 bg-amber-50/50'
                }`}
              >
                {check.ok ? (
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{check.label}</p>
                  {check.detail ? <p className="text-xs text-gray-600">{check.detail}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
