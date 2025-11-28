import { useState, useEffect } from 'react';
import { Bell, X, Package, Truck, AlertCircle } from 'lucide-react';

interface Notification {
  id: string;
  type: 'order' | 'shipment' | 'system';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  icon?: 'success' | 'warning' | 'error' | 'info';
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
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

  function formatNotification(log: ActivityLog): Notification {
    const actionLower = log.action?.toLowerCase() || '';
    const resourceLower = log.resource_type?.toLowerCase() || '';
    const type: Notification['type'] =
      actionLower.includes('shipment') || resourceLower.includes('shipment')
        ? 'shipment'
        : actionLower.includes('order') || resourceLower.includes('order')
        ? 'order'
        : 'system';

    const parseDetails = () => {
      if (log.description) return log.description;
      if (typeof log.details === 'string') {
        try {
          const parsed = JSON.parse(log.details);
          return parsed;
        } catch {
          return log.details;
        }
      }
      return log.details ?? log.metadata ?? null;
    };

    const details = parseDetails();
    const title =
      log.action?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ||
      'System Event';

    const message = (() => {
      if (typeof details === 'string' && details.trim()) return details;
      if (details && typeof details === 'object') {
        if ('message' in details && typeof (details as any).message === 'string') {
          return (details as any).message;
        }
        if ('tracking_id' in details || 'tracking' in details) {
          const tracking = (details as any).tracking_id || (details as any).tracking;
          const orderId = (details as any).order_id || (details as any).order;
          return `Shipment updated${tracking ? ` • Tracking ${tracking}` : ''}${
            orderId ? ` • Order ${orderId}` : ''
          }`;
        }
        if ('order_id' in details) {
          return `Order ${details.order_id} updated`;
        }
        if ('provider' in details) {
          return `Email provider set to ${(details as any).provider}`;
        }
        const entries = Object.entries(details)
          .slice(0, 3)
          .map(([key, value]) => `${key}: ${value}`);
        if (entries.length > 0) return entries.join(' • ');
      }
      if (log.resource_type && log.resource_id) {
        return `${log.resource_type} ${log.resource_id}`;
      }
      return 'Activity recorded';
    })();

    return {
      id: log.id,
      type,
      title,
      message,
      timestamp: new Date(log.created_at),
      read: false,
    };
  }

  useEffect(() => {
    let mounted = true;
    const fetchNotifications = async () => {
      try {
        const response = await fetch(`${functionsBase}/activity-logs?limit=5`);
        if (!response.ok) throw new Error(`Activity logs ${response.status}`);
        const data = await response.json();
        if (mounted && data.success && Array.isArray(data.data)) {
          const mapped = (data.data as ActivityLog[]).map((log) => formatNotification(log));
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
  }, [functionsBase]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((notif) => (notif.id === id ? { ...notif, read: true } : notif))
    );
  };

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((notif) => ({ ...notif, read: true })));
  };

  const clearNotification = (id: string) => {
    setNotifications((prev) => prev.filter((notif) => notif.id !== id));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const getIcon = (notification: Notification) => {
    if (notification.type === 'order') return <Package className="w-5 h-5 text-blue-600" />;
    if (notification.type === 'shipment') return <Truck className="w-5 h-5 text-purple-600" />;
    if (notification.icon === 'warning') return <AlertCircle className="w-5 h-5 text-yellow-600" />;
    return <Bell className="w-5 h-5 text-gray-600" />;
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
      {/* Bell Icon */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white text-xs flex items-center justify-center rounded-full animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          {/* Panel */}
          <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[600px] flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
                <p className="text-sm text-gray-500">{unreadCount} unread</p>
              </div>
              <div className="flex gap-2">
                {notifications.length > 0 && (
                  <>
                    <button
                      onClick={markAllAsRead}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      Mark all read
                    </button>
                    <button
                      onClick={clearAll}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Clear all
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Notifications List */}
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No notifications</p>
                  <p className="text-sm text-gray-400 mt-1">You're all caught up!</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                        !notification.read ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => markAsRead(notification.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-1">{getIcon(notification)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-gray-900">{notification.title}</p>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                clearNotification(notification.id);
                              }}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                          <p className="text-xs text-gray-500 mt-2">{getTimeAgo(notification.timestamp)}</p>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-primary-600 rounded-full flex-shrink-0 mt-2"></div>
                        )}
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
