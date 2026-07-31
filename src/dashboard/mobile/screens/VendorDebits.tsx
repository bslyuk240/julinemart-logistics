import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Banknote, ExternalLink, Link2, Loader, Search, XCircle } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { vendorFetch } from '../lib/vendorApi';

interface VendorDebit {
  id: string;
  vendor_id: string;
  return_request_id: string | null;
  amount: number;
  status: 'pending' | 'deducted' | 'paid_back' | 'waived';
  recovery_method: string | null;
  notes: string | null;
  paystack_payment_link: string | null;
  paystack_reference: string | null;
  created_at: string;
  vendors?: { store_name: string; email: string } | null;
  return_requests?: {
    id: string;
    order_id: string;
    orders?: { order_number: string | number } | null;
  } | null;
}

type ActionType = 'send-payment-link' | 'mark-paid' | 'waive';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-yellow-100 text-yellow-700' },
  deducted: { label: 'Deducted', cls: 'bg-blue-100 text-blue-700' },
  paid_back: { label: 'Paid back', cls: 'bg-green-100 text-green-700' },
  waived: { label: 'Waived', cls: 'bg-gray-100 text-gray-600' },
};

export default function MobileVendorDebits() {
  const notification = useNotification();
  const [debits, setDebits] = useState<VendorDebit[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ debit: VendorDebit; action: ActionType } | null>(null);
  const [notes, setNotes] = useState('');
  const [payRef, setPayRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    const res = await vendorFetch<{ success?: boolean; data?: VendorDebit[] }>('admin-vendor-debits', 'GET', params);
    setDebits(res.success ? res.data || [] : []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return debits;
    const q = search.toLowerCase();
    return debits.filter(
      (d) =>
        d.vendors?.store_name?.toLowerCase().includes(q) ||
        d.vendors?.email?.toLowerCase().includes(q) ||
        String(d.return_requests?.orders?.order_number || '').toLowerCase().includes(q),
    );
  }, [debits, search]);

  const totalPending = debits.filter((d) => d.status === 'pending').reduce((s, d) => s + Number(d.amount), 0);

  const submitAction = async () => {
    if (!acting) return;
    setSubmitting(true);
    const body: Record<string, string> = { action: acting.action, debit_id: acting.debit.id };
    if (notes) body.notes = notes;
    if (acting.action === 'mark-paid' && payRef) body.payment_reference = payRef;
    const res = await vendorFetch<{ success?: boolean; error?: string }>('admin-vendor-debits', 'POST', body);
    setSubmitting(false);
    if (res.success) {
      notification.success(
        'Updated',
        acting.action === 'send-payment-link'
          ? 'Payment link sent'
          : acting.action === 'mark-paid'
            ? 'Debit marked paid'
            : 'Debit waived',
      );
      setActing(null);
      setNotes('');
      setPayRef('');
      load();
    } else {
      notification.error('Action failed', res.error || 'Unable to update debit');
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Vendor Debits</h1>
            <p className="text-xs text-gray-500">Return-related vendor recoveries</p>
          </div>

          {totalPending > 0 && statusFilter === 'pending' && (
            <div className="flex gap-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{formatNaira(totalPending)}</strong> outstanding across pending debits
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-gray-100">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vendor or order…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ fontSize: '16px' }}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border border-gray-200 px-2 py-2 text-xs"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="deducted">Deducted</option>
              <option value="paid_back">Paid back</option>
              <option value="waived">Waived</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No debits found.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((d) => (
                <div key={d.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{d.vendors?.store_name || '—'}</p>
                      <p className="text-xs text-gray-500">
                        Order #{d.return_requests?.orders?.order_number || d.return_requests?.order_id?.slice(0, 8) || '—'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-bold text-gray-900">{formatNaira(d.amount)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[d.status]?.cls || 'bg-gray-100'}`}>
                        {STATUS[d.status]?.label || d.status}
                      </span>
                    </div>
                  </div>
                  {d.paystack_payment_link && (
                    <a
                      href={d.paystack_payment_link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary-600"
                    >
                      Payment link <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {d.notes && <p className="mt-1 text-xs text-gray-500">{d.notes}</p>}
                  {d.status === 'pending' && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActing({ debit: d, action: 'send-payment-link' });
                          setNotes('');
                          setPayRef('');
                        }}
                        className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1.5 text-[11px] font-semibold text-blue-700"
                      >
                        <Link2 className="h-3 w-3" /> Pay link
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActing({ debit: d, action: 'mark-paid' });
                          setNotes('');
                          setPayRef('');
                        }}
                        className="flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1.5 text-[11px] font-semibold text-green-700"
                      >
                        <Banknote className="h-3 w-3" /> Paid
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActing({ debit: d, action: 'waive' });
                          setNotes('');
                          setPayRef('');
                        }}
                        className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1.5 text-[11px] font-semibold text-gray-600"
                      >
                        <XCircle className="h-3 w-3" /> Waive
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!acting} onClose={() => setActing(null)} ariaLabel="Debit action">
        {acting && (
          <>
            <h3 className="text-base font-bold capitalize">
              {acting.action === 'send-payment-link' ? 'Send payment link' : acting.action.replace('-', ' ')}
            </h3>
            <p className="text-sm text-gray-600">
              {acting.debit.vendors?.store_name} · {formatNaira(acting.debit.amount)}
            </p>
            {acting.action === 'send-payment-link' && (
              <p className="rounded-lg bg-blue-50 p-2 text-xs text-blue-800">
                A Paystack link will be emailed to {acting.debit.vendors?.email}.
              </p>
            )}
            {acting.action === 'mark-paid' && (
              <input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="Payment reference (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
            )}
            {acting.action === 'waive' && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">This writes off the debit.</p>
            )}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            />
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submitAction()}
              className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Confirm'}
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}
