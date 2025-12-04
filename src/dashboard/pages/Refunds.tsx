import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Search,
  Filter,
  Check,
  X,
  Clock,
  DollarSign,
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Loader2,
} from 'lucide-react';

interface RefundRequestOrder {
  id: number;
  number: string;
  status: string;
  total: string;
  date_created: string;
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
  };
  payment_method: string;
  payment_method_title: string;
  transaction_id: string;
  refund_request: {
    status: 'pending' | 'approved' | 'rejected' | 'processed';
    reason: string;
    requested_amount: number;
    requested_at: string;
    customer_email: string;
    customer_name: string;
    admin_notes?: string;
    rejection_reason?: string;
    processed_at?: string;
  } | null;
}

const WC_BASE_URL = import.meta.env.VITE_WC_BASE_URL || 'https://admin.julinemart.com/wp-json/wc/v3';
const WC_KEY = import.meta.env.VITE_WC_KEY;
const WC_SECRET = import.meta.env.VITE_WC_SECRET;

export default function RefundsPage() {
  const [orders, setOrders] = useState<RefundRequestOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<RefundRequestOrder | null>(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'process' | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const fetchOrdersWithRefundRequests = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch orders that have refund request meta
      // WooCommerce allows filtering by meta_key
      const authHeader = btoa(`${WC_KEY}:${WC_SECRET}`);
      
      const response = await fetch(
        `${WC_BASE_URL}/orders?per_page=100&meta_key=_refund_request_status`,
        {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch orders');
      }

      const ordersData = await response.json();

      // Parse refund request from meta_data
      const ordersWithRefunds: RefundRequestOrder[] = ordersData
        .map((order: any) => {
          const refundRequestMeta = order.meta_data?.find(
            (m: any) => m.key === '_refund_request'
          );
          const refundRequest = refundRequestMeta?.value
            ? JSON.parse(refundRequestMeta.value)
            : null;

          return {
            id: order.id,
            number: order.number,
            status: order.status,
            total: order.total,
            date_created: order.date_created,
            billing: order.billing,
            payment_method: order.payment_method,
            payment_method_title: order.payment_method_title,
            transaction_id: order.transaction_id,
            refund_request: refundRequest,
          };
        })
        .filter((order: RefundRequestOrder) => order.refund_request !== null);

      setOrders(ordersWithRefunds);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrdersWithRefundRequests();
  }, [fetchOrdersWithRefundRequests]);

  const updateRefundRequest = async (
    orderId: number,
    updates: Partial<RefundRequestOrder['refund_request']>
  ) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || !order.refund_request) return false;

    const updatedRequest = {
      ...order.refund_request,
      ...updates,
    };

    try {
      const authHeader = btoa(`${WC_KEY}:${WC_SECRET}`);
      
      const response = await fetch(`${WC_BASE_URL}/orders/${orderId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meta_data: [
            {
              key: '_refund_request',
              value: JSON.stringify(updatedRequest),
            },
            {
              key: '_refund_request_status',
              value: updates.status || order.refund_request.status,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update order');
      }

      return true;
    } catch (error) {
      console.error('Error updating refund request:', error);
      return false;
    }
  };

  const addOrderNote = async (orderId: number, note: string) => {
    try {
      const authHeader = btoa(`${WC_KEY}:${WC_SECRET}`);
      
      await fetch(`${WC_BASE_URL}/orders/${orderId}/notes`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          note,
          customer_note: false,
        }),
      });
    } catch (error) {
      console.error('Error adding order note:', error);
    }
  };

  const createWooCommerceRefund = async (orderId: number, amount: string, reason: string) => {
    try {
      const authHeader = btoa(`${WC_KEY}:${WC_SECRET}`);
      
      const response = await fetch(`${WC_BASE_URL}/orders/${orderId}/refunds`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          reason,
          api_refund: false, // We'll handle Paystack separately
          api_restock: true,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create refund');
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating WooCommerce refund:', error);
      return null;
    }
  };

  const processPaystackRefund = async (transactionId: string, amount: number) => {
    try {
      // Call your Paystack refund endpoint
      const response = await fetch('/api/refunds/paystack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: transactionId,
          amount: Math.round(amount * 100), // Convert to kobo
        }),
      });

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error('Error processing Paystack refund:', error);
      return false;
    }
  };

  const handleAction = async () => {
    if (!selectedOrder || !actionType || !selectedOrder.refund_request) return;

    try {
      setProcessing(true);
      const refundRequest = selectedOrder.refund_request;

      switch (actionType) {
        case 'approve':
          await updateRefundRequest(selectedOrder.id, {
            status: 'approved',
            admin_notes: actionNotes,
          });
          await addOrderNote(
            selectedOrder.id,
            `✅ REFUND APPROVED\nAmount: ₦${refundRequest.requested_amount.toLocaleString()}\n${actionNotes ? `Notes: ${actionNotes}` : ''}`
          );
          break;

        case 'reject':
          if (!actionNotes) {
            alert('Please provide a rejection reason');
            return;
          }
          await updateRefundRequest(selectedOrder.id, {
            status: 'rejected',
            rejection_reason: actionNotes,
            admin_notes: actionNotes,
          });
          await addOrderNote(
            selectedOrder.id,
            `❌ REFUND REJECTED\nReason: ${actionNotes}`
          );
          break;

        case 'process':
          // Step 1: Create WooCommerce refund
          const wcRefund = await createWooCommerceRefund(
            selectedOrder.id,
            refundRequest.requested_amount.toString(),
            refundRequest.reason
          );

          if (!wcRefund) {
            alert('Failed to create WooCommerce refund');
            return;
          }

          // Step 2: Process Paystack refund if applicable
          let paystackSuccess = true;
          if (
            selectedOrder.transaction_id &&
            ['paystack', 'card'].includes(selectedOrder.payment_method)
          ) {
            paystackSuccess = await processPaystackRefund(
              selectedOrder.transaction_id,
              refundRequest.requested_amount
            );
          }

          // Step 3: Update refund request status
          await updateRefundRequest(selectedOrder.id, {
            status: 'processed',
            processed_at: new Date().toISOString(),
            admin_notes: actionNotes,
          });

          await addOrderNote(
            selectedOrder.id,
            `💰 REFUND PROCESSED\nAmount: ₦${refundRequest.requested_amount.toLocaleString()}\nWooCommerce Refund ID: ${wcRefund.id}\nPaystack: ${paystackSuccess ? 'Initiated' : 'Manual required'}\n${actionNotes ? `Notes: ${actionNotes}` : ''}`
          );
          break;
      }

      // Refresh the list
      await fetchOrdersWithRefundRequests();
      setShowActionModal(false);
      setSelectedOrder(null);
      setActionType(null);
      setActionNotes('');
    } catch (error) {
      console.error('Error processing action:', error);
      alert('Failed to process action');
    } finally {
      setProcessing(false);
    }
  };

  const openActionModal = (
    order: RefundRequestOrder,
    action: 'approve' | 'reject' | 'process'
  ) => {
    setSelectedOrder(order);
    setActionType(action);
    setActionNotes('');
    setShowActionModal(true);
  };

  const formatPrice = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `₦${num.toLocaleString()}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      processed: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };

    const labels: Record<string, string> = {
      pending: 'Pending',
      approved: 'Approved',
      processed: 'Refunded',
      rejected: 'Rejected',
    };

    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${
          styles[status] || 'bg-gray-100 text-gray-800'
        }`}
      >
        {labels[status] || status}
      </span>
    );
  };

  // Filter orders
  const filteredOrders = orders.filter((order) => {
    if (!order.refund_request) return false;

    // Status filter
    if (selectedStatus !== 'all' && order.refund_request.status !== selectedStatus) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        order.number.toLowerCase().includes(query) ||
        order.billing.email.toLowerCase().includes(query) ||
        `${order.billing.first_name} ${order.billing.last_name}`
          .toLowerCase()
          .includes(query)
      );
    }

    return true;
  });

  // Calculate stats
  const stats = {
    pending: orders.filter((o) => o.refund_request?.status === 'pending').length,
    approved: orders.filter((o) => o.refund_request?.status === 'approved').length,
    processed: orders.filter((o) => o.refund_request?.status === 'processed').length,
    rejected: orders.filter((o) => o.refund_request?.status === 'rejected').length,
    pendingAmount: orders
      .filter((o) => o.refund_request?.status === 'pending')
      .reduce((sum, o) => sum + (o.refund_request?.requested_amount || 0), 0),
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Refund Requests</h1>
        <button
          onClick={fetchOrdersWithRefundRequests}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Clock className="w-8 h-8 text-yellow-600" />
            <div>
              <p className="text-2xl font-bold text-yellow-900">{stats.pending}</p>
              <p className="text-sm text-yellow-700">Pending</p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Check className="w-8 h-8 text-blue-600" />
            <div>
              <p className="text-2xl font-bold text-blue-900">{stats.approved}</p>
              <p className="text-sm text-blue-700">Approved</p>
            </div>
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold text-green-900">{stats.processed}</p>
              <p className="text-sm text-green-700">Refunded</p>
            </div>
          </div>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-8 h-8 text-purple-600" />
            <div>
              <p className="text-2xl font-bold text-purple-900">
                {formatPrice(stats.pendingAmount)}
              </p>
              <p className="text-sm text-purple-700">Pending Amount</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by order #, email, or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 appearance-none bg-white"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="processed">Processed</option>
            <option value="rejected">Rejected</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No refund requests found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Order
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <div>
                        <p className="font-medium text-gray-900">#{order.number}</p>
                        <p className="text-xs text-gray-500">
                          {order.payment_method_title}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div>
                        <p className="text-gray-900">
                          {order.billing.first_name} {order.billing.last_name}
                        </p>
                        <p className="text-xs text-gray-500">{order.billing.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-gray-900">
                        {formatPrice(order.refund_request?.requested_amount || 0)}
                      </p>
                    </td>
                    <td className="px-4 py-4 max-w-xs">
                      <p
                        className="text-gray-600 truncate"
                        title={order.refund_request?.reason}
                      >
                        {order.refund_request?.reason}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      {getStatusBadge(order.refund_request?.status || 'pending')}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm text-gray-600">
                        {formatDate(order.refund_request?.requested_at || order.date_created)}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {order.refund_request?.status === 'pending' && (
                          <>
                            <button
                              onClick={() => openActionModal(order, 'approve')}
                              className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                              title="Approve"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openActionModal(order, 'reject')}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                              title="Reject"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {order.refund_request?.status === 'approved' && (
                          <button
                            onClick={() => openActionModal(order, 'process')}
                            className="px-3 py-1 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700"
                          >
                            Process Refund
                          </button>
                        )}
                        <a
                          href={`https://admin.julinemart.com/wp-admin/post.php?post=${order.id}&action=edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                          title="View in WooCommerce"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {showActionModal && selectedOrder && selectedOrder.refund_request && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {actionType === 'approve' && 'Approve Refund Request'}
              {actionType === 'reject' && 'Reject Refund Request'}
              {actionType === 'process' && 'Process Refund'}
            </h2>

            <div className="space-y-4 mb-6">
              <div>
                <p className="text-sm text-gray-600">Order</p>
                <p className="font-medium">#{selectedOrder.number}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Customer</p>
                <p className="font-medium">
                  {selectedOrder.billing.first_name} {selectedOrder.billing.last_name}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Amount</p>
                <p className="font-medium text-lg">
                  {formatPrice(selectedOrder.refund_request.requested_amount)}
                </p>
              </div>

              {actionType === 'process' && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-sm text-yellow-800">
                    <strong>Note:</strong> This will create a refund in WooCommerce
                    {selectedOrder.transaction_id &&
                      ' and initiate a Paystack refund'}
                    .
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {actionType === 'reject' ? 'Rejection Reason *' : 'Notes (optional)'}
                </label>
                <textarea
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder={
                    actionType === 'reject'
                      ? 'Enter reason for rejection...'
                      : 'Enter any notes...'
                  }
                  required={actionType === 'reject'}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowActionModal(false);
                  setSelectedOrder(null);
                  setActionType(null);
                  setActionNotes('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAction}
                disabled={processing || (actionType === 'reject' && !actionNotes)}
                className={`flex-1 px-4 py-2 rounded-lg text-white font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  actionType === 'reject'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-primary-600 hover:bg-primary-700'
                }`}
              >
                {processing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    {actionType === 'approve' && 'Approve'}
                    {actionType === 'reject' && 'Reject'}
                    {actionType === 'process' && 'Process Refund'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}