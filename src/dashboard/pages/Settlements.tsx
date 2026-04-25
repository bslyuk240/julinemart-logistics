import { useEffect, useState } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, Clock, CheckCircle,
  Download, Plus, Eye, FileText, CreditCard, X, Save, AlertTriangle
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
  oldest_shipment: string | null;
  newest_shipment: string | null;
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
  updated_at: string | null;
  allocated_shipping_fee: number | null;
  real_shipping_cost: number | null;
  courier_charge: number | null;
  orders: { order_number: string } | null;
}

interface SettlementItem {
  id: string;
  amount: number;
  sub_order_id: string;
  sub_orders: SubOrderRow | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number | null | undefined) =>
  n != null ? `₦${Number(n).toLocaleString()}` : '—';

function PlBadge({ value }: { value: number }) {
  const isGain = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
        isGain ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {isGain ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isGain ? '+' : ''}₦{Math.abs(value).toLocaleString()}
    </span>
  );
}

// ─── Pending Details Modal ────────────────────────────────────────────────────
function PendingDetailsModal({ courier, onClose }: { courier: PendingPayment; onClose: () => void }) {
  const [rows, setRows] = useState<SubOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // editable courier costs keyed by sub_order id — string so input stays controlled
  const [editedCosts, setEditedCosts] = useState<Record<string, string>>({});
  const notification = useNotification();

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from('sub_orders')
        .select('id, main_order_id, status, delivered_at, updated_at, allocated_shipping_fee, real_shipping_cost, courier_charge, orders(order_number)')
        .eq('courier_id', courier.courier_id)
        .eq('status', 'delivered')
        .not('settlement_status', 'in', '("paid","settled")')
        .order('delivered_at', { ascending: false });

      if (!error) {
        setRows(data || []);
        // Seed editable costs from existing real_shipping_cost
        const initial: Record<string, string> = {};
        (data || []).forEach((r: SubOrderRow) => {
          initial[r.id] = r.real_shipping_cost != null ? String(r.real_shipping_cost) : '';
        });
        setEditedCosts(initial);
      }
      setLoading(false);
    })();
  }, [courier.courier_id]);

  const handleSaveCosts = async () => {
    setSaving(true);
    try {
      const updates = rows
        .filter((r) => editedCosts[r.id] !== '' && editedCosts[r.id] !== String(r.real_shipping_cost ?? ''))
        .map((r) => ({ id: r.id, cost: Number(editedCosts[r.id]) }));

      await Promise.all(
        updates.map(({ id, cost }) =>
          (supabase as any)
            .from('sub_orders')
            .update({ real_shipping_cost: cost, updated_at: new Date().toISOString() })
            .eq('id', id)
        )
      );

      // Refresh rows so totals recalculate
      const { data } = await (supabase as any)
        .from('sub_orders')
        .select('id, main_order_id, status, delivered_at, updated_at, allocated_shipping_fee, real_shipping_cost, courier_charge, orders(order_number)')
        .eq('courier_id', courier.courier_id)
        .eq('status', 'delivered')
        .not('settlement_status', 'in', '("paid","settled")')
        .order('delivered_at', { ascending: false });

      if (data) setRows(data);
      notification.success('Costs Saved', `Updated courier cost for ${updates.length} shipment(s)`);
    } catch {
      notification.error('Save Failed', 'Could not update courier costs');
    } finally {
      setSaving(false);
    }
  };

  const hasUnsavedChanges = rows.some(
    (r) => editedCosts[r.id] !== '' && editedCosts[r.id] !== String(r.real_shipping_cost ?? '')
  );

  // Totals
  const totalCharged = rows.reduce((s, r) => s + Number(r.allocated_shipping_fee ?? 0), 0);
  const totalCost = rows.reduce((s, r) => {
    const cost = editedCosts[r.id] !== '' ? Number(editedCosts[r.id]) : Number(r.real_shipping_cost ?? r.courier_charge ?? r.allocated_shipping_fee ?? 0);
    return s + cost;
  }, 0);
  const totalPl = totalCharged - totalCost;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{courier.courier_name} — Unsettled Deliveries</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {courier.pending_shipments} shipments · Edit courier costs to see your shipping P&L
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No unsettled deliveries found.</div>
          ) : (
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="pb-3 pr-3">Order #</th>
                  <th className="pb-3 pr-3">Delivered</th>
                  <th className="pb-3 pr-3 text-right">Charged to Customer</th>
                  <th className="pb-3 pr-3 text-right">Actual Courier Cost</th>
                  <th className="pb-3 text-right">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const charged = Number(r.allocated_shipping_fee ?? 0);
                  const costInput = editedCosts[r.id] ?? '';
                  const costValue = costInput !== '' ? Number(costInput) : Number(r.real_shipping_cost ?? r.courier_charge ?? r.allocated_shipping_fee ?? 0);
                  const pl = charged - costValue;
                  const deliveredDate = r.delivered_at ?? r.updated_at;
                  const orderLabel = r.orders?.order_number ? `#${r.orders.order_number}` : r.main_order_id.slice(0, 8) + '…';

                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-3 font-medium text-gray-800">{orderLabel}</td>
                      <td className="py-3 pr-3 text-gray-600 whitespace-nowrap">
                        {deliveredDate ? new Date(deliveredDate).toLocaleDateString() : '—'}
                        {!r.delivered_at && deliveredDate && (
                          <span className="ml-1 text-[10px] text-gray-400">(est.)</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-right text-gray-900 font-medium">{fmt(charged)}</td>
                      <td className="py-3 pr-3 text-right">
                        <div className="flex items-center justify-end">
                          <span className="text-gray-500 mr-1 text-xs">₦</span>
                          <input
                            type="number"
                            min="0"
                            value={costInput}
                            onChange={(e) =>
                              setEditedCosts((prev) => ({ ...prev, [r.id]: e.target.value }))
                            }
                            placeholder={String(r.allocated_shipping_fee ?? 0)}
                            className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        {costInput !== '' || r.real_shipping_cost != null ? (
                          <PlBadge value={pl} />
                        ) : (
                          <span className="text-xs text-gray-400">Enter cost</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="pt-3 text-gray-700" colSpan={2}>Total</td>
                  <td className="pt-3 text-right text-gray-900">{fmt(totalCharged)}</td>
                  <td className="pt-3 text-right text-gray-900">{fmt(totalCost)}</td>
                  <td className="pt-3 text-right">
                    <PlBadge value={totalPl} />
                  </td>
                </tr>
                <tr>
                  <td colSpan={5} className="pt-2 text-xs text-gray-500">
                    {totalPl >= 0
                      ? `You earned ₦${totalPl.toLocaleString()} more in shipping than you paid — shipping surplus`
                      : `You paid ₦${Math.abs(totalPl).toLocaleString()} more to the courier than you charged customers — shipping loss`}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            Enter actual courier cost per shipment, then save before creating a settlement
          </p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="btn-secondary text-sm">Close</button>
            {hasUnsavedChanges && (
              <button
                onClick={handleSaveCosts}
                disabled={saving}
                className="btn-primary text-sm flex items-center gap-2"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Costs
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settlement History Details Modal ─────────────────────────────────────────
function SettlementDetailsModal({ settlement, onClose }: { settlement: Settlement; onClose: () => void }) {
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from('settlement_items')
        .select('id, amount, sub_order_id, sub_orders(id, main_order_id, status, delivered_at, updated_at, allocated_shipping_fee, real_shipping_cost, courier_charge, orders(order_number))')
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

  // Totals
  const totalCharged = items.reduce((s, i) => s + Number(i.sub_orders?.allocated_shipping_fee ?? 0), 0);
  const totalPaid = settlement.total_amount_paid;
  const totalPl = totalCharged - totalPaid;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
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

        {/* Shipping P&L summary */}
        {!loading && items.length > 0 && (
          <div className="mx-6 mt-3 grid grid-cols-3 gap-3">
            <div className="bg-blue-50 rounded-lg px-4 py-3">
              <p className="text-xs text-blue-600 font-medium">Charged to Customers</p>
              <p className="text-lg font-bold text-blue-900">{fmt(totalCharged)}</p>
            </div>
            <div className="bg-orange-50 rounded-lg px-4 py-3">
              <p className="text-xs text-orange-600 font-medium">Paid to Courier</p>
              <p className="text-lg font-bold text-orange-900">{fmt(totalPaid)}</p>
            </div>
            <div className={`rounded-lg px-4 py-3 ${totalPl >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
              <p className={`text-xs font-medium ${totalPl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                Shipping {totalPl >= 0 ? 'Gain' : 'Loss'}
              </p>
              <p className={`text-lg font-bold flex items-center gap-1 ${totalPl >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                {totalPl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {totalPl >= 0 ? '+' : ''}₦{Math.abs(totalPl).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Items table */}
        <div className="overflow-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No items found for this settlement.</div>
          ) : (
            <table className="w-full text-sm min-w-[580px]">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 border-b border-gray-100">
                  <th className="pb-3 pr-3">Order #</th>
                  <th className="pb-3 pr-3">Delivered</th>
                  <th className="pb-3 pr-3">Status</th>
                  <th className="pb-3 pr-3 text-right">Charged Customer</th>
                  <th className="pb-3 pr-3 text-right">Courier Cost</th>
                  <th className="pb-3 text-right">P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => {
                  const so = item.sub_orders;
                  const charged = Number(so?.allocated_shipping_fee ?? 0);
                  const couriCost = Number(item.amount);
                  const pl = charged - couriCost;
                  const deliveredDate = so?.delivered_at ?? so?.updated_at;
                  const orderLabel = so?.orders?.order_number
                    ? `#${so.orders.order_number}`
                    : so?.main_order_id?.slice(0, 8) + '…' ?? '—';

                  return (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-3 font-medium text-gray-800">{orderLabel}</td>
                      <td className="py-3 pr-3 text-gray-600 whitespace-nowrap">
                        {deliveredDate ? new Date(deliveredDate).toLocaleDateString() : '—'}
                        {!so?.delivered_at && deliveredDate && (
                          <span className="ml-1 text-[10px] text-gray-400">(est.)</span>
                        )}
                      </td>
                      <td className="py-3 pr-3">
                        {so?.status ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(so.status)}`}>
                            {so.status}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-3 pr-3 text-right text-gray-900">{fmt(charged)}</td>
                      <td className="py-3 pr-3 text-right text-gray-900">{fmt(couriCost)}</td>
                      <td className="py-3 text-right">
                        <PlBadge value={pl} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="pt-3 text-gray-700" colSpan={3}>Total</td>
                  <td className="pt-3 text-right text-gray-900">{fmt(totalCharged)}</td>
                  <td className="pt-3 text-right text-gray-900">{fmt(totalPaid)}</td>
                  <td className="pt-3 text-right">
                    <PlBadge value={totalPl} />
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
  // Shipping P&L: amount_due (courier charges billed) vs amount_paid (what was actually paid)
  const paidSettlements = settlements.filter(s => s.status === 'paid');
  const totalDue = paidSettlements.reduce((sum, s) => sum + s.total_amount_due, 0);
  const shippingPl = totalDue - totalPaid;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-lg sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <DollarSign className="w-5 h-5 sm:w-8 sm:h-8 text-green-600" />
          Courier Settlements
        </h1>
        <p className="text-gray-600 mt-2">
          Track payments to courier partners and monitor shipping profitability
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-8">
        <div className="card bg-gradient-to-br from-yellow-50 to-yellow-100 border-yellow-200 p-3 sm:p-6">
          <Clock className="w-5 h-5 sm:w-7 sm:h-7 text-yellow-600 mb-2" />
          <div className="text-lg sm:text-2xl font-bold text-yellow-900">
            ₦{totalPending.toLocaleString()}
          </div>
          <div className="text-[11px] sm:text-sm text-yellow-700 mt-1">Pending Payment</div>
        </div>

        <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 p-3 sm:p-6">
          <FileText className="w-5 h-5 sm:w-7 sm:h-7 text-blue-600 mb-2" />
          <div className="text-lg sm:text-2xl font-bold text-blue-900">
            ₦{totalApproved.toLocaleString()}
          </div>
          <div className="text-[11px] sm:text-sm text-blue-700 mt-1">Approved for Payment</div>
        </div>

        <div className="card bg-gradient-to-br from-green-50 to-green-100 border-green-200 p-3 sm:p-6">
          <CheckCircle className="w-5 h-5 sm:w-7 sm:h-7 text-green-600 mb-2" />
          <div className="text-lg sm:text-2xl font-bold text-green-900">
            ₦{totalPaid.toLocaleString()}
          </div>
          <div className="text-[11px] sm:text-sm text-green-700 mt-1">Total Paid (All Time)</div>
        </div>

        <div className={`card p-3 sm:p-6 border ${shippingPl >= 0 ? 'bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-200' : 'bg-gradient-to-br from-red-50 to-red-100 border-red-200'}`}>
          {shippingPl >= 0
            ? <TrendingUp className="w-5 h-5 sm:w-7 sm:h-7 text-emerald-600 mb-2" />
            : <TrendingDown className="w-5 h-5 sm:w-7 sm:h-7 text-red-600 mb-2" />}
          <div className={`text-lg sm:text-2xl font-bold ${shippingPl >= 0 ? 'text-emerald-900' : 'text-red-900'}`}>
            {shippingPl >= 0 ? '+' : ''}₦{Math.abs(shippingPl).toLocaleString()}
          </div>
          <div className={`text-[11px] sm:text-sm mt-1 ${shippingPl >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            Shipping {shippingPl >= 0 ? 'Gain' : 'Loss'} (All Time)
          </div>
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
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
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
                      <h3 className="text-xl font-bold text-gray-900">{payment.courier_name}</h3>
                      <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">
                        {payment.pending_shipments} Shipments
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <span className="text-xs text-gray-500">Courier Cost (due)</span>
                        <p className="text-2xl font-bold text-gray-900">
                          ₦{payment.total_amount_due.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500">Approved for Payment</span>
                        <p className="text-xl font-semibold text-blue-600">
                          ₦{payment.approved_amount.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-500">Period</span>
                        <p className="text-sm font-medium text-gray-900">
                          {payment.oldest_shipment
                            ? new Date(payment.oldest_shipment).toLocaleDateString()
                            : '—'}{' '}
                          –{' '}
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
                      View & Edit Costs
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
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
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
          onClose={() => { setShowCreateModal(false); setSelectedCourier(null); }}
          onSuccess={() => { setShowCreateModal(false); setSelectedCourier(null); fetchData(); }}
          notification={notification}
        />
      )}

      {/* View & Edit Costs Modal — Pending */}
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

  // Shipping saving: if amount_paid < amount_due, you paid less than initially billed
  const saving = settlement.total_amount_due - settlement.total_amount_paid;

  return (
    <div className="card hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{settlement.courier_name}</h3>
          <p className="text-sm text-gray-600">
            {new Date(settlement.settlement_period_start).toLocaleDateString()} –{' '}
            {new Date(settlement.settlement_period_end).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {settlement.status === 'paid' && saving !== 0 && (
            <PlBadge value={saving} />
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(settlement.status)}`}>
            {settlement.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div>
          <span className="text-xs text-gray-500">Shipments</span>
          <p className="text-base font-semibold text-gray-900">{settlement.total_shipments}</p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Amount Billed</span>
          <p className="text-base font-semibold text-gray-900">
            ₦{settlement.total_amount_due.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Actually Paid</span>
          <p className={`text-base font-semibold ${settlement.status === 'paid' && saving > 0 ? 'text-green-600' : 'text-gray-900'}`}>
            {settlement.status === 'paid' ? `₦${settlement.total_amount_paid.toLocaleString()}` : '—'}
          </p>
        </div>
        <div>
          <span className="text-xs text-gray-500">Created</span>
          <p className="text-sm font-medium text-gray-900">
            {new Date(settlement.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {settlement.status === 'paid' && settlement.payment_reference && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
            <span className="text-green-900 font-medium">
              Paid on {new Date(settlement.payment_date).toLocaleDateString()}
            </span>
            <span className="text-green-700">· Ref: {settlement.payment_reference}</span>
            {settlement.paid_by_name && (
              <span className="text-green-700">· By: {settlement.paid_by_name}</span>
            )}
            {saving !== 0 && (
              <span className={`font-semibold ${saving > 0 ? 'text-green-700' : 'text-red-600'}`}>
                · {saving > 0 ? `Saved ₦${saving.toLocaleString()} vs billed` : `Paid ₦${Math.abs(saving).toLocaleString()} extra vs billed`}
              </span>
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
          View P&L
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
          onSuccess={() => { setShowPaymentModal(false); onRefresh(); }}
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
        body: JSON.stringify({ courier_id: courier.courier_id, start_date: startDate, end_date: endDate }),
      });

      const data = await response.json();
      if (data.success) {
        notification.success('Settlement Created', 'Settlement batch created successfully');
        onSuccess();
      } else {
        notification.error('Creation Failed', data.error || 'Unable to create settlement');
      }
    } catch {
      notification.error('Error', 'Failed to create settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4">Create Settlement</h2>
        <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm space-y-1">
          <p className="text-gray-600">Courier: <span className="font-semibold">{courier.courier_name}</span></p>
          <p className="text-gray-600">Shipments: <span className="font-semibold">{courier.pending_shipments}</span></p>
          <p className="text-gray-600">Courier Cost: <span className="font-semibold text-base">₦{courier.total_amount_due.toLocaleString()}</span></p>
        </div>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
          Tip: Open "View &amp; Edit Costs" first to enter actual courier costs per shipment before creating this settlement.
        </p>
        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period Start</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Period End</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleCreate} disabled={loading}
            className="btn-primary flex-1 flex items-center justify-center">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" /> : null}
            {loading ? 'Creating...' : 'Create Settlement'}
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
  const [actualAmountPaid, setActualAmountPaid] = useState(String(settlement.total_amount_due));
  const [notes, setNotes] = useState('');

  const saving = settlement.total_amount_due - Number(actualAmountPaid || settlement.total_amount_due);

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
          actual_amount_paid: Number(actualAmountPaid),
        }),
      });

      const data = await response.json();
      if (data.success) {
        const msg = saving > 0
          ? `Saved ₦${saving.toLocaleString()} vs billed amount`
          : saving < 0
          ? `Paid ₦${Math.abs(saving).toLocaleString()} extra vs billed`
          : 'Paid exactly as billed';
        notification.success('Payment Recorded', msg);
        onSuccess();
      } else {
        notification.error('Update Failed', data.error || 'Unable to mark as paid');
      }
    } catch {
      notification.error('Error', 'Failed to update settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4">Mark as Paid</h2>

        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-600">Courier: <span className="font-semibold">{settlement.courier_name}</span></p>
          <p className="text-sm text-gray-600">
            Billed amount: <span className="font-semibold">₦{settlement.total_amount_due.toLocaleString()}</span>
          </p>
        </div>

        <div className="space-y-4 mb-4">
          {/* Actual amount paid — editable */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Amount Paid <span className="text-gray-400 font-normal">(edit if different from billed)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₦</span>
              <input
                type="number"
                min="0"
                value={actualAmountPaid}
                onChange={(e) => setActualAmountPaid(e.target.value)}
                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg text-right font-semibold text-lg"
              />
            </div>
            {/* P&L preview */}
            {actualAmountPaid && Number(actualAmountPaid) !== settlement.total_amount_due && (
              <p className={`text-xs mt-1 font-medium ${saving > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {saving > 0
                  ? `✓ Shipping saving: ₦${saving.toLocaleString()} less than billed`
                  : `⚠ Paying ₦${Math.abs(saving).toLocaleString()} more than billed`}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Reference *</label>
            <input type="text" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="e.g., TRF/2026/001"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg">
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="online">Online Payment</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g., Fez negotiated rate, bulk discount applied..."
              rows={2} className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleMarkPaid} disabled={loading}
            className="btn-primary flex-1 flex items-center justify-center">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" /> : null}
            {loading ? 'Saving...' : 'Mark as Paid'}
          </button>
        </div>
      </div>
    </div>
  );
}
