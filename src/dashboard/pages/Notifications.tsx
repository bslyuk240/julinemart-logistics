import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, ChevronRight, Clock, Plus } from 'lucide-react';
import {
  loadNotificationHistory,
  NotificationHistoryEntry,
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
  const [entries, setEntries] = useState<NotificationHistoryEntry[]>([]);

  useEffect(() => {
    setEntries(loadNotificationHistory());
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Push Notifications</h1>
          <p className="mt-2 text-gray-600">
            Manage manual push sends and review recent notification attempts.
          </p>
        </div>
        <button onClick={() => navigate('/admin/notifications/new')} className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Notification
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="card py-14 text-center">
          <BellRing className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-lg font-medium text-gray-800">No history yet</p>
          <p className="mt-1 text-gray-500">Send your first notification to populate this page.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => navigate(`/admin/notifications/${entry.id}`)}
              className="card w-full text-left transition-shadow hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
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
                </div>
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-400" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
