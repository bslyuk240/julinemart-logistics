import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, ChevronRight, Clock, Loader, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { SettingsGroup, StatusPill } from '../components/SettingsParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  formatNotificationDate,
  getAudienceLabel,
  getHistoryChannel,
  getTypeLabel,
} from '../lib/pushNotificationsApi';
import {
  loadNotificationHistory,
  removeNotificationHistoryEntry,
  type NotificationHistoryEntry,
} from '../../utils/notificationsHistory';

export default function MobilePushNotifications() {
  const navigate = useNavigate();
  const notification = useNotification();
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setEntries(loadNotificationHistory());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sentCount = useMemo(() => entries.filter((e) => e.success).length, [entries]);
  const failedCount = useMemo(() => entries.filter((e) => !e.success).length, [entries]);

  const handleDelete = (entryId: string) => {
    if (!window.confirm('Delete this notification record?')) return;
    removeNotificationHistoryEntry(entryId);
    load(true);
    notification.success('Deleted', 'History entry removed');
  };

  return (
    <div style={{ paddingBottom: TABBAR_SPACE }}>
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900">Notifications</h1>
            <p className="text-xs text-gray-500">Push &amp; email send history</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/admin/notifications/new')}
            className="flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white active:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            New
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : (
          <PullToRefresh onRefresh={async () => { load(true); }}>
            <div className="space-y-5">
              <SettingsGroup title="Overview">
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50">
                    <BellRing className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {entries.length} {entries.length === 1 ? 'send' : 'sends'} logged
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {sentCount} succeeded · {failedCount} failed
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/admin/notifications/tokens')}
                  className="flex w-full items-center justify-between border-t border-gray-50 px-4 py-3.5 text-left active:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
                      <Smartphone className="h-4 w-4 text-gray-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Push subscribers</p>
                      <p className="text-xs text-gray-500">Users with saved notification tokens</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </button>
              </SettingsGroup>

              {entries.length === 0 ? (
                <div className="overflow-hidden rounded-2xl bg-white px-4 py-12 text-center shadow-sm ring-1 ring-gray-100">
                  <BellRing className="mx-auto h-10 w-10 text-gray-300" />
                  <p className="mt-3 text-sm font-medium text-gray-900">No history yet</p>
                  <p className="mt-1 text-xs text-gray-500">Send your first push to see results here</p>
                  <button
                    type="button"
                    onClick={() => navigate('/admin/notifications/new')}
                    className="mt-4 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Compose notification
                  </button>
                </div>
              ) : (
                <SettingsGroup title="Recent sends">
                  {entries.map((entry) => {
                    const channel = getHistoryChannel(entry.request);
                    return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-2 border-b border-gray-50 px-4 py-3.5 last:border-b-0"
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/notifications/${entry.id}`)}
                        className="flex min-w-0 flex-1 gap-3 text-left active:opacity-80"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill ok={entry.success} label={entry.success ? 'Sent' : 'Failed'} />
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              channel === 'email' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'
                            }`}>
                              {channel === 'email' ? 'Email' : 'Push'}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                              {getAudienceLabel(entry.request.audience)}
                            </span>
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                              {getTypeLabel(entry.request.type)}
                            </span>
                          </div>
                          <p className="mt-2 truncate text-sm font-semibold text-gray-900">{entry.request.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{entry.request.message}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatNotificationDate(entry.createdAt)}
                            </span>
                            <span>Sent {entry.sent ?? 0}</span>
                            <span>Failed {entry.failed ?? 0}</span>
                            <span>Matched {entry.matchedTokensCount ?? 0}</span>
                          </div>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        className="rounded-lg p-2 text-gray-400 active:bg-red-50 active:text-red-600"
                        aria-label="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    );
                  })}
                </SettingsGroup>
              )}
            </div>
          </PullToRefresh>
        )}
      </div>
    </div>
  );
}
