import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  ExternalLink,
  Loader,
  Mail,
  RefreshCw,
  ScrollText,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { PullToRefresh } from '../../PullToRefresh';
import { Sheet } from '../../Sheet';
import {
  SectionCard,
  SettingsGroup,
  SettingsRow,
  SettingsSubpage,
  StatusPill,
} from '../../components/SettingsParts';
import { fetchEmailLogs, type EmailLogRow } from '../../lib/settingsApi';

type StatusFilter = 'all' | 'sent' | 'failed';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function timeOnly(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function dateGroupLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function groupByDate(rows: EmailLogRow[]) {
  const groups: { label: string; rows: EmailLogRow[] }[] = [];
  for (const row of rows) {
    const ts = row.sent_at || row.created_at || '';
    const label = ts ? dateGroupLabel(ts) : 'Unknown';
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export default function MobileEmailLogs() {
  const { session } = useAuth();
  const notification = useNotification();
  const navigate = useNavigate();
  const [rows, setRows] = useState<EmailLogRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<EmailLogRow | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!session?.access_token) return;
      if (!quiet) setLoading(true);
      else setRefreshing(true);
      try {
        const data = await fetchEmailLogs(session.access_token);
        setRows(data.rows);
        setTotal(data.total);
      } catch (e) {
        notification.error('Load failed', e instanceof Error ? e.message : 'Could not load email logs');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notification, session?.access_token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [filter, rows]);

  const sentCount = rows.filter((r) => r.status === 'sent').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'sent', label: 'Sent', count: sentCount },
    { key: 'failed', label: 'Failed', count: failedCount },
  ];

  const initialLoad = loading && rows.length === 0;

  return (
    <>
      <SettingsSubpage title="Email logs" subtitle="Send attempts & failures" backTo="/admin/settings">
        {initialLoad ? (
          <div className="flex justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : (
          <PullToRefresh onRefresh={() => load(true)}>
            <div className="space-y-5">
              <SettingsGroup title="Overview">
                <div className="border-b border-gray-50 px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
                      <ScrollText className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">
                        {rows.length} recent {rows.length === 1 ? 'entry' : 'entries'}
                        {total != null && total > rows.length ? ` of ${total}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {sentCount} sent · {failedCount} failed
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void load(true)}
                      disabled={refreshing}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 active:bg-gray-50"
                      aria-label="Refresh logs"
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto px-4 py-3" style={{ scrollbarWidth: 'none' }}>
                  {filters.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        filter === f.key
                          ? 'bg-primary-600 text-white'
                          : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                      }`}
                    >
                      {f.label} ({f.count})
                    </button>
                  ))}
                </div>
              </SettingsGroup>

              {filtered.length === 0 ? (
                <div className="overflow-hidden rounded-2xl bg-white px-4 py-12 text-center shadow-sm ring-1 ring-gray-100">
                  <Mail className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm font-medium text-gray-900">No log entries</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {filter === 'all' ? 'Nothing logged yet' : `No ${filter} emails in the recent log`}
                  </p>
                </div>
              ) : (
                <SettingsGroup title="Recent activity">
                  {groups.map((group) => (
                    <div key={group.label}>
                      <p className="bg-gray-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        {group.label}
                      </p>
                      {group.rows.map((row) => {
                        const isSent = row.status === 'sent';
                        const ts = row.sent_at || row.created_at || '';
                        return (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => setSelected(row)}
                            className="flex w-full items-center gap-3 border-b border-gray-50 px-4 py-3.5 text-left last:border-b-0 active:bg-gray-50"
                          >
                            <div
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                                isSent ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                              }`}
                            >
                              {isSent ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="truncate text-sm font-semibold text-gray-900">{row.recipient}</p>
                                <span className="shrink-0 text-[11px] text-gray-400">{ts ? timeOnly(ts) : '—'}</span>
                              </div>
                              <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{row.subject}</p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <StatusPill ok={isSent} label={isSent ? 'Sent' : 'Failed'} />
                                {row.orders?.order_number != null && (
                                  <span className="text-[11px] font-medium text-primary-600">
                                    Order #{row.orders.order_number}
                                  </span>
                                )}
                              </div>
                              {row.error_message && (
                                <p className="mt-1 line-clamp-1 text-[11px] text-red-600">{row.error_message}</p>
                              )}
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </SettingsGroup>
              )}

              <div className="flex gap-2 rounded-xl bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600 ring-1 ring-gray-100">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <p>&quot;Sent&quot; means the mail server accepted the message — inbox delivery is not tracked here.</p>
              </div>
            </div>
          </PullToRefresh>
        )}
      </SettingsSubpage>

      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Email log details">
        {selected && (
          <div className="space-y-4 pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                    selected.status === 'sent' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                  }`}
                >
                  {selected.status === 'sent' ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <XCircle className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Send details</h2>
                  <p className="text-xs text-gray-500">{formatWhen(selected.sent_at || selected.created_at || '')}</p>
                </div>
              </div>
              <StatusPill ok={selected.status === 'sent'} label={selected.status === 'sent' ? 'Sent' : 'Failed'} />
            </div>

            <SectionCard title="Message">
              <SettingsRow label="Recipient">
                <span className="max-w-[160px] truncate text-xs font-medium text-gray-900">{selected.recipient}</span>
              </SettingsRow>
              <div className="border-b border-gray-50 px-4 py-3.5 last:border-b-0">
                <p className="text-xs text-gray-500">Subject</p>
                <p className="mt-1 text-sm text-gray-900">{selected.subject}</p>
              </div>
              {selected.orders?.order_number != null && (
                <SettingsRow label="Order">
                  <span className="text-xs font-semibold text-primary-600">#{selected.orders.order_number}</span>
                </SettingsRow>
              )}
            </SectionCard>

            {selected.error_message && (
              <div className="flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="break-words text-xs leading-relaxed">{selected.error_message}</p>
              </div>
            )}

            {selected.order_id && (
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  navigate(`/admin/orders/${selected.order_id}`);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white active:bg-primary-700"
              >
                <ExternalLink className="h-4 w-4" />
                {selected.orders?.order_number != null
                  ? `Open order #${selected.orders.order_number}`
                  : 'Open linked order'}
              </button>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
