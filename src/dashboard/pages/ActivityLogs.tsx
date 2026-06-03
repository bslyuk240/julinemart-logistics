import { useEffect, useState } from 'react';
import { Activity, Search, Shield, Globe, Store, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';

type Source = 'all' | 'jlo' | 'storefront' | 'vendor_portal';

interface ActivityLog {
  id: string;
  user_id: string;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  source: string;
  created_at: string;
  users: { email: string; full_name: string; role?: string } | null;
}

const SOURCE_TABS: { key: Source; label: string; icon: any }[] = [
  { key: 'all',           label: 'All Activity',  icon: Activity },
  { key: 'jlo',           label: 'JLO Staff',     icon: Shield },
  { key: 'storefront',    label: 'Customers',     icon: Globe },
  { key: 'vendor_portal', label: 'Vendors',       icon: Store },
];

const SOURCE_BADGE: Record<string, string> = {
  jlo:           'bg-purple-100 text-purple-700',
  storefront:    'bg-blue-100 text-blue-700',
  vendor_portal: 'bg-amber-100 text-amber-700',
  system:        'bg-gray-100 text-gray-600',
};

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Login',
  LOGOUT: 'Logout',
  SIGNUP: 'Signup',
  ORDER_PLACED: 'Order placed',
  CARD_ADDED: 'Card added',
  RETURN_REQUESTED: 'Return requested',
  INSERT: 'Record created',
  CREATE: 'Record created',
  UPDATE: 'Record updated',
  DELETE: 'Record deleted',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  USER_DELETED: 'User deleted',
  PASSWORD_RESET_SENT: 'Password reset',
  VENDOR_APPLICATION_APPROVED: 'Vendor approved',
  VENDOR_APPLICATION_REJECTED: 'Vendor rejected',
  WITHDRAWAL_REQUESTED: 'Withdrawal requested',
  WITHDRAWAL_APPROVED: 'Withdrawal approved',
  WITHDRAWAL_REJECTED: 'Withdrawal rejected',
  WITHDRAWAL_PAID: 'Withdrawal paid',
  PRODUCT_CREATED: 'Product created',
  PRODUCT_UPDATED: 'Product updated',
  PRODUCT_DELETED: 'Product deleted',
  PRODUCT_MODERATED: 'Product moderated',
  PRODUCT_PUBLISHED: 'Product published',
  courier_shipment_created: 'Shipment created',
  tracking_updated: 'Tracking updated',
  return_shipment_created: 'Return created',
};

const ACTION_COLOR: Record<string, string> = {
  LOGIN:  'bg-green-50 text-green-700',
  LOGOUT: 'bg-gray-100 text-gray-600',
  SIGNUP: 'bg-green-50 text-green-700',
  INSERT: 'bg-green-50 text-green-700',
  CREATE: 'bg-green-50 text-green-700',
  UPDATE: 'bg-blue-50 text-blue-700',
  DELETE: 'bg-red-50 text-red-700',
  ORDER_PLACED: 'bg-green-50 text-green-700',
  CARD_ADDED: 'bg-emerald-50 text-emerald-700',
  RETURN_REQUESTED: 'bg-orange-50 text-orange-700',
  WITHDRAWAL_PAID: 'bg-indigo-50 text-indigo-700',
  courier_shipment_created: 'bg-indigo-50 text-indigo-700',
  VENDOR_APPLICATION_APPROVED: 'bg-green-50 text-green-700',
  VENDOR_APPLICATION_REJECTED: 'bg-red-50 text-red-700',
  WITHDRAWAL_REJECTED: 'bg-red-50 text-red-700',
};

const ROLE_BADGE: Record<string, string> = {
  admin:   'bg-gray-900 text-white',
  manager: 'bg-purple-600 text-white',
  agent:   'bg-blue-500 text-white',
  vendor:  'bg-amber-500 text-white',
};

const ACTION_FILTERS = [
  { value: 'all', label: 'All Actions' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'ORDER_PLACED', label: 'Order placed' },
  { value: 'SIGNUP', label: 'Signup' },
  { value: 'RETURN_REQUESTED', label: 'Return requested' },
  { value: 'CARD_ADDED', label: 'Card added' },
  { value: 'CREATE', label: 'DB create' },
  { value: 'UPDATE', label: 'DB update' },
  { value: 'DELETE', label: 'DB delete' },
  { value: 'VENDOR_APPLICATION_APPROVED', label: 'Vendor approved' },
  { value: 'WITHDRAWAL_REQUESTED', label: 'Withdrawal requested' },
  { value: 'WITHDRAWAL_PAID', label: 'Withdrawal paid' },
  { value: 'PRODUCT_PUBLISHED', label: 'Product published' },
  { value: 'courier_shipment_created', label: 'Shipment created' },
];

const AUTH_ACTIONS = new Set(['LOGIN', 'LOGOUT', 'SIGNUP', 'PASSWORD_RESET_SENT']);

const ROW_GRID = 'grid grid-cols-[2rem_minmax(12rem,2fr)_5rem_minmax(9rem,1.5fr)_minmax(8rem,1fr)_9rem] items-center gap-x-3';

function actionLabel(action: string) {
  return ACTION_LABELS[action] || ACTION_LABELS[action.toUpperCase()] || action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function actionColor(action: string) {
  return ACTION_COLOR[action] || ACTION_COLOR[action.toUpperCase()] || 'bg-gray-100 text-gray-600';
}

function displayName(log: ActivityLog) {
  return log.users?.full_name || log.users?.email || log.actor_email || 'Unknown';
}

function initials(log: ActivityLog) {
  const name = displayName(log);
  return name.charAt(0).toUpperCase();
}

function hasDetails(log: ActivityLog) {
  return Boolean(log.resource_id || (log.details && Object.keys(log.details).length > 0) || log.ip_address);
}

function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleString('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatMetaValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

export function ActivityLogsPage() {
  const notification = useNotification();
  const { session } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceTab, setSourceTab] = useState<Source>('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [authOnly, setAuthOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => { fetchLogs(); }, [sourceTab, actionFilter, session]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let url = `${apiBase}/api/activity-logs?limit=500&exclude_whatsapp=true`;
      if (actionFilter !== 'all') url += '&action=' + actionFilter;
      if (sourceTab !== 'all') url += '&source=' + sourceTab;

      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          notification.error('Unauthorized', 'Admin access required to view activity logs');
        } else {
          notification.error('Failed to Load', 'Error ' + response.status);
        }
        setLoading(false);
        return;
      }
      const data = await response.json();
      setLogs(data.data || []);
    } catch (error) {
      console.error('Error fetching logs:', error);
      notification.error('Failed to Load', 'Unable to fetch activity logs');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredLogs = logs.filter(log => {
    if (authOnly && !AUTH_ACTIONS.has(log.action.toUpperCase())) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    const metaStr = log.details ? JSON.stringify(log.details).toLowerCase() : '';
    return (
      displayName(log).toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      (log.resource_type || '').toLowerCase().includes(q) ||
      (log.source || '').toLowerCase().includes(q) ||
      metaStr.includes(q)
    );
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Activity Logs</h1>
          <p className="text-gray-600 mt-1">Audit trail for JLO staff, storefront customers, and vendor portal</p>
        </div>
        <button
          type="button"
          onClick={fetchLogs}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Source tabs + controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg flex-wrap">
          {SOURCE_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSourceTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                sourceTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setAuthOnly(v => !v)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              authOnly ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-500 border-gray-300 hover:text-gray-700'
            }`}
          >
            Auth only
          </button>
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
          >
            {ACTION_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search logs…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 w-48"
            />
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-500 mb-3">
        {filteredLogs.length} events
        <span className="text-gray-400"> · WhatsApp logs hidden</span>
      </p>

      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            <p className="mt-4 text-gray-600">Loading activity logs…</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No activity logs found</p>
            {(searchTerm || actionFilter !== 'all' || authOnly) && (
              <button
                onClick={() => { setSearchTerm(''); setActionFilter('all'); setAuthOnly(false); }}
                className="mt-4 text-primary-600 hover:text-primary-700 text-sm"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[56rem]">
              {/* Sticky column headers */}
              <div className={`${ROW_GRID} px-5 py-3 bg-gray-50 border-b border-gray-200 sticky top-0 z-10`}>
                <span />
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Actor</span>
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide text-center">Source</span>
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Action</span>
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Resource</span>
                <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide text-right">Time</span>
              </div>

              <div className="divide-y divide-gray-100">
                {filteredLogs.map(log => {
                  const isOpen = expanded.has(log.id);
                  const canExpand = hasDetails(log);

                  return (
                    <div key={log.id} className="bg-white">
                      <button
                        type="button"
                        onClick={() => canExpand && toggleExpanded(log.id)}
                        disabled={!canExpand}
                        className={`w-full text-left px-5 py-3 ${ROW_GRID} transition-colors ${
                          canExpand ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        {/* Expand chevron */}
                        <span className="flex items-center justify-center text-gray-400">
                          {canExpand ? (
                            isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
                          ) : <span className="w-4" />}
                        </span>

                        {/* Actor */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-gray-800 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                            {initials(log)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm text-gray-800 font-medium truncate">{displayName(log)}</p>
                            {log.users?.role && (
                              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${ROLE_BADGE[log.users.role] ?? 'bg-gray-100 text-gray-600'}`}>
                                {log.users.role}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Source */}
                        <div className="flex justify-center">
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${SOURCE_BADGE[log.source] ?? 'bg-gray-100 text-gray-600'}`}>
                            {log.source === 'vendor_portal' ? 'Vendor' : log.source === 'storefront' ? 'Store' : log.source?.toUpperCase() ?? '—'}
                          </span>
                        </div>

                        {/* Action */}
                        <div className="min-w-0">
                          <span
                            className={`inline-block max-w-full truncate text-xs font-semibold px-2.5 py-1 rounded-full ${actionColor(log.action)}`}
                            title={actionLabel(log.action)}
                          >
                            {actionLabel(log.action)}
                          </span>
                        </div>

                        {/* Resource */}
                        <div className="min-w-0">
                          {log.resource_type ? (
                            <p className="text-sm text-gray-600 truncate">{log.resource_type}</p>
                          ) : (
                            <span className="text-gray-400 text-sm">—</span>
                          )}
                        </div>

                        {/* Time */}
                        <time className="text-xs text-gray-400 font-mono whitespace-nowrap text-right tabular-nums">
                          {formatTimestamp(log.created_at)}
                        </time>
                      </button>

                      {/* Expanded detail panel */}
                      {isOpen && canExpand && (
                        <div className="px-5 pb-4 border-t border-gray-100 bg-gray-50">
                          <div className="pt-4 pl-11 grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div className="space-y-3">
                              {log.resource_type && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Resource</p>
                                  <p className="text-sm text-gray-700 capitalize">{log.resource_type}</p>
                                  {log.resource_id && (
                                    <p className="text-xs font-mono text-gray-500 mt-1 break-all">{log.resource_id}</p>
                                  )}
                                </div>
                              )}
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Actor ID</p>
                                <p className="text-xs font-mono text-gray-500 break-all">{log.user_id ?? '—'}</p>
                              </div>
                              {log.ip_address && (
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">IP Address</p>
                                  <p className="text-xs font-mono text-gray-500">{log.ip_address}</p>
                                </div>
                              )}
                            </div>

                            {log.details && Object.keys(log.details).length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Details</p>
                                <dl className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                                  {Object.entries(log.details).map(([key, value], i, arr) => (
                                    <div
                                      key={key}
                                      className={`grid grid-cols-[8rem_1fr] gap-3 px-3 py-2.5 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
                                    >
                                      <dt className="text-xs font-semibold text-gray-500 break-words">{key}</dt>
                                      <dd className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-words">{formatMetaValue(value)}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
