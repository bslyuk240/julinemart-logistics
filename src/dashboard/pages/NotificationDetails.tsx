import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { findNotificationHistoryEntry, NotificationHistoryEntry } from '../utils/notificationsHistory';

const formatDate = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function NotificationDetailsPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { id = '' } = useParams();
  const [entry, setEntry] = useState<NotificationHistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.access_token) return;
    setLoading(true);
    findNotificationHistoryEntry(session.access_token, id)
      .then(setEntry)
      .finally(() => setLoading(false));
  }, [session?.access_token, id]);

  if (loading) {
    return (
      <div className="card flex justify-center py-14">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/admin/notifications')} className="btn-secondary inline-flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to history
        </button>
        <div className="card">
          <h1 className="text-2xl font-bold text-gray-900">Notification not found</h1>
          <p className="mt-2 text-gray-600">
            This history item is missing. It may have been deleted, or you may not have access to it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate('/admin/notifications')} className="btn-secondary inline-flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to history
          </button>
          <h1 className="mt-3 text-3xl font-bold text-gray-900">Notification Details</h1>
          <p className="mt-2 inline-flex items-center gap-1 text-sm text-gray-600">
            <Clock className="h-4 w-4" />
            {formatDate(entry.createdAt)}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            entry.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}
        >
          {entry.success ? 'Sent' : 'Failed'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <p className="text-sm text-gray-500">Audience</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{entry.request.audience}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Type</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{entry.request.type}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Created by</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{entry.createdBy}</p>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Request Payload</h2>
        <pre className="overflow-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
          {JSON.stringify(entry.request, null, 2)}
        </pre>
      </div>

      <div className="card space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Response</h2>
        <pre className="overflow-auto rounded-lg bg-gray-900 p-4 text-xs text-gray-100">
          {JSON.stringify(entry.response, null, 2)}
        </pre>
      </div>
    </div>
  );
}
