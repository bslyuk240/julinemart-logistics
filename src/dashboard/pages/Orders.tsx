import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, Search, Filter, Download, Eye } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { callSupabaseFunction, callSupabaseFunctionWithQuery } from '../../lib/supabaseFunctions';

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
      in_transit: 'bg-purple-100 text-purple-800',
      delivered: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!window.confirm('Are you sure you want to delete this order? This cannot be undone.')) {
      return;
    }

    setDeletingOrderId(orderId);

    try {
      const data = await callSupabaseFunction(`orders/${orderId}`, {
        method: 'DELETE',
      });

      if (data?.success) {
        setOrders(prev => prev.filter(order => order.id !== orderId));
        notification.success('Order Deleted', 'The order was removed successfully.');
      } else {
        notification.error('Delete Failed', data?.error || 'Unable to delete order');
      }
    } catch (error) {
      console.error('Error deleting order:', error);
      notification.error('Delete Failed', 'Unable to delete order');
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
            Manage all customer orders � {filteredOrders.length} of {orders.length} orders
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
                <option value="processing">Processing</option>
                <option value="in_transit">In Transit</option>
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
        <div className="flex items-center justify-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <span className="ml-3 text-gray-600">Loading orders...</span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="card text-center py-16">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
            <Package className="w-8 h-8 text-gray-400" />
          </div>
          
          {orders.length === 0 ? (
            <>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Orders Yet</h3>
              <p className="text-gray-600 mb-6 max-w-md mx-auto">
                Get started by creating your first order manually, or connect your WooCommerce store to automatically sync orders.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => navigate('/admin/orders/create')}
                  className="btn-primary flex items-center justify-center"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Create First Order
                </button>
                
                <button
                  onClick={() => navigate('/admin/settings')}
                  className="btn-secondary flex items-center justify-center"
                >
                  <Filter className="w-5 h-5 mr-2" />
                  Setup WooCommerce
                </button>
              </div>

              <div className="mt-8 pt-8 border-t border-gray-200">
                <p className="text-sm text-gray-600 mb-4">Quick Start Options:</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
                  <div className="p-4 bg-blue-50 rounded-lg text-left">
                    <h4 className="font-semibold text-blue-900 mb-2">1. Manual Entry</h4>
                    <p className="text-sm text-blue-800">Create orders directly in the dashboard for immediate processing</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg text-left">
                    <h4 className="font-semibold text-green-900 mb-2">2. WooCommerce Sync</h4>
                    <p className="text-sm text-green-800">Connect your store to automatically import orders via webhook</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg text-left">
                    <h4 className="font-semibold text-purple-900 mb-2">3. API Integration</h4>
                    <p className="text-sm text-purple-800">Use our REST API to integrate with any e-commerce platform</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Matching Orders</h3>
              <p className="text-gray-600 mb-6">
                No orders match your current filters. Try adjusting your search or filters.
              </p>
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('all');
                }}
                className="btn-secondary"
              >
                Clear Filters
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => navigate(`/admin/orders/${order.id}`)}
              className="card hover:shadow-lg transition-shadow cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-gray-900">
                      #{order.woocommerce_order_id}
                    </h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.overall_status)}`}>
                      {order.overall_status}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Customer:</span>
                      <p className="font-medium">{order.customer_name}</p>
                    </div>
                    <div>
                      <span className="text-gray-600">Email:</span>
                      <p className="font-medium text-xs">{order.customer_email}</p>
                    </div>
                    <div>
                      <span className="text-gray-600">Destination:</span>
                      <p className="font-medium">{order.delivery_state}</p>
                    </div>
                  </div>
                </div>

                <div className="text-right ml-6">
                  <div className="text-2xl font-bold text-gray-900">
                    ?{order.total_amount.toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-600">
                    {new Date(order.created_at).toLocaleDateString()}
                  </div>
                  <button className="mt-2 text-primary-600 hover:text-primary-700 flex items-center gap-1 text-sm font-medium">
                    <Eye className="w-4 h-4" />
                    View Details
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteOrder(order.id);
                    }}
                    disabled={deletingOrderId === order.id}
                    className="mt-2 text-red-600 hover:text-red-700 flex items-center gap-1 text-sm font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

