import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Search, Package, CheckCircle, XCircle,
  Clock, Truck, AlertTriangle, ChevronDown, ChevronUp,
  RotateCcw, DollarSign, Eye, X, Download,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { openWaybillPrint } from '../lib/waybillPrint';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

function endpointCandidates(endpoint: string) {
  const urls = [`/api/${endpoint}`, `${functionsBase}/${endpoint}`];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888/api/${endpoint}`);
    urls.push(`http://localhost:8888${functionsBase}/${endpoint}`);
  }
  return Array.from(new Set(urls));
}

async function callAdmin<T>(endpoint: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const urls = endpointCandidates(endpoint);
  let lastError: Error | null = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const isLast = i === urls.length - 1;
    try {
      const response = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...(init.headers || {}) },
      });
      if (response.status === 404 && !isLast) continue;
      const raw = await response.text();
      let body: Record<string, unknown> = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw ? { raw } : {}; }
      if (!response.ok) throw new Error(String(body?.message || body?.error || body?.raw || `Request failed (${response.status})`));
      return body as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Request failed');
      if (isLast) throw lastError;
    }
  }
  throw lastError || new Error('Request failed');
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReturnShipment {
  id: string;
  return_code: string;
  fez_tracking: string | null;
  fez_shipment_id: string | null;
  status: string;
  method: string;
  destination_type: 'hub' | 'vendor' | null;
  destination_address: Record<string, string> | null;
  vendor_id: string | null;
  label_url: string | null;
  waybill_number: string | null;
  customer_submitted_tracking: boolean;
  /** Set when a local rider collects this return (a manual shipment to the hub). */
  manual_shipment_id?: string | null;
  /** Set when a courier API holds the pickup booking (e.g. 'shipbubble'). */
  provider?: string | null;
  tracking_url?: string | null;
  created_at: string;
}

interface PickupDetails {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  preferred_date: string | null;
  notes: string | null;
}

interface OrderPayment {
  order_number: string | number;
  total_amount: number;
  payment_method: string;
  payment_reference: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string;
  delivery_state: string;
  delivery_city: string;
  is_paystack: boolean;
}

interface ReturnRequest {
  id: string;
  order_id: number | null;
  supabase_order_id: string | null;
  order_number: string;
  customer_name: string;
  customer_email: string;
  status: string;
  reason_code: string;
  reason_note: string | null;
  images: string[] | null;
  refund_amount: number | null;
  refund_status: string | null;
  refund_method: string | null;
  paystack_refund_id: string | null;
  refund_completed_at: string | null;
  refund_currency: string | null;
  rejection_reason: string | null;
  inspection_result: string | null;
  inspection_notes: string | null;
  inspected_at: string | null;
  hub_id: string | null;
  created_at: string;
  updated_at: string;
  /** 'pickup' or 'dropoff'. */
  fez_method?: string | null;
  pickup?: PickupDetails | null;
  /** What the customer owes for the pickup (0 when it's our fault). */
  pickup_fee?: number | null;
  pickup_lane?: 'fez' | 'local_rider' | 'shipbubble' | null;
  return_shipments: ReturnShipment[];
  order_payment: OrderPayment | null;
}

interface QueueStats {
  pending_review: number;
  approved: number;
  in_transit: number;
  delivered_to_hub: number;
  vendor_approved: number;
  refund_completed: number;
  rejected: number;
  refund_failed: number;
}

interface QueueResponse {
  data: ReturnRequest[];
  total: number;
  stats: QueueStats;
  /** Which pickup lanes can be booked right now (Shipbubble needs its migration). */
  pickup_capabilities?: { shipbubble?: boolean };
}

const PICKUP_LANE_LABEL: Record<string, string> = {
  local_rider: 'local rider',
  fez: 'Fez',
  shipbubble: 'Shipbubble',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending_review:        { label: 'Pending Review',        color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
  approved:              { label: 'Approved',               color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  awaiting_dropoff:      { label: 'Awaiting Drop-off',      color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  awaiting_pickup:       { label: 'Awaiting Pickup',        color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  awaiting_tracking:     { label: 'Awaiting Tracking',      color: 'text-gray-600',   bg: 'bg-gray-50 border-gray-200' },
  in_transit:            { label: 'In Transit',             color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
  delivered_to_hub:      { label: 'Delivered to Hub',       color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  inspection_in_progress:{ label: 'Inspection in Progress', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  vendor_approved:       { label: 'Vendor Approved',        color: 'text-teal-700',   bg: 'bg-teal-50 border-teal-200' },
  refund_processing:     { label: 'Refund Processing',      color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  refund_completed:      { label: 'Refund Completed',       color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
  refund_failed:         { label: 'Refund Failed',          color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
  rejected:              { label: 'Rejected',               color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
  completed:             { label: 'Completed',              color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function fmt(v?: number | null) {
  if (v == null) return '—';
  return `₦${Number(v).toLocaleString()}`;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_FILTER_OPTIONS = [
  { value: 'all',              label: 'All' },
  { value: 'pending_review',   label: 'Pending Review' },
  { value: 'approved,awaiting_dropoff,awaiting_pickup', label: 'Approved / Awaiting Drop-off or Pickup' },
  { value: 'in_transit',       label: 'In Transit' },
  { value: 'delivered_to_hub,inspection_in_progress', label: 'At Hub / Inspection' },
  { value: 'vendor_approved', label: 'Vendor Approved' },
  { value: 'refund_processing,refund_completed', label: 'Refund' },
  { value: 'refund_failed',    label: 'Refund Failed' },
  { value: 'rejected',         label: 'Rejected' },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReturnsPage() {
  const { session, user } = useAuth();
  const notification = useNotification();
  const canRefund = ['admin', 'manager'].includes(user?.role || '');

  const [items, setItems] = useState<ReturnRequest[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modal state
  const [modal, setModal] = useState<{
    type: 'approve' | 'reject' | 'inspect' | null;
    item: ReturnRequest | null;
  }>({ type: null, item: null });
  const [rejectionReason, setRejectionReason] = useState('');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [pickupLane, setPickupLane] = useState<'auto' | 'fez' | 'local_rider' | 'shipbubble'>('auto');
  const [canShipbubble, setCanShipbubble] = useState(false);
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      if (search) params.set('search', search);
      const res = await callAdmin<QueueResponse>(`returns-queue?${params}`, session.access_token);
      setItems(res.data || []);
      setStats(res.stats || null);
      setTotal(res.total || 0);
      setCanShipbubble(Boolean(res.pickup_capabilities?.shipbubble));
    } catch (err) {
      notification.error('Failed to load returns');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!modal.item || !session?.access_token) return;
    setSubmitting(true);
    try {
      const isPickup = modal.item.fez_method === 'pickup' && Boolean(modal.item.pickup);
      const res = await callAdmin<{ data?: { pickup?: { lane: string; manual_shipment_code: string | null; carrier?: { courier: string; cost: number } | null } | null; errors?: string[] | null } }>(
        'admin-approve-return',
        session.access_token,
        {
          method: 'POST',
          body: JSON.stringify({
            return_request_id: modal.item.id,
            action: 'approve',
            // 'auto' lets the server pick: a local rider in the hub's town, Fez elsewhere.
            ...(isPickup && pickupLane !== 'auto' ? { pickup_lane: pickupLane } : {}),
          }),
        }
      );
      if (res?.data?.errors?.length) {
        // Approved, but something needs a person (e.g. no riders online yet).
        notification.error(`Approved, but: ${res.data.errors.join(' · ')}`);
      } else if (isPickup && res?.data?.pickup?.lane === 'shipbubble' && res.data.pickup.carrier) {
        notification.success(`Return approved: Shipbubble pickup booked with ${res.data.pickup.carrier.courier} (${fmt(res.data.pickup.carrier.cost)}), customer notified`);
      } else if (isPickup && res?.data?.pickup?.lane === 'local_rider') {
        notification.success(`Return approved — rider pickup ${res.data.pickup.manual_shipment_code || ''} sent to riders, customer notified`);
      } else {
        notification.success('Return approved — Fez shipments created, customer notified');
      }
      setModal({ type: null, item: null });
      load();
    } catch (err: any) {
      notification.error(err?.message || 'Failed to approve return');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (!modal.item || !session?.access_token || !rejectionReason.trim()) return;
    setSubmitting(true);
    try {
      await callAdmin('admin-approve-return', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ return_request_id: modal.item.id, action: 'reject', rejection_reason: rejectionReason.trim() }),
      });
      notification.success('Return rejected — customer notified');
      setModal({ type: null, item: null });
      setRejectionReason('');
      load();
    } catch (err: any) {
      notification.error(err?.message || 'Failed to reject return');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkStatus(item: ReturnRequest, newStatus: string) {
    if (!session?.access_token) return;
    try {
      if (newStatus === 'delivered_to_hub' || newStatus === 'inspection_in_progress') {
        // Progress steps go through update-return-status, which has the real
        // status transitions. (The inspection endpoint only takes approved or
        // rejected, so these buttons used to fail.) Each shipment moves in turn.
        const shipments = (item.return_shipments || []).filter((s) => s.status !== newStatus);
        if (!shipments.length) throw new Error('This return has no shipment to update yet');
        for (const s of shipments) {
          await callAdmin(`update-return-status/return-shipments/${s.id}/status`, session.access_token, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus }),
          });
        }
      } else {
        await callAdmin(`returns/${item.id}/inspection`, session.access_token, {
          method: 'POST',
          body: JSON.stringify({ status: newStatus }),
        });
      }
      notification.success(`Status updated to ${STATUS_CONFIG[newStatus]?.label || newStatus}`);
      load();
    } catch (err: any) {
      notification.error(err?.message || 'Failed to update status');
    }
  }

  async function handleProcessRefund() {
    if (!modal.item || !session?.access_token || !approvedAmount) return;
    const amount = parseFloat(approvedAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      notification.error('Enter a valid refund amount');
      return;
    }
    setSubmitting(true);
    try {
      await callAdmin(`returns/${modal.item.id}/inspection`, session.access_token, {
        method: 'POST',
        body: JSON.stringify({
          status: 'approved',
          approved_refund_amount: amount,
          inspection_notes: inspectionNotes.trim() || undefined,
          inspection_result: 'passed',
        }),
      });
      notification.success('Refund processed — customer notified');
      setModal({ type: null, item: null });
      setApprovedAmount('');
      setInspectionNotes('');
      load();
    } catch (err: any) {
      notification.error(err?.message || 'Failed to process refund');
    } finally {
      setSubmitting(false);
    }
  }

  function openModal(type: 'approve' | 'reject' | 'inspect', item: ReturnRequest) {
    setModal({ type, item });
    setRejectionReason('');
    setPickupLane('auto');
    // If the customer owes a pickup fee, start from the order total less that
    // fee, so the deduction isn't forgotten. Staff can still change it.
    const fee = Number(item.pickup_fee || 0);
    const orderTotal = Number(item.order_payment?.total_amount || 0);
    setApprovedAmount(
      item.refund_amount
        ? String(item.refund_amount)
        : type === 'inspect' && fee > 0 && orderTotal > fee
        ? String(orderTotal - fee)
        : ''
    );
    setInspectionNotes('');
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Returns</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage customer return requests and refunds</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { key: 'pending_review', label: 'Pending Review', icon: Clock, color: 'text-amber-600' },
            { key: 'approved', label: 'Approved', icon: CheckCircle, color: 'text-blue-600' },
            { key: 'in_transit', label: 'In Transit', icon: Truck, color: 'text-indigo-600' },
            { key: 'delivered_to_hub', label: 'At Hub', icon: Package, color: 'text-purple-600' },
            { key: 'vendor_approved', label: 'Vendor Approved', icon: CheckCircle, color: 'text-teal-600' },
            { key: 'refund_completed', label: 'Refunded', icon: DollarSign, color: 'text-green-600' },
            { key: 'refund_failed', label: 'Failed', icon: AlertTriangle, color: 'text-red-600' },
            { key: 'rejected', label: 'Rejected', icon: XCircle, color: 'text-red-600' },
          ].map(({ key, label, icon: Icon, color }) => (
            <div
              key={key}
              className="bg-white rounded-xl border border-gray-200 p-3 cursor-pointer hover:border-purple-300 transition-colors"
              onClick={() => setStatusFilter(key)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{label}</span>
                <Icon className={`w-3.5 h-3.5 ${color}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats[key as keyof QueueStats] ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search order #, email, or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          {STATUS_FILTER_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Table — desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Order</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Reason</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && items.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">No returns found</td></tr>
            ) : items.map(item => (
              <>
                <tr
                  key={item.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">#{item.order_number}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{item.customer_name}</p>
                    <p className="text-xs text-gray-400">{item.customer_email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-[160px]">
                    <p className="truncate">{item.reason_code?.replace(/_/g, ' ')}</p>
                    {item.reason_note && <p className="text-xs text-gray-400 truncate">{item.reason_note}</p>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                  <td className="px-4 py-3 text-gray-700">{fmt(item.refund_amount)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(item.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <ActionButtons item={item} onApprove={() => openModal('approve', item)} onReject={() => openModal('reject', item)} onInspect={() => openModal('inspect', item)} onMarkStatus={handleMarkStatus} canRefund={canRefund} />
                  </td>
                </tr>
                {expandedId === item.id && (
                  <tr key={`${item.id}-expanded`}>
                    <td colSpan={7} className="px-4 pb-4 bg-gray-50">
                      <ExpandedDetail item={item} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {total > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
            Showing {items.length} of {total} returns
          </div>
        )}
      </div>

      {/* Cards — mobile */}
      <div className="md:hidden space-y-3">
        {loading && items.length === 0 ? (
          <p className="text-center text-gray-400 py-8">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No returns found</p>
        ) : items.map(item => (
          <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-gray-900">#{item.order_number}</p>
                <p className="text-sm text-gray-500">{item.customer_name}</p>
              </div>
              <StatusBadge status={item.status} />
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Reason:</span> {item.reason_code?.replace(/_/g, ' ')}
              {item.reason_note && <p className="text-xs text-gray-400 mt-0.5">{item.reason_note}</p>}
            </div>
            {item.refund_amount && (
              <p className="text-sm"><span className="font-medium">Amount:</span> {fmt(item.refund_amount)}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <ActionButtons item={item} onApprove={() => openModal('approve', item)} onReject={() => openModal('reject', item)} onInspect={() => openModal('inspect', item)} onMarkStatus={handleMarkStatus} canRefund={canRefund} />
            </div>
            <button
              onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              className="flex items-center gap-1 text-xs text-purple-600 font-medium"
            >
              {expandedId === item.id ? <><ChevronUp className="w-3 h-3" />Hide details</> : <><ChevronDown className="w-3 h-3" />View details</>}
            </button>
            {expandedId === item.id && <ExpandedDetail item={item} />}
          </div>
        ))}
      </div>

      {/* Modals */}
      {modal.type === 'approve' && modal.item && (
        <Modal title="Approve Return Request" onClose={() => setModal({ type: null, item: null })}>
          <div className="space-y-4">
            {modal.item.fez_method === 'pickup' && modal.item.pickup ? (
              <>
                <p className="text-sm text-gray-600">
                  The customer asked for a <strong>pickup</strong>. Approving books it and emails them.
                </p>
                <DetailRow label="Collect from" value={[modal.item.pickup.address, modal.item.pickup.city, modal.item.pickup.state].filter(Boolean).join(', ')} />
                <DetailRow label="Contact" value={`${modal.item.pickup.name} · ${modal.item.pickup.phone}`} />
                {modal.item.pickup.preferred_date && <DetailRow label="Preferred day" value={modal.item.pickup.preferred_date} />}
                {modal.item.pickup.notes && <DetailRow label="Note" value={modal.item.pickup.notes} />}
                <DetailRow
                  label="Pickup cost"
                  value={Number(modal.item.pickup_fee || 0) > 0
                    ? `Customer owes ${fmt(modal.item.pickup_fee)}: deduct it from the refund`
                    : 'JulineMart pays (our fault)'}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Who collects it</label>
                  <select
                    value={pickupLane}
                    onChange={e => setPickupLane(e.target.value as 'auto' | 'fez' | 'local_rider' | 'shipbubble')}
                    className="w-full text-sm border border-gray-300 rounded-lg p-2.5 bg-white"
                  >
                    <option value="auto">Automatic: local rider in the hub's town, otherwise Fez</option>
                    <option value="local_rider">Local rider (offered to online riders, delivered to the hub)</option>
                    <option value="fez">Fez (books a courier pickup)</option>
                    {canShipbubble && (
                      <option value="shipbubble">Shipbubble (books the cheapest available courier)</option>
                    )}
                  </select>
                  {pickupLane === 'shipbubble' && (
                    <p className="mt-1 text-xs text-gray-500">
                      Books straight away and charges your Shipbubble wallet. If no courier is available nothing is saved and you can pick another option.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-600">
                Approving this return will create Fez return shipments and email the customer their tracking number(s).
              </p>
            )}
            <DetailRow label="Order" value={`#${modal.item.order_number}`} />
            <DetailRow label="Customer" value={modal.item.customer_name} />
            <DetailRow label="Reason" value={modal.item.reason_code?.replace(/_/g, ' ') || ''} />
            {modal.item.return_shipments?.length > 0 && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                This request already has shipments — approving again will create additional ones.
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModal({ type: null, item: null })} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleApprove} disabled={submitting} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {submitting ? 'Approving…' : 'Approve & Create Shipment'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal.type === 'reject' && modal.item && (
        <Modal title="Reject Return Request" onClose={() => setModal({ type: null, item: null })}>
          <div className="space-y-4">
            <DetailRow label="Order" value={`#${modal.item.order_number}`} />
            <DetailRow label="Customer" value={modal.item.customer_name} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason for rejection <span className="text-red-500">*</span></label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Explain why this return is being rejected…"
                className="w-full text-sm border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModal({ type: null, item: null })} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleReject} disabled={submitting || !rejectionReason.trim()} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {submitting ? 'Rejecting…' : 'Reject Request'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal.type === 'inspect' && modal.item && (
        <Modal title="Process Refund" onClose={() => setModal({ type: null, item: null })}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              This will trigger a Paystack refund to the customer's original payment method. This action cannot be undone.
            </p>
            <DetailRow label="Order" value={`#${modal.item.order_number}`} />
            <DetailRow label="Customer" value={modal.item.customer_name} />
            <DetailRow label="Payment ref" value={modal.item.order_payment?.payment_reference || '—'} />
            {Number(modal.item.pickup_fee || 0) > 0 && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                The customer chose a pickup that they pay for ({fmt(modal.item.pickup_fee)}). Order total {fmt(modal.item.order_payment?.total_amount)}, so a full refund after the pickup fee is {fmt(Math.max(0, Number(modal.item.order_payment?.total_amount || 0) - Number(modal.item.pickup_fee || 0)))}.
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Approved refund amount (₦) <span className="text-red-500">*</span></label>
              <input
                type="number"
                value={approvedAmount}
                onChange={e => setApprovedAmount(e.target.value)}
                placeholder="e.g. 15000"
                className="w-full text-sm border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Inspection notes (optional)</label>
              <textarea
                rows={2}
                value={inspectionNotes}
                onChange={e => setInspectionNotes(e.target.value)}
                placeholder="Any notes about the inspection…"
                className="w-full text-sm border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setModal({ type: null, item: null })} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleProcessRefund} disabled={submitting || !approvedAmount} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {submitting ? 'Processing…' : 'Process Refund'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ActionButtons({
  item, onApprove, onReject, onInspect, onMarkStatus, canRefund,
}: {
  item: ReturnRequest;
  onApprove: () => void;
  onReject: () => void;
  onInspect: () => void;
  onMarkStatus: (item: ReturnRequest, status: string) => void;
  canRefund: boolean;
}) {
  const { status } = item;

  // Releasing a refund is admin/manager only (the server enforces this too).
  // Agents still triage: approve/reject the request, book the courier.
  if (!canRefund && ['vendor_approved', 'inspection_in_progress', 'refund_failed'].includes(status)) {
    return <span className="text-xs text-gray-500">Refund needs an admin or manager</span>;
  }

  if (status === 'pending_review') {
    return (
      <div className="flex gap-2">
        <button onClick={e => { e.stopPropagation(); onApprove(); }} className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium">
          Approve
        </button>
        <button onClick={e => { e.stopPropagation(); onReject(); }} className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 font-medium">
          Reject
        </button>
      </div>
    );
  }

  if (status === 'approved' || status === 'awaiting_dropoff' || status === 'awaiting_pickup' || status === 'in_transit') {
    return (
      <button
        onClick={e => { e.stopPropagation(); onMarkStatus(item, 'delivered_to_hub'); }}
        className="text-xs px-3 py-1.5 border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 font-medium"
      >
        Mark Delivered to Hub
      </button>
    );
  }

  if (status === 'delivered_to_hub') {
    return (
      <button
        onClick={e => { e.stopPropagation(); onMarkStatus(item, 'inspection_in_progress'); }}
        className="text-xs px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 font-medium"
      >
        Start Inspection
      </button>
    );
  }

  if (status === 'vendor_approved') {
    return (
      <div className="flex gap-2">
        <button onClick={e => { e.stopPropagation(); onInspect(); }} className="text-xs px-3 py-1.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium">
          Process Refund
        </button>
      </div>
    );
  }

  if (status === 'inspection_in_progress') {
    return (
      <div className="flex gap-2">
        <button onClick={e => { e.stopPropagation(); onInspect(); }} className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium">
          Process Refund
        </button>
        <button onClick={e => { e.stopPropagation(); onMarkStatus(item, 'rejected'); }} className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 font-medium">
          Reject
        </button>
      </div>
    );
  }

  if (status === 'refund_failed') {
    return (
      <button onClick={e => { e.stopPropagation(); onInspect(); }} className="text-xs px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 font-medium">
        Retry Refund
      </button>
    );
  }

  return null;
}

function ExpandedDetail({ item }: { item: ReturnRequest }) {
  return (
    <div className="pt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Return info */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Return Details</p>
        <DetailRow label="Return ID" value={item.id.slice(0, 8)} />
        <DetailRow label="Reason" value={item.reason_code?.replace(/_/g, ' ') || '—'} />
        {item.reason_note && <DetailRow label="Notes" value={item.reason_note} />}
        {item.fez_method === 'pickup' && item.pickup && (
          <>
            <DetailRow label="Method" value={`Pickup${item.pickup_lane ? ` (${PICKUP_LANE_LABEL[item.pickup_lane] || item.pickup_lane})` : ''}`} />
            <DetailRow label="Collect from" value={[item.pickup.address, item.pickup.city, item.pickup.state].filter(Boolean).join(', ')} />
            <DetailRow label="Contact" value={`${item.pickup.name} · ${item.pickup.phone}`} />
            {item.pickup.preferred_date && <DetailRow label="Preferred day" value={item.pickup.preferred_date} />}
            <DetailRow
              label="Pickup cost"
              value={Number(item.pickup_fee || 0) > 0 ? `Customer owes ${fmt(item.pickup_fee)}` : 'JulineMart pays'}
            />
          </>
        )}
        {item.rejection_reason && <DetailRow label="Rejection reason" value={item.rejection_reason} />}
        {item.inspection_notes && <DetailRow label="Inspection notes" value={item.inspection_notes} />}
        {item.refund_amount && <DetailRow label="Refund amount" value={fmt(item.refund_amount)} />}
        {item.refund_completed_at && <DetailRow label="Refunded at" value={fmtDate(item.refund_completed_at)} />}
        {item.paystack_refund_id && <DetailRow label="Paystack refund ID" value={String(item.paystack_refund_id)} />}
      </div>

      {/* Shipments */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Shipments ({item.return_shipments?.length || 0})
        </p>
        {!item.return_shipments?.length ? (
          <p className="text-xs text-gray-400 italic">No shipments yet — approve to create</p>
        ) : item.return_shipments.map(s => (
          <div key={s.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-gray-800">{s.return_code}</span>
              <StatusBadge status={s.status} />
            </div>
            <DetailRow label="Destination" value={s.destination_type === 'vendor' ? 'Vendor' : 'Hub'} />
            {s.manual_shipment_id && <DetailRow label="Handled by" value="Local rider (see Manual Shipments)" />}
            {s.provider === 'shipbubble' && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Handled by</span>
                {s.tracking_url ? (
                  <a
                    href={s.tracking_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-purple-600 hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    Shipbubble courier: track
                  </a>
                ) : (
                  <span className="text-xs text-gray-700">Shipbubble courier</span>
                )}
              </div>
            )}
            {s.destination_address && (
              <DetailRow
                label="Address"
                value={[s.destination_address.name, s.destination_address.address, s.destination_address.state].filter(Boolean).join(', ')}
              />
            )}
            {s.fez_tracking && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Tracking</span>
                <a
                  href={`https://web.fezdelivery.co/track-delivery?tracking=${s.fez_tracking}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-purple-600 font-mono hover:underline"
                  onClick={e => e.stopPropagation()}
                >
                  {s.fez_tracking}
                </a>
              </div>
            )}
            {s.waybill_number && (
              <DetailRow label="Waybill No" value={s.waybill_number} />
            )}
            {s.fez_tracking && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void openWaybillPrint({ returnShipmentId: s.id }).catch((err) => {
                    alert(err instanceof Error ? err.message : 'Could not open waybill');
                  });
                }}
                className="btn-secondary text-xs flex items-center w-full justify-center mt-1"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Download Waybill
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Order payment */}
      {item.order_payment && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Order Payment</p>
          <DetailRow label="Total" value={fmt(item.order_payment.total_amount)} />
          <DetailRow label="Method" value={item.order_payment.payment_method || '—'} />
          <DetailRow label="Reference" value={item.order_payment.payment_reference || '—'} />
          <DetailRow label="Address" value={[item.order_payment.delivery_address, item.order_payment.delivery_city, item.order_payment.delivery_state].filter(Boolean).join(', ')} />
        </div>
      )}

      {/* Images */}
      {item.images && item.images.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Images ({item.images.length})</p>
          <div className="flex flex-wrap gap-2">
            {item.images.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                <img src={url} alt={`return-img-${i}`} className="w-16 h-16 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-900 text-right break-all">{value || '—'}</span>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
