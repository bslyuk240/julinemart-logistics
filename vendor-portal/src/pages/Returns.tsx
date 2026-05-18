import { useEffect, useState } from 'react';
import { Package, RotateCcw, CheckCircle, XCircle, ChevronRight, X } from 'lucide-react';
import { api } from '../lib/api';

const JLO_FEZ_TRACK = 'https://fezdelivery.co/t/';

const STATUS_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  awaiting_dropoff:       { label: 'Awaiting Drop-off',       bg: 'bg-blue-100',   color: 'text-blue-700' },
  in_transit:             { label: 'In Transit',               bg: 'bg-indigo-100', color: 'text-indigo-700' },
  delivered_to_hub:       { label: 'Delivered — Pending Inspection', bg: 'bg-purple-100', color: 'text-purple-700' },
  inspection_in_progress: { label: 'Inspection in Progress',  bg: 'bg-yellow-100', color: 'text-yellow-700' },
  vendor_approved:        { label: 'Approved — Awaiting Refund', bg: 'bg-teal-100', color: 'text-teal-700' },
  refund_completed:       { label: 'Refund Completed',         bg: 'bg-green-100',  color: 'text-green-700' },
  refund_failed:          { label: 'Refund Failed',            bg: 'bg-red-100',    color: 'text-red-700' },
  rejected:               { label: 'Rejected',                 bg: 'bg-red-100',    color: 'text-red-700' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status.replace(/_/g, ' '), bg: 'bg-gray-100', color: 'text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

type ReturnShipment = {
  id: string;
  return_code: string;
  fez_tracking: string | null;
  status: string;
  method: string;
  created_at: string;
  return_requests: {
    id: string;
    order_number: string | number;
    customer_name: string;
    status: string;
    reason_code: string;
    reason_note: string | null;
    images: string[] | null;
    inspection_result: string | null;
    inspection_notes: string | null;
    rejection_reason: string | null;
  };
};

export default function Returns() {
  const [returns, setReturns]           = useState<ReturnShipment[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [selected, setSelected]         = useState<ReturnShipment | null>(null);
  const [modal, setModal]               = useState<'inspect' | null>(null);
  const [decision, setDecision]         = useState<'approve' | 'reject'>('approve');
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [actionError, setActionError]   = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.getReturns()
      .then(data => setReturns(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const confirmReceipt = async (shipment: ReturnShipment) => {
    try {
      await api.confirmReturnReceipt(shipment.id);
      load();
    } catch (e: any) {
      alert(e.message || 'Failed to confirm receipt');
    }
  };

  const openInspect = (shipment: ReturnShipment) => {
    setSelected(shipment);
    setDecision('approve');
    setInspectionNotes('');
    setRejectionReason('');
    setActionError('');
    setModal('inspect');
  };

  const closeModal = () => { setModal(null); setSelected(null); setActionError(''); };

  const submitInspection = async () => {
    if (!selected) return;
    if (decision === 'reject' && !rejectionReason.trim()) {
      setActionError('Please enter a reason for rejection.');
      return;
    }
    setSubmitting(true);
    setActionError('');
    try {
      await api.inspectReturn(selected.return_requests.id, decision, inspectionNotes, rejectionReason);
      closeModal();
      load();
    } catch (e: any) {
      setActionError(e.message || 'Failed to submit inspection');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Returns</h1>
          <p className="text-sm text-gray-500 mt-0.5">Items being returned to your store</p>
        </div>
        <button onClick={load} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {returns.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No returns assigned to your store</p>
          <p className="text-sm text-gray-400 mt-1">Returns will appear here once admin approves a customer return request involving your items.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {returns.map(ret => {
            const req = ret.return_requests;
            const canConfirm  = ['approved', 'awaiting_dropoff', 'in_transit'].includes(ret.status);
            const canInspect  = ret.status === 'delivered_to_hub' || ret.status === 'inspection_in_progress';
            const isDone      = ['vendor_approved', 'refund_completed', 'rejected', 'refund_failed'].includes(ret.status);

            return (
              <div key={ret.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {/* Main row */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-sm text-gray-900">{ret.return_code}</span>
                        <StatusBadge status={ret.status} />
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        Order <span className="font-medium">#{req.order_number}</span>
                        {' · '}{req.customer_name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Reason: {req.reason_code?.replace(/_/g, ' ') || '—'}
                        {req.reason_note ? ` — ${req.reason_note}` : ''}
                      </p>
                    </div>
                    {ret.fez_tracking && (
                      <a
                        href={`${JLO_FEZ_TRACK}${ret.fez_tracking}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary-600 hover:underline shrink-0"
                      >
                        Track
                      </a>
                    )}
                  </div>

                  {/* Inspection result if already inspected */}
                  {req.inspection_notes && (
                    <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                      <span className="font-medium">Your notes:</span> {req.inspection_notes}
                    </p>
                  )}
                  {req.rejection_reason && ret.status === 'rejected' && (
                    <p className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      <span className="font-medium">Rejection reason:</span> {req.rejection_reason}
                    </p>
                  )}

                  {/* Images */}
                  {req.images && req.images.length > 0 && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {req.images.slice(0, 4).map((url, i) => (
                        <a key={i} href={url} target="_blank" rel="noreferrer">
                          <img src={url} alt="" className="w-14 h-14 object-cover rounded-lg border border-gray-200" />
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  {!isDone && (
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {canConfirm && (
                        <button
                          onClick={() => confirmReceipt(ret)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          Confirm Receipt
                        </button>
                      )}
                      {canInspect && (
                        <button
                          onClick={() => openInspect(ret)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                          Inspect &amp; Decide
                        </button>
                      )}
                    </div>
                  )}

                  {ret.status === 'vendor_approved' && (
                    <p className="mt-3 text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2">
                      You approved this return. JulineMart admin will process the customer refund shortly.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inspect Modal */}
      {modal === 'inspect' && selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Inspect Return</h2>
              <button onClick={closeModal} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <p className="text-sm text-gray-600">
                  Order <span className="font-semibold">#{selected.return_requests.order_number}</span>
                  {' — '}{selected.return_requests.reason_code?.replace(/_/g, ' ')}
                </p>
              </div>

              {/* Decision */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Your decision</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDecision('approve')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition ${
                      decision === 'approve'
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve Return
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision('reject')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition ${
                      decision === 'reject'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <XCircle className="w-4 h-4" />
                    Reject Return
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Inspection notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  rows={3}
                  value={inspectionNotes}
                  onChange={e => setInspectionNotes(e.target.value)}
                  placeholder="e.g. Item received in good condition, original packaging intact"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                />
              </div>

              {/* Rejection reason */}
              {decision === 'reject' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason for rejection <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder="e.g. Item damaged by customer, signs of use beyond trial"
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>
              )}

              {actionError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>
              )}

              {decision === 'approve' && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  Approving will notify JulineMart admin to process the customer refund.
                  {' '}The refund amount may be adjusted by admin based on the item condition.
                </p>
              )}
            </div>

            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={closeModal}
                disabled={submitting}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitInspection}
                disabled={submitting}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 ${
                  decision === 'approve' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting ? 'Submitting…' : decision === 'approve' ? 'Approve Return' : 'Reject Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
