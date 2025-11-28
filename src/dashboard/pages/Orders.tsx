import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, Search, Filter, Download, Eye, Trash2 } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { callSupabaseFunctionWithQuery } from '../../lib/supabaseFunctions';

interface Order {
  id: string;
  woocommerce_order_id: string;
  customer_name: string;
  customer_email: string;
  delivery_state: string;
  total_amount: number;
  overall_status: string;
  created_at: string;
}

export function OrdersPage() {
  const navigate = useNavigate();
  const notification = useNotification();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);

  // Use the API base URL for direct API calls
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    try {
      const data = await callSupabaseFunctionWithQuery(
        'orders',
        { limit: '100' },
        { method: 'GET' }
      );

      if (Array.isArray(data?.data)) {
        setOrders(data.data);
      } else if (Array.isArray(data)) {
        setOrders(data);
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
      notification.error('Failed to Load', 'Unable to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      searchTerm === '' ||
      order.woocommerce_order_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer_email.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || order.overall_status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      assigned: 'bg-blue-100 text-blue-800',
      in_transit: 'bg-purple-100 text-purple-800',
      out_for_delivery: 'bg-orange-100 text-orange-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      failed: 'bg-red-100 text-red-800',
      returned: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!window.confirm('Are you sure you want to delete this order? This will also delete all sub-orders and tracking events. This cannot be undone.')) {
      return;
    }

    setDeletingOrderId(orderId);

    try {
      // Use Netlify function which has proper cascade delete logic
      const response = await fetch(`${apiBase}/.netlify/functions/orders/${orderId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok && data?.success) {
        setOrders(prev => prev.filter(order => order.id !== orderId));
        notification.success('Order Deleted', 'The order and all related records were removed successfully.');
      } else {
        notification.error('Delete Failed', data?.error || data?.message || 'Unable to delete order');
      }
    } catch (error) {
      console.error('Error deleting order:', error);
      notification.error('Delete Failed', 'Unable to delete order. Please try again.');
    } finally {
      setDeletingOrderId(null);
    }
  };

  return (
    <div>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Orders</h1>
          <p className="text-gray-600 mt-2">
            Manage all customer orders • {filteredOrders.length} of {orders.length} orders
          </p>
        </div>
        <button 
          onClick={() => navigate('/admin/orders/create')}
          className="btn-primary flex items-center"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create Order
        </button>
      </div>

      {/* Search and Filters */}
      {orders.length > 0 && (
        <div className="card mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search by order ID, customer name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="assigned">Assigned</option>
                <option value="processing">Processing</option>
                <option value="in_transit">In Transit</option>
                <option value="out_for_delivery">Out for Delivery</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <button className="btn-secondary flex items-center">
                <Download className="w-5 h-5 mr-2" />
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orders List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading orders...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="card text-center py-12">
          <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Orders Yet</h3>
          <p className="text-gray-500 mb-6">Orders from your WooCommerce store will appear here automatically.</p>
          <button
            onClick={() => navigate('/admin/orders/create')}
            className="btn-primary"
          >
            Create Manual Order
          </button>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="card text-center py-12">
          <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Matching Orders</h3>
          <p className="text-gray-500">Try adjusting your search or filter criteria.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              className="card hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/admin/orders/${order.id}`)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="bg-primary-100 p-3 rounded-full">
                    <Package className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">
                      Order #{order.woocommerce_order_id}
                    </h3>
                    <p className="text-gray-600">{order.customer_name}</p>
                    <p className="text-sm text-gray-500">{order.customer_email}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.overall_status)}`}>
                    {order.overall_status}
                  </span>
                  <div className="mt-2 font-semibold text-lg">
                    ₦{Number(order.total_amount || 0).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-600">
                    {new Date(order.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button 
                      className="text-primary-600 hover:text-primary-700 flex items-center gap-1 text-sm font-medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/admin/orders/${order.id}`);
                      }}
                    >
                      <Eye className="w-4 h-4" />
                      View
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteOrder(order.id);
                      }}
                      disabled={deletingOrderId === order.id}
                      className="text-red-600 hover:text-red-700 flex items-center gap-1 text-sm font-medium disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      {deletingOrderId === order.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}