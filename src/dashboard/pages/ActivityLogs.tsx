import { useEffect, useState } from 'react';
import { Activity, Search, User, Package, MapPin, Truck, DollarSign, Globe, Store, Shield } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';

type Source = 'all' | 'jlo' | 'storefront' | 'vendor_portal';

interface ActivityLog {
  id: string;
  user_id: string;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  details: any;
  ip_address: string;
  source: string;
  created_at: string;
  users: {
    email: string;
    full_name: string;
  } | null;
}

const SOURCE_TABS: { key: Source; label: string; icon: any }[] = [
  { key: 'all',           label: 'All Activity',    icon: Activity },
  { key: 'jlo',           label: 'JLO Staff',       icon: Shield },
  { key: 'storefront',    label: 'Customers',        icon: Globe },
  { key: 'vendor_portal', label: 'Vendors',          icon: Store },
];

const SOURCE_BADGE: Record<string, string> = {
  jlo:           'bg-purple-100 text-purple-700',
  storefront:    'bg-blue-100 text-blue-700',
  vendor_portal: 'bg-amber-100 text-amber-700',
};

const SOURCE_LABEL: Record<string, string> = {
  jlo:           'JLO',
  storefront:    'Storefront',
  vendor_portal: 'Vendor Portal',
};

export function ActivityLogsPage() {
  const notification = useNotification();
  const { session } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceTab, setSourceTab] = useState<Source>('all');
  const [actionFilter, setActionFilter] = useState('all');
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => {
    fetchLogs();
  }, [sourceTab, actionFilter, session]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let url = `${apiBase}/api/activity-logs?limit=200`;
      if (actionFilter !== 'all') url += '&action=' + actionFilter;
      if (sourceTab !== 'all') url += '&source=' + sourceTab;

      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          notification.error('Unauthorized', 'Please sign in as admin or manager');
        } else {
          notification.error('Failed to Load', 'Error ' + response.status);
        }
        setLoading(false);
        return;
      }

      const data = await response.json();
      setLogs(data.data || []);
    } catch (error) {
      console.error('Error fetching logs:', error);
      notification.error('Failed to Load', 'Unable to fetch activity logs');
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log =>
    searchTerm === '' ||
    (log.actor_email || log.users?.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.users?.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.resource_type || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getActionColor = (action: string) => {
    const colors: Record<string, string> = {
      INSERT:        'bg-green-100 text-green-800',
      CREATE:        'bg-green-100 text-green-800',
      SIGNUP:        'bg-green-100 text-green-800',
      UPDATE:        'bg-blue-100 text-blue-800',
      DELETE:        'bg-red-100 text-red-800',
      LOGIN:         'bg-purple-100 text-purple-800',
      ORDER_PLACED:  'bg-indigo-100 text-indigo-800',
      CARD_ADDED:    'bg-cyan-100 text-cyan-800',
    };
    return colors[action] || 'bg-gray-100 text-gray-800';
  };

  const getResourceIcon = (resourceType: string) => {
    const icons: Record<string, any> = {
      users:          User,
      customers:      User,
      orders:         Package,
      hubs:           MapPin,
      couriers:       Truck,
      shipping_rates: DollarSign,
    };
    const Icon = icons[resourceType] || Activity;
    return <Icon className="w-4 h-4" />;
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const displayEmail = (log: ActivityLog) =>
    log.users?.email || log.actor_email || 'Unknown';

  const displayName = (log: ActivityLog) =>
    log.users?.full_name || null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Activity Logs</h1>
        <p className="text-gray-600 mt-1">Audit trail — JLO staff, storefront customers, and vendor portal</p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {SOURCE_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSourceTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              sourceTab === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by user, action, or resource..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
          >
            <option value="all">All Actions</option>
            <option value="LOGIN">Login</option>
            <option value="SIGNUP">Signup</option>
            <option value="ORDER_PLACED">Order Placed</option>
            <option value="CARD_ADDED">Card Added</option>
            <option value="INSERT">Create (JLO)</option>
            <option value="UPDATE">Update (JLO)</option>
            <option value="DELETE">Delete (JLO)</option>
          </select>
        </div>
      </div>

      {/* Count */}
      <p className="text-sm text-gray-500 mb-3">{filteredLogs.length} events</p>

      {/* Timeline */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            <p className="mt-4 text-gray-600">Loading activity logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No activity logs found</p>
            {(searchTerm || actionFilter !== 'all') && (
              <button
                onClick={() => { setSearchTerm(''); setActionFilter('all'); }}
                className="mt-4 text-primary-600 hover:text-primary-700 text-sm"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-0 divide-y divide-gray-100">
            {filteredLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-600">
                    {getResourceIcon(log.resource_type)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                      {log.resource_type && (
                        <span className="text-sm font-medium text-gray-900">{log.resource_type}</span>
                      )}
                      {log.resource_id && (
                        <span className="text-xs text-gray-500">#{log.resource_id.substring(0, 8)}</span>
                      )}
                      {log.source && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SOURCE_BADGE[log.source] || 'bg-gray-100 text-gray-600'}`}>
                          {SOURCE_LABEL[log.source] || log.source}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="font-medium">{displayName(log) || displayEmail(log)}</span>
                      {displayName(log) && (
                        <span className="text-gray-400 text-xs">({displayEmail(log)})</span>
                      )}
                    </div>

                    {log.ip_address && (
                      <div className="text-xs text-gray-400 mt-0.5">IP: {log.ip_address}</div>
                    )}
                  </div>

                  <div className="flex-shrink-0 text-xs text-gray-500 whitespace-nowrap">
                    {formatTimestamp(log.created_at)}
                  </div>
                </div>

                {log.details && Object.keys(log.details).length > 0 && (
                  <details className="mt-3 ml-14">
                    <summary className="text-xs text-primary-600 cursor-pointer hover:text-primary-700">
                      Show details
                    </summary>
                    <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-x-auto">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
