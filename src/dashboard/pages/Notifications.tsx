import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, ChevronRight, Clock, Loader2, Plus, Smartphone, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  loadNotificationHistory,
  NotificationHistoryEntry,
  removeNotificationHistoryEntry,
} from '../utils/notificationsHistory';

const getAudienceLabel = (audience: NotificationHistoryEntry['request']['audience']) => {
  if (audience === 'single') return 'Single customer';
  if (audience === 'all_customers') return 'All customers';
  if (audience === 'all_vendors') return 'All vendors';
  if (audience === 'all_staff') return 'All staff';
  return 'Segment';
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function NotificationsPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const notification = useNotification();
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!session?.access_token) return;
    try {
      setEntries(await loadNotificationHistory(session.access_token));
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Could not load history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [session?.access_token]);

  const handleDelete = async (entryId: string) => {
    if (!session?.access_token) return;
    const shouldDelete = window.confirm('Delete this notification history record?');
    if (!shouldDelete) return;
    const ok = await removeNotificationHistoryEntry(session.access_token, entryId);
    if (!ok) {
      notification.error('Delete failed', 'Could not delete this record');
      return;
    }
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Push Notifications</h1>
          <p className="mt-2 text-gray-600">
            Manage manual push sends and review recent notification attempts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/admin/notifications/tokens')}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <Smartphone className="h-4 w-4" />
            Push subscribers
          </button>
          <button onClick={() => navigate('/admin/notifications/new')} className="btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Notification
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card flex justify-center py-14">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : entries.length === 0 ? (
        <div className="card py-14 text-center">
          <BellRing className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-lg font-medium text-gray-800">No history yet</p>
          <p className="mt-1 text-gray-500">Send your first notification to populate this page.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="card transition-shadow hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button
                  onClick={() => navigate(`/admin/notifications/${entry.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        entry.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {entry.success ? 'Sent' : 'Failed'}
                    </span>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      {getAudienceLabel(entry.request.audience)}
                    </span>
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">
                      {entry.request.type}
                    </span>
                  </div>
                  <p className="mt-3 text-base font-semibold text-gray-900">{entry.request.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-600">{entry.request.message}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(entry.createdAt)}
                    </span>
                    <span>Sent: {entry.sent ?? 0}</span>
                    <span>Failed: {entry.failed ?? 0}</span>
                    <span>Matched: {entry.matchedTokensCount ?? 0}</span>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-400" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
