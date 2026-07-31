import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Loader, Search, Smartphone, Users } from 'lucide-react';
import {
  formatSubscriberDate,
  getUserTypeBadgeClass,
  getUserTypeLabel,
  loadPushSubscribers,
  type PushSubscriber,
  type PushSubscriberSummary,
} from '../lib/deviceTokensApi';

type TypeFilter = 'all' | 'customer' | 'vendor' | 'staff' | 'admin' | 'unknown';
type PlatformFilter = 'all' | 'web' | 'android' | 'ios';

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'customer', label: 'Customers' },
  { value: 'vendor', label: 'Vendors' },
  { value: 'staff', label: 'Staff' },
  { value: 'admin', label: 'Admins' },
];

export function PushTokenRegistryPage() {
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

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await loadPushSubscribers({
        user_type: typeFilter,
        platform: platformFilter,
        search,
        page,
        per_page: 30,
      });
      setRows(result.data);
      setSummary(result.summary);
      setTotalPages(result.meta.total_pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscribers');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, platformFilter, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, platformFilter, search]);

  const typeCounts = useMemo(() => summary?.by_type || {}, [summary]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate('/admin/notifications')}
            className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to notifications
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Push subscribers</h1>
          <p className="mt-2 max-w-2xl text-gray-600">
            Users with saved push notification tokens. Contact details are masked; FCM tokens are never shown in full.
          </p>
        </div>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Users</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{(summary?.total_users || 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Devices</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{(summary?.total_tokens || 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customers</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{(typeCounts.customer || 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Vendors</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{(typeCounts.vendor || 0).toLocaleString()}</p>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, masked email, user ID…"
              className="input pl-9"
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)} className="input w-auto">
            {TYPE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value as PlatformFilter)}
            className="input w-auto"
          >
            <option value="all">All platforms</option>
            <option value="web">Web</option>
            <option value="android">Android</option>
            <option value="ios">iOS</option>
          </select>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <Users className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p className="text-lg font-medium text-gray-800">No subscribers found</p>
            <p className="mt-1 text-gray-500">Tokens are saved when users opt in to push on the storefront or vendor portal.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Devices</th>
                  <th className="px-3 py-2">Platforms</th>
                  <th className="px-3 py-2">Last active</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expanded = expandedId === row.user_id;
                  return (
                    <Fragment key={row.user_id}>
                      <tr
                        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                        onClick={() => setExpandedId(expanded ? null : row.user_id)}
                      >
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Smartphone className="h-4 w-4 text-violet-500" />
                            <div>
                              <p className="font-medium text-gray-900">{row.display_name}</p>
                              <p className="font-mono text-xs text-gray-400">{row.user_id_short}…</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getUserTypeBadgeClass(row.user_type)}`}>
                            {getUserTypeLabel(row.user_type)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-gray-600">
                          <p>{row.email_masked || '—'}</p>
                          {row.phone_masked ? <p className="text-xs text-gray-400">{row.phone_masked}</p> : null}
                        </td>
                        <td className="px-3 py-3 font-medium text-gray-900">{row.token_count}</td>
                        <td className="px-3 py-3 capitalize text-gray-600">{row.platforms.join(', ') || '—'}</td>
                        <td className="px-3 py-3 text-gray-600">{formatSubscriberDate(row.last_active_at)}</td>
                      </tr>
                      {expanded ? (
                        <tr key={`${row.user_id}-details`} className="bg-gray-50">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="grid gap-2 md:grid-cols-2">
                              {row.devices.map((device) => (
                                <div key={device.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium capitalize text-gray-800">{device.platform}</span>
                                    <span className="font-mono text-xs text-gray-500">{device.token_hint || '***'}</span>
                                  </div>
                                  <p className="mt-1 text-xs text-gray-500">
                                    Registered {formatSubscriberDate(device.registered_at)} · Last used{' '}
                                    {formatSubscriberDate(device.last_used_at)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-gray-100 pt-4">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="btn-secondary disabled:opacity-40">
              Previous
            </button>
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages}
            </span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="btn-secondary disabled:opacity-40">
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
