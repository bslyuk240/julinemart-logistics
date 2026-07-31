import { useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  API_ENDPOINT_GROUPS,
  AUTH_BADGE,
  METHOD_COLORS,
  type ApiEndpoint,
  type HttpMethod,
} from '../../lib/settingsDeveloperContent';
import { buildApiUrl, getPublicApiBaseUrl } from '../../lib/settingsDeveloperUtils';

interface ApiPanelProps {
  copiedItem: string | null;
  copyToClipboard: (text: string, label: string) => void;
  compact?: boolean;
}

export function ApiPanel({ copiedItem, copyToClipboard, compact = false }: ApiPanelProps) {
  const { session } = useAuth();
  const apiBase = getPublicApiBaseUrl();
  const [testMethod, setTestMethod] = useState<HttpMethod>('GET');
  const [testPath, setTestPath] = useState('/api/admin/settings-health');
  const [testBody, setTestBody] = useState('');
  const [includeAuth, setIncludeAuth] = useState(true);
  const [sending, setSending] = useState(false);
  const [respStatus, setRespStatus] = useState('');
  const [respText, setRespText] = useState('');

  const fillTester = (endpoint: ApiEndpoint) => {
    setTestMethod(endpoint.method);
    setTestPath(endpoint.path);
    const el = document.getElementById('api-tester');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sendRequest = async () => {
    setSending(true);
    setRespStatus('');
    setRespText('');
    try {
      const path = testPath.startsWith('/') ? testPath : `/${testPath}`;
      const url = buildApiUrl(path);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (includeAuth && session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const init: RequestInit = { method: testMethod, headers };
      if (testMethod !== 'GET' && testMethod !== 'DELETE' && testBody.trim()) {
        try {
          init.body = JSON.stringify(JSON.parse(testBody));
        } catch {
          setRespStatus('Invalid JSON');
          setRespText('Request body must be valid JSON.');
          setSending(false);
          return;
        }
      }
      const res = await fetch(url, init);
      const ct = res.headers.get('content-type') || '';
      const bodyText = ct.includes('application/json')
        ? JSON.stringify(await res.json(), null, 2)
        : await res.text();
      setRespStatus(`${res.status} ${res.statusText}`);
      setRespText(bodyText);
    } catch (e) {
      setRespStatus('Request failed');
      setRespText(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const cardClass = compact ? 'overflow-hidden rounded-2xl bg-white ring-1 ring-gray-100' : 'card';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className={cardClass}>
        <div className={compact ? 'border-b border-gray-50 px-4 py-3' : 'mb-4'}>
          <h2 className={`font-bold text-gray-900 ${compact ? 'text-sm' : 'text-lg sm:text-xl'}`}>API base URL</h2>
          <p className="text-xs text-gray-500 mt-0.5">Current JLO deployment — all paths resolve via /api/* → Netlify functions</p>
        </div>
        <div className={`flex gap-2 ${compact ? 'p-4 pt-0' : ''}`}>
          <input
            type="text"
            value={apiBase}
            readOnly
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs bg-gray-50"
          />
          <button
            type="button"
            onClick={() => copyToClipboard(apiBase, 'Base URL')}
            className="btn-secondary flex items-center gap-2 shrink-0"
          >
            {copiedItem === 'Base URL' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {API_ENDPOINT_GROUPS.map((category) => (
        <div key={category.category} className={cardClass}>
          <div className={`${compact ? 'border-b border-gray-50 bg-gray-50/80 px-4 py-2' : 'mb-3'}`}>
            <h2 className={`font-bold text-gray-900 ${compact ? 'text-xs uppercase tracking-wide text-gray-500' : 'text-lg'}`}>
              {category.category}
            </h2>
          </div>
          <div className={compact ? 'divide-y divide-gray-50' : 'space-y-2'}>
            {category.items.map((endpoint) => (
              <div
                key={`${endpoint.method}-${endpoint.path}`}
                className={compact ? 'px-4 py-3' : 'p-3 border border-gray-200 rounded-lg hover:bg-gray-50'}
              >
                <div className="flex items-start gap-2">
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${METHOD_COLORS[endpoint.method]}`}>
                    {endpoint.method}
                  </span>
                  {endpoint.auth ? (
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${AUTH_BADGE[endpoint.auth]}`}>
                      {endpoint.auth}
                    </span>
                  ) : null}
                  <code className="min-w-0 flex-1 text-xs font-mono text-gray-800 break-all">{endpoint.path}</code>
                  {!compact ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm flex items-center gap-1 shrink-0 text-xs"
                      onClick={() => fillTester(endpoint)}
                    >
                      <Play className="w-3 h-3" />
                      Test
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(buildApiUrl(endpoint.path), endpoint.path)}
                      className="shrink-0 p-1.5 text-gray-400"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">{endpoint.description}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className={cardClass} id="api-tester">
        <div className={compact ? 'border-b border-gray-50 px-4 py-3' : 'mb-4'}>
          <h2 className={`font-bold text-gray-900 ${compact ? 'text-sm' : 'text-xl'}`}>Request tester</h2>
          <p className="text-xs text-gray-500">Sends to live deployment origin with your admin session</p>
        </div>
        <div className={`space-y-3 ${compact ? 'p-4' : ''}`}>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={testMethod}
              onChange={(e) => setTestMethod(e.target.value as HttpMethod)}
              className="w-full sm:w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input
              value={testPath}
              onChange={(e) => setTestPath(e.target.value)}
              placeholder="/api/admin/settings-health"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm"
            />
          </div>

          {testMethod !== 'GET' && testMethod !== 'DELETE' ? (
            <textarea
              rows={compact ? 4 : 6}
              value={testBody}
              onChange={(e) => setTestBody(e.target.value)}
              placeholder="{}"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs"
            />
          ) : null}

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeAuth}
              onChange={(e) => setIncludeAuth(e.target.checked)}
            />
            Include admin bearer token
          </label>
          {includeAuth && !session?.access_token ? (
            <p className="text-xs text-red-600">No session token — sign in again</p>
          ) : null}

          <button
            type="button"
            onClick={() => void sendRequest()}
            disabled={sending}
            className="btn-primary inline-flex items-center gap-2 w-full sm:w-auto justify-center"
          >
            <Play className="w-4 h-4" />
            {sending ? 'Sending…' : 'Send request'}
          </button>

          {respStatus ? (
            <div>
              <p className="text-sm text-gray-700 mb-2">Response: {respStatus}</p>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg text-xs overflow-auto max-h-64">{respText}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
