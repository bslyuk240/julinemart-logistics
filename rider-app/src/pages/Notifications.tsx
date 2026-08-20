import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Check, RefreshCw } from 'lucide-react';
import { api, RiderNotification } from '../lib/api';
import { BottomNav } from '../components/BottomNav';

function formatTime(value: string) {
  return new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<RiderNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getNotifications()
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load notifications'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openNotification = async (n: RiderNotification) => {
    if (!n.read_at) {
      setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item)));
      api.markNotificationRead(n.id).catch(() => {});
    }
    navigate(n.data?.targetPath || '/');
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((item) => (item.read_at ? item : { ...item, read_at: new Date().toISOString() })));
    try {
      await api.markAllNotificationsRead();
    } catch {
      load();
    }
  };

  const hasUnread = items.some((n) => !n.read_at);

  return (
    <div className="min-h-screen pb-24">
      <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/')} className="text-gray-400">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">Notifications</h1>
        </div>
        {hasUnread && (
          <button type="button" onClick={markAllRead} className="text-xs font-semibold text-primary-600">
            Mark all read
          </button>
        )}
      </div>

      <div className="px-6 pt-6 space-y-2">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <Bell className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Nothing here yet</p>
          </div>
        ) : (
          items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => openNotification(n)}
              className={`w-full text-left rounded-2xl border p-4 ${n.read_at ? 'border-gray-200 bg-white' : 'border-primary-200 bg-primary-50'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{n.message}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{formatTime(n.created_at)}</p>
                </div>
                {!n.read_at && <span className="w-2 h-2 rounded-full bg-primary-600 shrink-0 mt-1.5" />}
                {n.read_at && <Check className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-1" />}
              </div>
            </button>
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}
