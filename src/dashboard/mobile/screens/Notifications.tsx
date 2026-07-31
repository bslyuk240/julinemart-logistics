import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Package, RotateCcw, Truck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { PullToRefresh } from '../PullToRefresh';
import { functionsBase } from '../lib/functionsAuth';
import { timeAgo } from '../lib/displayUtils';

interface ActivityLog {
  id: string;
  action: string;
  resource_type: string;
  description?: string | null;
  created_at: string;
}

type NotifType = 'order' | 'shipment' | 'refund';

interface FeedItem {
  id: string;
  type: NotifType;
  title: string;
  message: string;
  at: string;
  read: boolean;
}

type Filter = 'all' | NotifType;

const STORAGE_KEY = 'jm_dashboard_cleared_notifications_v1';
const READ_KEY = 'jm_dashboard_read_notifications_v1';

const TYPE_ICON = { order: Package, shipment: Truck, refund: RotateCcw };
const TYPE_STYLE = {
  order: 'bg-blue-50 text-blue-600',
  shipment: 'bg-purple-50 text-purple-600',
  refund: 'bg-orange-50 text-orange-600',
};

function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveIdSet(key: string, ids: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

function inferType(log: ActivityLog): NotifType {
  const a = log.action?.toLowerCase() || '';
  const r = log.resource_type?.toLowerCase() || '';
  if (a.includes('refund') || r.includes('refund') || r.includes('return')) return 'refund';
  if (a.includes('shipment') || r.includes('shipment') || a.includes('tracking')) return 'shipment';
  return 'order';
}

function formatFeedItem(log: ActivityLog, readIds: Set<string>): FeedItem {
  const type = inferType(log);
  const resource = log.resource_type?.replace(/_/g, ' ') || 'Record';
  const action = log.action?.replace(/_/g, ' ') || 'updated';
  return {
    id: log.id,
    type,
    title: `${resource} ${action}`.replace(/\b\w/g, (c) => c.toUpperCase()),
    message: log.description?.trim() || `${resource} was ${action}.`,
    at: log.created_at,
    read: readIds.has(log.id),
  };
}

function shouldShowLog(log: ActivityLog): boolean {
  const a = log.action?.toLowerCase() || '';
  const r = log.resource_type?.toLowerCase() || '';
  return (
    a.includes('order') ||
    a.includes('tracking') ||
    a.includes('refund') ||
    r.includes('order') ||
    r.includes('return') ||
    r.includes('refund') ||
    r.includes('shipment')
  );
}

// Full-screen inbox — same activity-logs source as NotificationsPanel.tsx,
// with local read/clear state persisted in localStorage.
export default function MobileNotifications() {
  const { session } = useAuth();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [clearedIds, setClearedIds] = useState<Set<string>>(() => loadIdSet(STORAGE_KEY));
  const [readIds, setReadIds] = useState<Set<string>>(() => loadIdSet(READ_KEY));

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${functionsBase}/activity-logs?limit=50`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!response.ok) throw new Error(`Activity logs ${response.status}`);
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        const mapped = (data.data as ActivityLog[])
          .filter((log) => !clearedIds.has(log.id))
          .filter(shouldShowLog)
          .map((log) => formatFeedItem(log, readIds));
        setItems(mapped);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, clearedIds, readIds]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((n) => n.type === filter);
  }, [items, filter]);

  const counts = useMemo(
    () => ({
      all: items.length,
      order: items.filter((n) => n.type === 'order').length,
      shipment: items.filter((n) => n.type === 'shipment').length,
      refund: items.filter((n) => n.type === 'refund').length,
    }),
    [items],
  );

  const unread = items.filter((n) => !n.read).length;

  const markAllRead = () => {
    const next = new Set(readIds);
    items.forEach((n) => next.add(n.id));
    setReadIds(next);
    saveIdSet(READ_KEY, next);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markRead = (id: string) => {
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    saveIdSet(READ_KEY, next);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  return (
    <PullToRefresh onRefresh={fetchFeed}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Notifications</h1>
            <p className="text-xs text-gray-500">{unread} unread</p>
          </div>
          {items.length > 0 && (
            <button type="button" onClick={markAllRead} className="text-xs font-medium text-primary-600">
              Mark all read
            </button>
          )}
        </div>

        <div className="-mx-0 flex gap-1.5 overflow-x-auto px-4">
          {(['all', 'order', 'shipment', 'refund'] as Filter[]).map((key) => {
            const active = filter === key;
            const count = counts[key];
            if (key !== 'all' && count === 0) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium capitalize ${
                  active ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {key === 'all' ? 'All' : key} {count}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="space-y-px px-4">
            <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Bell className="mx-auto mb-2 h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-500">No notifications</p>
            <p className="mt-1 text-xs text-gray-400">You&apos;re all caught up</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 border-t border-gray-100 bg-white">
            {filtered.map((n) => {
              const Icon = TYPE_ICON[n.type];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => markRead(n.id)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left ${!n.read ? 'bg-primary-50/40' : ''}`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TYPE_STYLE[n.type]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold text-gray-900">{n.title}</span>
                      <span className="shrink-0 text-[10px] text-gray-400">{timeAgo(n.at)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600">{n.message}</p>
                  </div>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
