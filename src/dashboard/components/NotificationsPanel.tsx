import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface Notification {
  id: string;
  type: 'order' | 'shipment' | 'refund';
  title: string;
  message: string;
  bulletEmoji: string;
  timestamp: Date;
  read: boolean;
  iconSymbol?: string;
}

interface ActivityLog {
  id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details: Record<string, unknown> | string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export function NotificationsPanel() {
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
  const STORAGE_KEY = 'jm_dashboard_cleared_notifications_v1';

  const loadClearedIds = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set<string>();
      const parsed = JSON.parse(raw);
      return new Set<string>(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set<string>();
    }
  };

  const saveClearedIds = (ids: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
    } catch {
      // ignore storage errors
    }
  };

  const [clearedIds, setClearedIds] = useState<Set<string>>(() => loadClearedIds());

  const toTitleCase = (value: string) =>
    value
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const toSingular = (value: string) => {
    if (value.endsWith('ies')) return `${value.slice(0, -3)}y`;
    if (value.endsWith('s') && value.length > 1) return value.slice(0, -1);
    return value;
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  const pickValue = (record: Record<string, unknown> | null, keys: string[]) => {
    if (!record) return undefined;
    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  };

  const formatValue = (value: unknown) => {
    if (value === null || value === undefined) return 'unknown';
    if (typeof value === 'string') return value.replace(/_/g, ' ').trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return 'updated';
  };

  const getChangedFields = (
    oldRecord: Record<string, unknown> | null,
    newRecord: Record<string, unknown> | null
  ) => {
    if (!oldRecord || !newRecord) return [];
    const ignoreFields = new Set(['updated_at', 'created_at']);
    const keys = new Set([...Object.keys(oldRecord), ...Object.keys(newRecord)]);
    return Array.from(keys).filter((key) => {
      if (ignoreFields.has(key)) return false;
      return JSON.stringify(oldRecord[key]) !== JSON.stringify(newRecord[key]);
    });
  };

  const getEntityReference = (record: Record<string, unknown> | null, resourceType: string) => {
    if (!record) return '';
    const candidate = pickValue(record, [
      'woocommerce_order_id',
      'order_number',
      'order_id',
      'tracking_number',
      'tracking_id',
      'code',
      'name',
      'id',
    ]);
    if (candidate === undefined) return '';
    const value = String(candidate);
    if (resourceType.includes('order') && /^\d+$/.test(value)) return `#${value}`;
    return value;
  };

  function formatNotification(log: ActivityLog): Notification {
    const actionLower = log.action?.toLowerCase() || '';
    const resourceLower = log.resource_type?.toLowerCase() || '';
    let type: Notification['type'] = 'order';
    if (actionLower.includes('refund') || resourceLower.includes('refund')) {
      type = 'refund';
    } else if (
      actionLower.includes('shipment') ||
      resourceLower.includes('shipment') ||
      actionLower.includes('tracking')
    ) {
      type = 'shipment';
    }

    const parseDetails = () => {
      if (log.description) return log.description;
      if (typeof log.details === 'string') {
        try {
          return JSON.parse(log.details);
        } catch {
          return log.details;
        }
      }
      return log.details ?? log.metadata ?? null;
    };

    const details = parseDetails();
    const detailsRecord = isRecord(details) ? details : null;
    const oldRecord = detailsRecord && isRecord(detailsRecord.old) ? detailsRecord.old : null;
    const newRecord = detailsRecord && isRecord(detailsRecord.new) ? detailsRecord.new : null;
    const primaryRecord = newRecord || oldRecord || detailsRecord;

    const isCreate =
      actionLower === 'insert' || actionLower.includes('create') || actionLower.includes('insert');
    const isDelete =
      actionLower === 'delete' || actionLower.includes('delete') || actionLower.includes('remove');
    const isUpdate = actionLower === 'update' || actionLower.includes('update');
    const actionVerb = isCreate ? 'created' : isDelete ? 'deleted' : 'updated';

    const resourceLabel = toTitleCase(toSingular(log.resource_type || 'record'));
    const reference =
      getEntityReference(primaryRecord, resourceLower) ||
      (log.resource_id ? String(log.resource_id) : '');
    const title = `${resourceLabel} ${actionVerb}`;

    const message = (() => {
      if (typeof details === 'string' && details.trim()) return details.trim();

      if (detailsRecord && typeof detailsRecord.message === 'string' && detailsRecord.message.trim()) {
        return detailsRecord.message.trim();
      }

      const statusOld = pickValue(oldRecord, ['status', 'overall_status', 'shipment_status']);
      const statusNew = pickValue(newRecord, ['status', 'overall_status', 'shipment_status']);
      if (statusOld !== undefined && statusNew !== undefined && statusOld !== statusNew) {
        const target = reference ? `${resourceLabel} ${reference}` : resourceLabel;
        return `${target} status changed from ${formatValue(statusOld)} to ${formatValue(statusNew)}.`;
      }

      if (type === 'shipment') {
        const tracking = pickValue(primaryRecord, ['tracking_number', 'tracking_id', 'tracking']);
        const orderRef = pickValue(primaryRecord, ['order_number', 'order_id', 'woocommerce_order_id']);
        if (tracking || orderRef) {
          const trackingText = tracking ? `Tracking ${tracking}` : '';
          const orderText = orderRef ? `Order ${orderRef}` : '';
          const connector = trackingText && orderText ? ' - ' : '';
          return `${resourceLabel} ${actionVerb}. ${trackingText}${connector}${orderText}`.trim();
        }
      }

      const changedFields = getChangedFields(oldRecord, newRecord);
      if (changedFields.length > 0) {
        const fieldText = changedFields
          .slice(0, 2)
          .map((field) => toTitleCase(field))
          .join(', ');
        const target = reference ? `${resourceLabel} ${reference}` : resourceLabel;
        return `${target} was updated (${fieldText}).`;
      }

      if (isCreate) return `${resourceLabel}${reference ? ` ${reference}` : ''} was created successfully.`;
      if (isDelete) return `${resourceLabel}${reference ? ` ${reference}` : ''} was deleted.`;
      return `${resourceLabel}${reference ? ` ${reference}` : ''} was updated.`;
    })();

    const iconSymbol = type === 'order' ? '📦' : type === 'shipment' ? '🚚' : '💸';
    const bulletEmoji = isCreate
      ? '✅'
      : isDelete
      ? '🗑️'
      : isUpdate
      ? '🔄'
      : type === 'shipment'
      ? '🚚'
      : type === 'refund'
      ? '💸'
      : '📌';

    return {
      id: log.id,
      type,
      title,
      message,
      bulletEmoji,
      timestamp: new Date(log.created_at),
      read: false,
      iconSymbol,
    };
  }

  const shouldShowLog = (log: ActivityLog) => {
    const actionLower = log.action?.toLowerCase() || '';
    const resourceLower = log.resource_type?.toLowerCase() || '';
    return (
      actionLower.includes('order') ||
      actionLower.includes('tracking') ||
      actionLower.includes('refund') ||
      resourceLower.includes('order') ||
      resourceLower.includes('return') ||
      resourceLower.includes('refund')
    );
  };

  useEffect(() => {
    let mounted = true;
    const fetchNotifications = async () => {
      try {
        const response = await fetch(`${functionsBase}/activity-logs?limit=5`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!response.ok) throw new Error(`Activity logs ${response.status}`);
        const data = await response.json();
        if (mounted && data.success && Array.isArray(data.data)) {
          const filtered = (data.data as ActivityLog[])
            .filter((log) => !clearedIds.has(log.id))
            .filter((log) => shouldShowLog(log));
          const mapped = filtered.map((log) => formatNotification(log));
          setNotifications(mapped);
        }
      } catch (error) {
        console.error('Failed to load notifications', error);
      }
    };
    fetchNotifications();
    return () => {
      mounted = false;
    };
  }, [functionsBase, clearedIds]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) => prev.map((notif) => (notif.id === id ? { ...notif, read: true } : notif)));
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((notif) => ({ ...notif, read: true })));
  };

  const clearNotification = (id: string) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
    setClearedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveClearedIds(next);
      return next;
    });
  };

  const clearAll = () => {
    setNotifications([]);
    setClearedIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      saveClearedIds(next);
      return next;
    });
  };

  const getIcon = (notification: Notification) => {
    const baseClasses = 'w-8 h-8 rounded-full flex items-center justify-center text-lg';
    const themeClass =
      notification.type === 'order'
        ? 'bg-blue-50 text-blue-600'
        : notification.type === 'shipment'
        ? 'bg-purple-50 text-purple-600'
        : 'bg-yellow-50 text-yellow-600';
    return <span className={`${baseClasses} ${themeClass}`}>{notification.iconSymbol || '🛎️'}</span>;
  };

  const getTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <Bell className="h-6 w-6" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-red-500 text-xs text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div className="fixed left-1/2 top-16 z-50 flex max-h-[calc(100vh-4rem)] w-[calc(100vw-1.5rem)] max-w-[24rem] -translate-x-1/2 flex-col rounded-lg border border-gray-200 bg-white shadow-xl sm:absolute sm:left-1/2 sm:top-full sm:mt-2 sm:w-80 sm:max-w-none">
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
                <p className="text-sm text-gray-500">{unreadCount} unread</p>
              </div>
              <div className="flex gap-2">
                {notifications.length > 0 && (
                  <>
                    <button onClick={markAllAsRead} className="text-xs text-primary-600 hover:text-primary-700">
                      Mark all read
                    </button>
                    <button onClick={clearAll} className="text-xs text-red-600 hover:text-red-700">
                      Clear all
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="mx-auto mb-3 h-12 w-12 text-gray-300" />
                  <p className="text-gray-500">No notifications</p>
                  <p className="mt-1 text-sm text-gray-400">You're all caught up!</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`cursor-pointer p-4 transition-colors hover:bg-gray-50 ${
                        !notification.read ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-1 flex-shrink-0">{getIcon(notification)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                clearNotification(notification.id);
                              }}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <p className="mt-1 text-sm text-gray-600">
                            <span className="mr-1">{notification.bulletEmoji}</span>
                            {notification.message}
                          </p>
                          <p className="mt-2 text-xs text-gray-500">{getTimeAgo(notification.timestamp)}</p>
                        </div>
                        {!notification.read && <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-primary-600" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
