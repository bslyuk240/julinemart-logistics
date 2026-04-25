import { useEffect, useState } from 'react';
import {
  DollarSign, TrendingUp, Clock, CheckCircle,
  Download, Plus, Eye, FileText, CreditCard, X, Package, AlertCircle
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../../lib/supabase';

interface PendingPayment {
  courier_id: string;
  courier_name: string;
  courier_code: string;
  pending_shipments: number;
  total_amount_due: number;
  approved_amount: number;
  oldest_shipment: string;
  newest_shipment: string;
}

interface Settlement {
  id: string;
  courier_id: string;
  courier_name: string;
  settlement_period_start: string;
  settlement_period_end: string;
  total_shipments: number;
  total_amount_due: number;
  total_amount_paid: number;
  status: string;
  payment_date: string;
  payment_reference: string;
  paid_by_name: string;
  created_at: string;
}

interface SubOrderRow {
  id: string;
  main_order_id: string;
  status: string;
  delivered_at: string | null;
  real_shipping_cost: number | null;
  allocated_shipping_fee: number | null;
  courier_charge: number | null;
}

interface SettlementItem {
  id: string;
  amount: number;
  sub_order_id: string;
  sub_orders: SubOrderRow | null;
}

// ─── Pending Details Modal ────────────────────────────────────────────────────
function PendingDetailsModal({ courier, onClose }: { courier: PendingPayment; onClose: () => void }) {
  const [rows, setRows] = useState<SubOrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from('sub_orders')
        .select('id, main_order_id, status, delivered_at, real_shipping_cost, allocated_shipping_fee, courier_charge')
        .eq('courier_id', courier.courier_id)
        .eq('status', 'delivered')
        .not('settlement_status', 'in', '("paid","settled")')
        .order('delivered_at', { ascending: false });

      if (!error) setRows(data || []);
      setLoading(false);
    })();
  }, [courier.courier_id]);

  const fmt = (n: number | null) =>
    n != null ? `₦${Number(n).toLocaleString()}` : '—';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{courier.courier_name} — Unsettled Deliveries</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {courier.pending_shipments} shipments · Total due ₦{courier.total_amount_due.toLocaleString()}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No unsettled deliveries found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="pb-3 pr-4">Sub-order</th>
                  <th className="pb-3 pr-4">Order</th>
                  <th className="pb-3 pr-4">Delivered</th>
                  <th className="pb-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const amount = r.real_shipping_cost ?? r.allocated_shipping_fee ?? r.courier_charge;
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">{r.id.slice(0, 8)}…</td>
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">{r.main_order_id.slice(0, 8)}…</td>
                      <td className="py-3 pr-4 text-gray-700">
                        {r.delivered_at ? new Date(r.delivered_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 text-right font-semibold text-gray-900">{fmt(amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={3} className="pt-3 font-semibold text-gray-700">Total</td>
                  <td className="pt-3 text-right font-bold text-gray-900">
                    ₦{courier.total_amount_due.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Settlement History Details Modal ────────────────────────────────────────
function SettlementDetailsModal({ settlement, onClose }: { settlement: Settlement; onClose: () => void }) {
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from('settlement_items')
        .select('id, amount, sub_order_id, sub_orders(id, main_order_id, status, delivered_at, real_shipping_cost, allocated_shipping_fee, courier_charge)')
        .eq('settlement_id', settlement.id)
        .order('created_at', { ascending: false });

      if (!error) setItems(data || []);
      setLoading(false);
    })();
  }, [settlement.id]);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      delivered: 'bg-green-100 text-green-700',
      in_transit: 'bg-blue-100 text-blue-700',
      out_for_delivery: 'bg-purple-100 text-purple-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{settlement.courier_name} — Settlement</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {new Date(settlement.settlement_period_start).toLocaleDateString()} –{' '}
              {new Date(settlement.settlement_period_end).toLocaleDateString()} ·{' '}
              {settlement.total_shipments} shipments
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Payment status banner */}
        {settlement.status === 'paid' && (
          <div className="mx-6 mt-4 bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
            <span className="text-green-900 font-medium">
              Paid on {new Date(settlement.payment_date).toLocaleDateString()}
            </span>
            <span className="text-green-700">· Ref: {settlement.payment_reference}</span>
          </div>
        )}

        {/* Items table */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No items found for this settlement.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="pb-3 pr-4">Sub-order</th>
                  <th className="pb-3 pr-4">Order</th>
                  <th className="pb-3 pr-4">Delivered</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => {
                  const so = item.sub_orders;
                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">
                        {item.sub_order_id.slice(0, 8)}…
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-gray-600">
                        {so?.main_order_id?.slice(0, 8) ?? '—'}…
                      </td>
                      <td className="py-3 pr-4 text-gray-700">
                        {so?.delivered_at ? new Date(so.delivered_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 pr-4">
                        {so?.status ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(so.status)}`}>
                            {so.status}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 text-right font-semibold text-gray-900">
                        ₦{Number(item.amount).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td colSpan={4} className="pt-3 font-semibold text-gray-700">Total</td>
                  <td className="pt-3 text-right font-bold text-gray-900">
                    ₦{Number(settlement.total_amount_due).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function SettlementsPage() {
  const notification = useNotification();
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCourier, setSelectedCourier] = useState<PendingPayment | null>(null);
  const [viewDetailsCourier, setViewDetailsCourier] = useState<PendingPayment | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [pendingRes, settlementsRes] = await Promise.all([
        fetch('/api/settlements/pending'),
        fetch('/api/settlements'),
      ]);

      const pendingData = await pendingRes.json();
      const settlementsData = await settlementsRes.json();

      if (pendingData.success) setPendingPayments(pendingData.data || []);
      if (settlementsData.success) setSettlements(settlementsData.data || []);
    } catch (error) {
      console.error('Error fetching settlements:', error);
      notification.error('Failed to Load', 'Unable to fetch settlement data');
    } finally {
      setLoading(false);
    }
  };

  const totalPending = pendingPayments.reduce((sum, p) => sum + p.total_amount_due, 0);
  const totalApproved = pendingPayments.reduce((sum, p) => sum + p.approved_amount, 0);
  const totalPaid = settlements
    .filter(s => s.status === 'paid')
    .reduce((sum, s) => sum + s.total_amount_paid, 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-lg sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <DollarSign className="w-5 h-5 sm:w-8 sm:h-8 text-green-600" />
          Courier Settlements
        </h1>
        <p className="text-gray-600 mt-2">
          Track and manage payments to courier partners
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-6 mb-8">
        <div className="card bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200 p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-5 h-5 sm:w-8 sm:h-8 text-yellow-600" />
          </div>
          <div className="text-lg sm:text-3xl font-bold text-yellow-900">
            ₦{totalPending.toLocaleString()}
          </div>
          <div className="text-[11px] sm:text-sm text-yellow-700 mt-1">Pending Payment</div>
        </div>

        <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <FileText className="w-5 h-5 sm:w-8 sm:h-8 text-blue-600" />
          </div>
          <div className="text-lg sm:text-3xl font-bold text-blue-900">
            ₦{totalApproved.toLocaleString()}
          </div>
          <div className="text-[11px] sm:text-sm text-blue-700 mt-1">Approved for Payment</div>
        </div>

        <div className="card bg-gradient-to-br from-green-50 to-green-100 border-green-200 p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-5 h-5 sm:w-8 sm:h-8 text-green-600" />
          </div>
          <div className="text-lg sm:text-3xl font-bold text-green-900">
            ₦{totalPaid.toLocaleString()}
          </div>
          <div className="text-[11px] sm:text-sm text-green-700 mt-1">Total Paid (All Time)</div>
        </div>

        <div className="card bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 p-3 sm:p-6">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-5 h-5 sm:w-8 sm:h-8 text-purple-600" />
          </div>
          <div className="text-lg sm:text-3xl font-bold text-purple-900">
            {pendingPayments.reduce((sum, p) => sum + p.pending_shipments, 0)}
          </div>
          <div className="text-[11px] sm:text-sm text-purple-700 mt-1">Pending Shipments</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'pending'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Pending Payments ({pendingPayments.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'history'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Settlement History ({settlements.length})
          </button>
        </nav>
      </div>

      {/* Pending Payments Tab */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : pendingPayments.length === 0 ? (
            <div className="card text-center py-12">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">All Settled!</h3>
              <p className="text-gray-600">No pending courier payments at the moment.</p>
            </div>
          ) : (
            pendingPayments.map((payment) => (
              <div key={payment.courier_id} className="card hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-4">
                      <h3 className="text-xl font-bold text-gray-900">
                        {payment.courier_name}
                      </h3>
                      <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
                        {payment.pending_shipments} Shipments
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <span className="text-[11px] sm:text-sm text-gray-600">Total Amount Due</span>
                        <p className="text-2xl font-bold text-gray-900">
                          ₦{payment.total_amount_due.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] sm:text-sm text-gray-600">Approved for Payment</span>
                        <p className="text-xl font-semibold text-blue-600">
                          ₦{payment.approved_amount.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-[11px] sm:text-sm text-gray-600">Period</span>
                        <p className="text-[11px] sm:text-sm font-medium text-gray-900">
                          {payment.oldest_shipment
                            ? new Date(payment.oldest_shipment).toLocaleDateString()
                            : '—'}{' '}
                          -{' '}
                          {payment.newest_shipment
                            ? new Date(payment.newest_shipment).toLocaleDateString()
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="ml-6 flex flex-col gap-2">
                    <button
                      onClick={() => {
                        setSelectedCourier(payment);
                        setShowCreateModal(true);
                      }}
                      className="btn-primary text-sm flex items-center whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Create Settlement
                    </button>
                    <button
                      onClick={() => setViewDetailsCourier(payment)}
                      className="btn-secondary text-sm flex items-center whitespace-nowrap"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Settlement History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : settlements.length === 0 ? (
            <div className="card text-center py-12">
              <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Settlement History</h3>
              <p className="text-gray-600">Settlement records will appear here once created.</p>
            </div>
          ) : (
            settlements.map((settlement) => (
              <SettlementHistoryCard
                key={settlement.id}
                settlement={settlement}
                onRefresh={fetchData}
                notification={notification}
              />
            ))
          )}
        </div>
      )}

      {/* Create Settlement Modal */}
      {showCreateModal && selectedCourier && (
        <CreateSettlementModal
          courier={selectedCourier}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedCourier(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setSelectedCourier(null);
            fetchData();
          }}
          notification={notification}
        />
      )}

      {/* View Details Modal — Pending */}
      {viewDetailsCourier && (
        <PendingDetailsModal
          courier={viewDetailsCourier}
          onClose={() => setViewDetailsCourier(null)}
        />
      )}
    </div>
  );
}

// ─── Settlement History Card ──────────────────────────────────────────────────
function SettlementHistoryCard({ settlement, onRefresh, notification }: any) {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      processing: 'bg-purple-100 text-purple-800',
      paid: 'bg-green-100 text-green-800',
      partial: 'bg-orange-100 text-orange-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="card hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{settlement.courier_name}</h3>
          <p className="text-[11px] sm:text-sm text-gray-600">
            {new Date(settlement.settlement_period_start).toLocaleDateString()} -{' '}
            {new Date(settlement.settlement_period_end).toLocaleDateString()}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(settlement.status)}`}>
          {settlement.status}
        </span>
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-4">
        <div>
          <span className="text-[11px] sm:text-sm text-gray-600">Shipments</span>
          <p className="text-base sm:text-lg font-semibold text-gray-900">{settlement.total_shipments}</p>
        </div>
        <div>
          <span className="text-[11px] sm:text-sm text-gray-600">Amount Due</span>
          <p className="text-base sm:text-lg font-semibold text-gray-900">
            ₦{settlement.total_amount_due.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-[11px] sm:text-sm text-gray-600">Amount Paid</span>
          <p className="text-base sm:text-lg font-semibold text-green-600">
            ₦{settlement.total_amount_paid.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-[11px] sm:text-sm text-gray-600">Created</span>
          <p className="text-[11px] sm:text-sm font-medium text-gray-900">
            {new Date(settlement.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {settlement.status === 'paid' && settlement.payment_reference && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-green-900 font-medium">
              Paid on {new Date(settlement.payment_date).toLocaleDateString()}
            </span>
            <span className="text-green-700">• Ref: {settlement.payment_reference}</span>
            {settlement.paid_by_name && (
              <span className="text-green-700">• By: {settlement.paid_by_name}</span>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setShowDetailsModal(true)}
          className="btn-secondary text-sm flex items-center"
        >
          <Eye className="w-4 h-4 mr-2" />
          View Details
        </button>

        {settlement.status !== 'paid' && (
          <button
            onClick={() => setShowPaymentModal(true)}
            className="btn-primary text-sm flex items-center"
          >
            <CreditCard className="w-4 h-4 mr-2" />
            Mark as Paid
          </button>
        )}

        <button className="btn-secondary text-sm flex items-center">
          <Download className="w-4 h-4 mr-2" />
          Export
        </button>
      </div>

      {showPaymentModal && (
        <MarkPaidModal
          settlement={settlement}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            setShowPaymentModal(false);
            onRefresh();
          }}
          notification={notification}
        />
      )}

      {showDetailsModal && (
        <SettlementDetailsModal
          settlement={settlement}
          onClose={() => setShowDetailsModal(false)}
        />
      )}
    </div>
  );
}

// ─── Create Settlement Modal ──────────────────────────────────────────────────
function CreateSettlementModal({ courier, onClose, onSuccess, notification }: any) {
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(
    courier.oldest_shipment
      ? new Date(courier.oldest_shipment).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(
    courier.newest_shipment
      ? new Date(courier.newest_shipment).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
  );

  const handleCreate = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courier_id: courier.courier_id,
          start_date: startDate,
          end_date: endDate,
        }),
      });

      const data = await response.json();

      if (data.success) {
        notification.success('Settlement Created', 'Settlement batch created successfully');
        onSuccess();
      } else {
        notification.error('Creation Failed', data.error || 'Unable to create settlement');
      }
    } catch (error) {
      notification.error('Error', 'Failed to create settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-4">Create Settlement</h2>

        <div className="mb-4">
          <p className="text-gray-600 mb-2">Courier: <span className="font-semibold">{courier.courier_name}</span></p>
          <p className="text-gray-600 mb-2">Shipments: <span className="font-semibold">{courier.pending_shipments}</span></p>
          <p className="text-gray-600 mb-4">Amount: <span className="font-semibold text-lg">₦{courier.total_amount_due.toLocaleString()}</span></p>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Period Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Period End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="btn-primary flex-1 flex items-center justify-center"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Creating...
              </>
            ) : (
              'Create Settlement'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mark Paid Modal ──────────────────────────────────────────────────────────
function MarkPaidModal({ settlement, onClose, onSuccess, notification }: any) {
  const [loading, setLoading] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  const handleMarkPaid = async () => {
    if (!paymentReference) {
      notification.error('Required Field', 'Payment reference is required');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/settlements/${settlement.id}/mark-paid`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_reference: paymentReference,
          payment_method: paymentMethod,
          payment_date: paymentDate,
          notes,
        }),
      });

      const data = await response.json();

      if (data.success) {
        notification.success('Payment Recorded', 'Settlement marked as paid successfully');
        onSuccess();
      } else {
        notification.error('Update Failed', data.error || 'Unable to mark as paid');
      }
    } catch (error) {
      notification.error('Error', 'Failed to update settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-4">Mark as Paid</h2>

        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">Courier: <span className="font-semibold">{settlement.courier_name}</span></p>
          <p className="text-sm text-gray-600">Amount: <span className="font-semibold text-lg">₦{settlement.total_amount_due.toLocaleString()}</span></p>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Reference *
            </label>
            <input
              type="text"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="e.g., TRF/2025/001"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="online">Online Payment</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Date
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button
            onClick={handleMarkPaid}
            disabled={loading}
            className="btn-primary flex-1 flex items-center justify-center"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Mark as Paid'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
