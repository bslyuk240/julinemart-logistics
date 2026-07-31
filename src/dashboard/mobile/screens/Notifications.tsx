import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Package, RotateCcw, Truck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { PullToRefresh } from '../PullToRefresh';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import { timeAgo } from '../lib/displayUtils';
import {
  ACTIVITY_NOTIFICATIONS_CLEARED_KEY,
  ACTIVITY_NOTIFICATIONS_READ_KEY,
  loadNotificationIdSet,
  saveNotificationIdSet,
  shouldShowActivityNotification,
  type ActivityLogRow,
} from '../../lib/activityNotifications';

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

const TYPE_ICON = { order: Package, shipment: Truck, refund: RotateCcw };
const TYPE_STYLE = {
  order: 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
  shipment: 'bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400',
  refund: 'bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400',
};

function inferType(log: ActivityLogRow): NotifType {
  const a = log.action?.toLowerCase() || '';
  const r = log.resource_type?.toLowerCase() || '';
  if (a.includes('refund') || r.includes('refund') || r.includes('return')) return 'refund';
  if (a.includes('shipment') || r.includes('shipment') || a.includes('tracking')) return 'shipment';
  return 'order';
}

function formatFeedItem(log: ActivityLogRow, readIds: Set<string>): FeedItem {
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

// Full-screen activity inbox — opened from the header bell on mobile.
export default function MobileNotifications() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [clearedIds, setClearedIds] = useState<Set<string>>(() =>
    loadNotificationIdSet(ACTIVITY_NOTIFICATIONS_CLEARED_KEY),
  );
  const [readIds, setReadIds] = useState<Set<string>>(() =>
    loadNotificationIdSet(ACTIVITY_NOTIFICATIONS_READ_KEY),
  );

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${functionsBase}/activity-logs?limit=50`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!response.ok) throw new Error(`Activity logs ${response.status}`);
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        const mapped = (data.data as ActivityLogRow[])
          .filter((log) => !clearedIds.has(log.id))
          .filter(shouldShowActivityNotification)
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
    saveNotificationIdSet(ACTIVITY_NOTIFICATIONS_READ_KEY, next);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const markRead = (id: string) => {
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    saveNotificationIdSet(ACTIVITY_NOTIFICATIONS_READ_KEY, next);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const clearAll = () => {
    const nextCleared = new Set(clearedIds);
    items.forEach((n) => nextCleared.add(n.id));
    setClearedIds(nextCleared);
    saveNotificationIdSet(ACTIVITY_NOTIFICATIONS_CLEARED_KEY, nextCleared);
    setItems([]);
  };

  return (
    <div style={{ paddingBottom: TABBAR_SPACE }}>
      <PullToRefresh onRefresh={fetchFeed}>
        <div className="space-y-3">
          <div className="sticky top-0 z-10 border-b border-gray-100 bg-gray-50/95 px-4 py-3 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-950/95">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="Go back"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Notifications</h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">{unread} unread</p>
              </div>
              {items.length > 0 && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={markAllRead} className="text-xs font-medium text-primary-600 dark:text-primary-400">
                    Mark read
                  </button>
                  <button type="button" onClick={clearAll} className="text-xs font-medium text-red-600 dark:text-red-400">
                    Clear
                  </button>
                </div>
              )}
            </div>
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
                    active
                      ? 'border-primary-600 bg-primary-600 text-white'
                      : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
                  }`}
                >
                  {key === 'all' ? 'All' : key} {count}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="space-y-px px-4">
              <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
              <div className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Bell className="mx-auto mb-2 h-10 w-10 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-500 dark:text-gray-400">No notifications</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">You&apos;re all caught up</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 border-t border-gray-100 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {filtered.map((n) => {
                const Icon = TYPE_ICON[n.type];
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => markRead(n.id)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left ${
                      !n.read ? 'bg-primary-50/40 dark:bg-primary-950/20' : ''
                    }`}
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TYPE_STYLE[n.type]}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{n.title}</span>
                        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">{timeAgo(n.at)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{n.message}</p>
                    </div>
                    {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PullToRefresh>
    </div>
  );
}
