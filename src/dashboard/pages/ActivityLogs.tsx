import { useEffect, useState } from 'react';
import { Activity, Search, Filter, User, Package, MapPin, Truck, DollarSign } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';

interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: any;
  ip_address: string;
  created_at: string;
  users: {
    email: string;
    full_name: string;
  };
}

export function ActivityLogsPage() {
  const notification = useNotification();
  const { session } = useAuth();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [resourceFilter, setResourceFilter] = useState('all');
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, resourceFilter, session]);

  const fetchLogs = async () => {
    try {
      let url = apiBase + '/api/activity-logs?limit=100';
      if (actionFilter !== 'all') url += '&action=' + actionFilter;

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
      let filteredLogs = data.data || [];
      if (resourceFilter !== 'all') {
        filteredLogs = filteredLogs.filter((log: ActivityLog) => log.resource_type === resourceFilter);
      }
      setLogs(filteredLogs);
    } catch (error) {
      console.error('Error fetching logs:', error);
      notification.error('Failed to Load', 'Unable to fetch activity logs');
    } finally {
      setLoading(false);
    }
  };  const filteredLogs = logs.filter(log =>
    searchTerm === '' ||
    log.users?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.resource_type?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getActionColor = (action: string) => {
    const colors: Record<string, string> = {
      INSERT: 'bg-green-100 text-green-800',
      CREATE: 'bg-green-100 text-green-800',
      UPDATE: 'bg-blue-100 text-blue-800',
      DELETE: 'bg-red-100 text-red-800',
      LOGIN: 'bg-purple-100 text-purple-800',
    };
    return colors[action] || 'bg-gray-100 text-gray-800';
  };

  const getResourceIcon = (resourceType: string) => {
    const icons: Record<string, any> = {
      users: User,
      orders: Package,
      hubs: MapPin,
      couriers: Truck,
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
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Activity Logs</h1>
        <p className="text-gray-600 mt-2">
          System activity and audit trail • {filteredLogs.length} events
        </p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search by user, action, or resource..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Actions</option>
              <option value="INSERT">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
            </select>

            <select
              value={resourceFilter}
              onChange={(e) => setResourceFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Resources</option>
              <option value="orders">Orders</option>
              <option value="users">Users</option>
              <option value="hubs">Hubs</option>
              <option value="couriers">Couriers</option>
              <option value="shipping_rates">Shipping Rates</option>
            </select>
          </div>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">Loading activity logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center py-12">
            <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No activity logs found</p>
            {(searchTerm || actionFilter !== 'all' || resourceFilter !== 'all') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setActionFilter('all');
                  setResourceFilter('all');
                }}
                className="mt-4 text-primary-600 hover:text-primary-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log, index) => (
              <div
                key={log.id}
                className={`p-4 hover:bg-gray-50 transition-colors ${
                  index !== filteredLogs.length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="flex-shrink-0 w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-600">
                    {getResourceIcon(log.resource_type)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {log.resource_type}
                      </span>
                      {log.resource_id && (
                        <span className="text-xs text-gray-500">
                          #{log.resource_id.substring(0, 8)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="font-medium">
                        {log.users?.full_name || log.users?.email || 'System'}
                      </span>
                      {log.users?.email && log.users?.full_name && (
                        <span className="text-gray-400">({log.users.email})</span>
                      )}
                    </div>

                    {log.ip_address && (
                      <div className="text-xs text-gray-500 mt-1">
                        IP: {log.ip_address}
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="flex-shrink-0 text-xs text-gray-500">
                    {formatTimestamp(log.created_at)}
                  </div>
                </div>

                {/* Details (expandable) */}
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
