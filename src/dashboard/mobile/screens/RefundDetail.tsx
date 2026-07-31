import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Image, Loader, Phone, XCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import { formatNaira, statusLabel, statusStyle } from '../lib/displayUtils';

interface OrderPayment {
  order_number: string | number;
  total_amount: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}

interface ReturnRequest {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string | null;
  status: string;
  reason_code: string;
  reason_note: string | null;
  images: string[] | null;
  refund_amount: number | null;
  created_at: string;
  updated_at: string;
  order_payment: OrderPayment | null;
}

export default function MobileRefundDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const notification = useNotification();

  const [item, setItem] = useState<ReturnRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const accessToken = session?.access_token;

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    setLoading(true);
    try {
      const res = await fetch(`${functionsBase}/returns-queue?status=all&limit=50`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to load return');
      const found = (payload.data as ReturnRequest[] | undefined)?.find((r) => r.id === id) ?? null;
      setItem(found);
      if (!found) notification.error('Not found', 'Return request not found');
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load return');
    } finally {
      setLoading(false);
    }
  }, [accessToken, id, notification]);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async () => {
    if (!item || !accessToken) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${functionsBase}/admin-approve-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ return_request_id: item.id, action: 'approve' }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to approve return');
      notification.success('Return approved — Fez shipments created, customer notified');
      navigate('/admin/refunds');
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to approve return');
    } finally {
      setSubmitting(false);
    }
  };

  const reject = async () => {
    if (!item || !accessToken || !rejectionReason.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${functionsBase}/admin-approve-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ return_request_id: item.id, action: 'reject', rejection_reason: rejectionReason.trim() }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Failed to reject return');
      notification.success('Return rejected — customer notified');
      navigate('/admin/refunds');
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to reject return');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!item) {
    return <div className="p-4 text-sm text-gray-500">Return request not found.</div>;
  }

  const phone = item.order_payment?.customer_phone;
  const orderTotal = item.order_payment?.total_amount ?? item.refund_amount ?? 0;
  const images = Array.isArray(item.images) ? item.images : [];
  const canReview = item.status === 'pending_review';

  return (
    <div className="bg-gray-50 pb-24">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-white px-3 py-2.5">
        <button type="button" onClick={() => navigate('/admin/refunds')} className="text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">#{item.order_number}</p>
          <p className="truncate text-[11px] text-gray-400">{item.customer_name}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusStyle(item.status)}`}>
          {statusLabel(item.status)}
        </span>
      </div>

      <div className="space-y-0 p-0">
        <div className="border-b border-gray-100 bg-white px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Customer</p>
          <p className="mt-0.5 text-lg font-bold text-gray-900">{item.customer_name}</p>
          {item.customer_email && <p className="text-sm text-gray-600">{item.customer_email}</p>}
          {phone && (
            <a href={`tel:${phone}`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary-600">
              <Phone className="h-3.5 w-3.5" />
              {phone}
            </a>
          )}
        </div>

        <div className="mt-3 mx-4 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Reason</p>
          <p className="mt-1 text-sm font-medium capitalize text-gray-900">{item.reason_code?.replace(/_/g, ' ')}</p>
          {item.reason_note && <p className="mt-1 text-sm text-gray-600">{item.reason_note}</p>}
        </div>

        <div className="mt-3 mx-4 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Amounts</p>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-gray-500">Order total</span>
            <span className="font-semibold text-gray-900">{formatNaira(orderTotal)}</span>
          </div>
          {item.refund_amount != null && (
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-gray-500">Requested refund</span>
              <span className="font-bold text-orange-600">{formatNaira(item.refund_amount)}</span>
            </div>
          )}
        </div>

        {images.length > 0 && (
          <div className="mt-3 mx-4 rounded-xl border border-gray-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">Photos</p>
            <div className="grid grid-cols-3 gap-2">
              {images.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-lg bg-gray-100">
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}

        {images.length === 0 && (
          <div className="mt-3 mx-4 rounded-xl border border-gray-200 bg-white p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">Photos</p>
            <div className="flex aspect-[3/1] items-center justify-center rounded-lg bg-gray-50 text-xs text-gray-400">
              <Image className="mr-1.5 h-4 w-4" />
              No photos attached
            </div>
          </div>
        )}

        <div className="mt-3 mx-4 rounded-xl border border-gray-200 bg-white p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">Timeline</p>
          <p className="text-sm text-gray-900">Submitted {new Date(item.created_at).toLocaleString('en-NG')}</p>
          {item.updated_at !== item.created_at && (
            <p className="mt-1 text-xs text-gray-500">Updated {new Date(item.updated_at).toLocaleString('en-NG')}</p>
          )}
        </div>
      </div>

      {canReview && (
        <div className="fixed inset-x-0 z-20 border-t border-gray-100 bg-white px-4 py-3" style={{ bottom: TABBAR_SPACE }}>
          {rejecting ? (
            <div className="space-y-2">
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Reason for rejecting (sent to customer)"
                rows={2}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setRejecting(false)} className="rounded-lg border border-gray-200 py-3 text-sm font-semibold text-gray-900">
                  Back
                </button>
                <button
                  type="button"
                  onClick={reject}
                  disabled={submitting || !rejectionReason.trim()}
                  className="rounded-lg bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? 'Rejecting…' : 'Confirm reject'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-700"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
              <button
                type="button"
                onClick={approve}
                disabled={submitting}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                {submitting ? 'Approving…' : 'Approve'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
