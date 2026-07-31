import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Loader,
  Search,
  Smartphone,
  Users,
} from 'lucide-react';
import { PullToRefresh } from '../PullToRefresh';
import { SettingsGroup, StatusPill } from '../components/SettingsParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  formatSubscriberDate,
  getUserTypeBadgeClass,
  getUserTypeLabel,
  loadPushSubscribers,
  type PushSubscriber,
  type PushSubscriberSummary,
} from '../../lib/deviceTokensApi';

type TypeFilter = 'all' | 'customer' | 'vendor' | 'staff' | 'admin' | 'unknown';
type PlatformFilter = 'all' | 'web' | 'android' | 'ios';

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'customer', label: 'Customers' },
  { value: 'vendor', label: 'Vendors' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admins' },
];

const PLATFORM_FILTERS: { value: PlatformFilter; label: string }[] = [
  { value: 'all', label: 'All platforms' },
  { value: 'web', label: 'Web' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
];

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-gray-900">{value.toLocaleString()}</p>
    </div>
  );
}

function SubscriberRow({ row, expanded, onToggle }: { row: PushSubscriber; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3.5 text-left active:bg-gray-50">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50">
          <Smartphone className="h-5 w-5 text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-gray-900">{row.display_name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getUserTypeBadgeClass(row.user_type)}`}>
              {getUserTypeLabel(row.user_type)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {row.email_masked || 'No email'}{row.phone_masked ? ` · ${row.phone_masked}` : ''}
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            {row.token_count} {row.token_count === 1 ? 'device' : 'devices'} · {row.platforms.join(', ') || 'unknown'}
          </p>
        </div>
        <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-gray-50 bg-gray-50/80 px-4 py-3">
          <p className="text-[11px] text-gray-500">
            ID <span className="font-mono text-gray-700">{row.user_id_short}…</span>
            {row.role ? ` · role ${row.role}` : ''}
          </p>
          <p className="text-[11px] text-gray-500">Last active {formatSubscriberDate(row.last_active_at)}</p>
          {row.devices.map((device) => (
            <div key={device.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium capitalize text-gray-800">{device.platform}</span>
                <span className="font-mono text-[10px] text-gray-500">{device.token_hint || '***'}</span>
              </div>
              <p className="mt-1 text-[10px] text-gray-400">Last used {formatSubscriberDate(device.last_used_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MobilePushTokenRegistry() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PushSubscriber[]>([]);
  const [summary, setSummary] = useState<PushSubscriberSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError('');
      try {
        const result = await loadPushSubscribers({
          user_type: typeFilter,
          platform: platformFilter,
          search,
          page,
          per_page: 25,
        });
        setRows(result.data);
        setSummary(result.summary);
        setTotalPages(result.meta.total_pages);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load subscribers');
      } finally {
        setLoading(false);
      }
    },
    [typeFilter, platformFilter, search, page]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, platformFilter, search]);

  const typeCounts = useMemo(() => summary?.by_type || {}, [summary]);

  return (
    <div style={{ paddingBottom: TABBAR_SPACE }}>
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate('/admin/notifications')}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-gray-600"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold text-gray-900">Push subscribers</h1>
            <p className="text-xs text-gray-500">Users with saved notification tokens</p>
          </div>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : (
          <PullToRefresh onRefresh={() => load(true)}>
            <div className="space-y-5">
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : null}

              <SettingsGroup title="Overview">
                <div className="grid grid-cols-2 gap-2 px-4 py-3.5">
                  <SummaryTile label="Users" value={summary?.total_users || 0} />
                  <SummaryTile label="Devices" value={summary?.total_tokens || 0} />
                  <SummaryTile label="Customers" value={typeCounts.customer || 0} />
                  <SummaryTile label="Vendors" value={typeCounts.vendor || 0} />
                </div>
              </SettingsGroup>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, masked email, ID…"
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary-500"
                />
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {TYPE_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setTypeFilter(filter.value)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                      typeFilter === filter.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {PLATFORM_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setPlatformFilter(filter.value)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                      platformFilter === filter.value ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <SettingsGroup title="Subscribers">
                {rows.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    <p className="text-sm font-medium text-gray-700">No subscribers match</p>
                    <p className="mt-1 text-xs text-gray-500">Tokens appear when users allow push in the storefront or vendor portal.</p>
                  </div>
                ) : (
                  rows.map((row) => (
                    <SubscriberRow
                      key={row.user_id}
                      row={row}
                      expanded={expandedId === row.user_id}
                      onToggle={() => setExpandedId((current) => (current === row.user_id ? null : row.user_id))}
                    />
                  ))
                )}
              </SettingsGroup>

              {totalPages > 1 ? (
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <StatusPill tone="neutral" label={`Page ${page} of ${totalPages}`} />
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </PullToRefresh>
        )}
      </div>
    </div>
  );
}
