import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  Filter,
  Globe,
  Loader,
  Search,
  Shield,
  Store,
  X,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  AUTH_ACTIONS,
  SOURCE_BADGE,
  type ActivityLogRow,
  type ActivitySource,
  actionColor,
  actionLabel,
  displayName,
  fetchActivityLogs,
  sourceLabel,
} from '../lib/insightsApi';

const SOURCE_TABS: { key: ActivitySource; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'jlo', label: 'Staff' },
  { key: 'storefront', label: 'Customers' },
  { key: 'vendor_portal', label: 'Vendors' },
];

const ACTION_FILTERS = [
  { value: 'all', label: 'All actions' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'ORDER_PLACED', label: 'Order placed' },
  { value: 'SIGNUP', label: 'Signup' },
  { value: 'RETURN_REQUESTED', label: 'Return requested' },
  { value: 'CREATE', label: 'Record created' },
  { value: 'UPDATE', label: 'Record updated' },
  { value: 'DELETE', label: 'Record deleted' },
  { value: 'WITHDRAWAL_PAID', label: 'Withdrawal paid' },
  { value: 'courier_shipment_created', label: 'Shipment created' },
];

const SOURCE_AVATAR: Record<string, string> = {
  jlo: 'bg-violet-100 text-violet-700',
  storefront: 'bg-blue-100 text-blue-700',
  vendor_portal: 'bg-amber-100 text-amber-800',
  system: 'bg-gray-100 text-gray-600',
};

function initials(log: ActivityLogRow) {
  const name = displayName(log);
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function dateSectionLabel(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function groupByDate(rows: ActivityLogRow[]) {
  const groups: { label: string; items: ActivityLogRow[] }[] = [];
  let current = '';
  for (const row of rows) {
    const label = dateSectionLabel(row.created_at);
    if (label !== current) {
      current = label;
      groups.push({ label, items: [row] });
    } else {
      groups[groups.length - 1].items.push(row);
    }
  }
  return groups;
}

function formatMetaValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  return String(v);
}

function formatDetailTime(ts: string) {
  return new Date(ts).toLocaleString('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SourceIcon({ source }: { source: string }) {
  if (source === 'jlo') return <Shield className="h-3 w-3" />;
  if (source === 'storefront') return <Globe className="h-3 w-3" />;
  if (source === 'vendor_portal') return <Store className="h-3 w-3" />;
  return <Activity className="h-3 w-3" />;
}

export default function MobileActivityLogs() {
  const notification = useNotification();
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceTab, setSourceTab] = useState<ActivitySource>('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [authOnly, setAuthOnly] = useState(false);
  const [selected, setSelected] = useState<ActivityLogRow | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLogs(await fetchActivityLogs({ source: sourceTab, action: actionFilter }));
    } catch {
      notification.error('Load failed', 'Unable to fetch activity logs');
    } finally {
      setLoading(false);
    }
  }, [notification, sourceTab, actionFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (authOnly && !AUTH_ACTIONS.has(log.action.toUpperCase())) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const metaStr = log.details ? JSON.stringify(log.details).toLowerCase() : '';
      return (
        displayName(log).toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        (log.resource_type || '').toLowerCase().includes(q) ||
        (log.source || '').toLowerCase().includes(q) ||
        metaStr.includes(q)
      );
    });
  }, [logs, search, authOnly]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  const sourceCounts = useMemo(() => {
    const counts: Record<ActivitySource, number> = {
      all: logs.length,
      jlo: logs.filter((l) => l.source === 'jlo').length,
      storefront: logs.filter((l) => l.source === 'storefront').length,
      vendor_portal: logs.filter((l) => l.source === 'vendor_portal').length,
    };
    return counts;
  }, [logs]);

  const filtersActive = actionFilter !== 'all' || authOnly;

  const clearFilters = () => {
    setActionFilter('all');
    setAuthOnly(false);
    setFiltersOpen(false);
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          {/* Sticky toolbar — same pattern as Support / Orders */}
          <div className="sticky top-0 z-20 space-y-2.5 bg-gray-50 px-4 pb-3 pt-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Activity</h1>
              <p className="text-[11px] text-gray-500">
                {filtered.length} event{filtered.length !== 1 ? 's' : ''}
                {!loading && ' · WhatsApp hidden'}
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Actor, action, resource…"
                className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                style={{ fontSize: '16px' }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="shrink-0 text-gray-400" aria-label="Clear search">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
              {SOURCE_TABS.map((tab) => {
                const active = sourceTab === tab.key;
                const count = tab.key === 'all' ? logs.length : sourceCounts[tab.key];
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSourceTab(tab.key)}
                    aria-pressed={active}
                    className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium ${
                      active ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    {tab.label} {count}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-medium ${
                  filtersActive
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {filtersActive && <span className="h-1.5 w-1.5 rounded-full bg-primary-600" />}
              </button>
              <button
                type="button"
                onClick={() => setAuthOnly((v) => !v)}
                className={`rounded-full border px-3 py-2 text-[11px] font-medium ${
                  authOnly ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                Auth events
              </button>
            </div>
          </div>

          {/* Inbox-style list */}
          {loading ? (
            <div className="space-y-px">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[72px] animate-pulse bg-white">
                  <div className="flex h-full items-center gap-3 px-4">
                    <div className="h-10 w-10 shrink-0 rounded-full bg-gray-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-2/3 rounded bg-gray-100" />
                      <div className="h-2.5 w-1/2 rounded bg-gray-100" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center">
                <Activity className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm font-medium text-gray-900">No activity found</p>
                <p className="mt-1 text-xs text-gray-500">Try a different source or clear filters</p>
                {filtersActive && (
                  <button type="button" onClick={clearFilters} className="mt-3 text-sm font-semibold text-primary-600">
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white">
              {grouped.map((group) => (
                <section key={group.label}>
                  <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{group.label}</p>
                  </div>
                  {group.items.map((log) => (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => setSelected(log)}
                      className="flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left active:bg-gray-50"
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase ${
                          SOURCE_AVATAR[log.source] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {initials(log)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-gray-900">{displayName(log)}</span>
                          <span className="shrink-0 text-[10.5px] tabular-nums text-gray-400">{timeAgo(log.created_at)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-gray-600">{actionLabel(log.action)}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span
                            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              SOURCE_BADGE[log.source] ?? 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            <SourceIcon source={log.source} />
                            {sourceLabel(log.source)}
                          </span>
                          {log.resource_type && (
                            <span className="max-w-[9rem] truncate rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-gray-600">
                              {log.resource_type}
                            </span>
                          )}
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${actionColor(log.action)}`}>
                            {log.action.replace(/_/g, ' ').slice(0, 12)}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      {/* Filter sheet — replaces native select */}
      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} ariaLabel="Activity filters">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">Filters</h2>
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="text-sm font-semibold text-primary-600">
              Reset
            </button>
          )}
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-gray-500">Action type</p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {ACTION_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => {
                  setActionFilter(f.value);
                  setFiltersOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm ${
                  actionFilter === f.value ? 'bg-primary-50 font-semibold text-primary-800' : 'text-gray-800 active:bg-gray-50'
                }`}
              >
                {f.label}
                {actionFilter === f.value && <span className="text-primary-600">✓</span>}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-4 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-3">
          <span className="text-sm text-gray-800">Auth events only</span>
          <input
            type="checkbox"
            checked={authOnly}
            onChange={(e) => setAuthOnly(e.target.checked)}
            className="h-5 w-5 rounded accent-primary-600"
          />
        </label>

        <button
          type="button"
          onClick={() => setFiltersOpen(false)}
          className="mt-4 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white"
        >
          Apply
        </button>
      </Sheet>

      {/* Detail sheet */}
      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Activity details">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold uppercase ${
                  SOURCE_AVATAR[selected.source] ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {initials(selected)}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900">{displayName(selected)}</h2>
                <p className="text-xs text-gray-500">{formatDetailTime(selected.created_at)}</p>
                {selected.users?.role && (
                  <span className="mt-1 inline-block rounded-full bg-gray-900 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    {selected.users.role}
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 divide-y divide-gray-100">
              <DetailRow label="Action">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${actionColor(selected.action)}`}>
                  {actionLabel(selected.action)}
                </span>
              </DetailRow>
              <DetailRow label="Source">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${SOURCE_BADGE[selected.source] ?? 'bg-gray-100 text-gray-600'}`}>
                  {sourceLabel(selected.source)}
                </span>
              </DetailRow>
              {selected.resource_type && (
                <DetailRow label="Resource">
                  <span className="capitalize text-gray-900">{selected.resource_type}</span>
                </DetailRow>
              )}
              {selected.resource_id && (
                <DetailRow label="Resource ID">
                  <span className="break-all font-mono text-[11px] text-gray-600">{selected.resource_id}</span>
                </DetailRow>
              )}
              {selected.ip_address && (
                <DetailRow label="IP address">
                  <span className="font-mono text-xs text-gray-800">{selected.ip_address}</span>
                </DetailRow>
              )}
              <DetailRow label="Actor ID">
                <span className="break-all font-mono text-[11px] text-gray-500">{selected.user_id ?? '—'}</span>
              </DetailRow>
            </div>

            {selected.details && Object.keys(selected.details).length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Payload</p>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  {Object.entries(selected.details).map(([key, value], i, arr) => (
                    <div
                      key={key}
                      className={`px-3 py-2.5 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
                    >
                      <p className="text-[11px] font-medium text-gray-500">{key}</p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs text-gray-800">
                        {formatMetaValue(value)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <span className="shrink-0 text-xs text-gray-500">{label}</span>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  );
}
