import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Loader, Search, Wallet } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

interface Withdrawal {
  id: string;
  amount: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  payment_reference: string | null;
  rejection_reason: string | null;
  created_at: string;
  rider?: { full_name: string; email: string };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Approved', cls: 'bg-blue-100 text-blue-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  paid: { label: 'Paid', cls: 'bg-green-100 text-green-700' },
};

export default function MobileRiderWithdrawals() {
  const { session } = useAuth();
  const notification = useNotification();
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ id: string; action: 'approve' | 'reject' | 'paid' } | null>(null);
  const [payRef, setPayRef] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch(`${functionsBase}/rider-withdrawals-admin`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload?.error || 'Failed to load');
      setRows(payload.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load withdrawals');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((w) => {
      if (statusFilter && w.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        w.rider?.full_name?.toLowerCase().includes(q) ||
        w.rider?.email?.toLowerCase().includes(q) ||
        (w.bank_account_number || '').includes(q) ||
        (w.bank_account_name || '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(
    () => ({
      pending: rows.filter((w) => w.status === 'pending').reduce((s, w) => s + w.amount, 0),
      approved: rows.filter((w) => w.status === 'approved').reduce((s, w) => s + w.amount, 0),
      paid: rows.filter((w) => w.status === 'paid').reduce((s, w) => s + w.amount, 0),
    }),
    [rows],
  );

  const submitAction = async () => {
    if (!acting || !session?.access_token) return;
    setSubmitting(true);
    const body: Record<string, string> = { action: acting.action };
    if (acting.action === 'paid') body.payment_reference = payRef;
    if (acting.action === 'reject') body.rejection_reason = rejectReason;
    try {
      const res = await fetch(`${functionsBase}/rider-withdrawals/${acting.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok || !payload.success) throw new Error(payload?.error || 'Unable to update withdrawal');
      notification.success('Updated', `Withdrawal ${acting.action === 'paid' ? 'marked paid' : acting.action + 'd'}`);
      setActing(null);
      setPayRef('');
      setRejectReason('');
      await load();
    } catch (err) {
      notification.error('Action failed', err instanceof Error ? err.message : 'Unable to update withdrawal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Rider Payouts</h1>
            <p className="text-xs text-gray-500">Withdrawal requests from riders</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-2.5">
              <p className="text-[10px] text-gray-500">Pending</p>
              <p className="text-sm font-bold">{formatNaira(totals.pending)}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-2.5">
              <p className="text-[10px] text-gray-500">Approved</p>
              <p className="text-sm font-bold">{formatNaira(totals.approved)}</p>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 p-2.5">
              <p className="text-[10px] text-gray-500">Paid</p>
              <p className="text-sm font-bold">{formatNaira(totals.paid)}</p>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-gray-100">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rider or account…"
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
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 ring-1 ring-gray-100">
              <Wallet className="mx-auto mb-2 h-8 w-8 text-gray-300" />
              No withdrawal requests found
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((w) => (
                <div key={w.id} className="rounded-xl bg-white ring-1 ring-gray-100">
                  <div className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{w.rider?.full_name || '—'}</p>
                      <p className="truncate text-xs text-gray-400">{w.rider?.email}</p>
                      <p className="mt-1 font-mono text-xs text-gray-600">{w.bank_account_number || '—'}</p>
                      <p className="text-xs text-gray-400">
                        {[w.bank_name, w.bank_account_name].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-bold">{formatNaira(w.amount)}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS[w.status]?.cls || 'bg-gray-100'}`}>
                        {STATUS[w.status]?.label || w.status}
                      </span>
                    </div>
                  </div>
                  {(w.payment_reference || w.rejection_reason || w.notes) && (
                    <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                      {w.payment_reference && <p>Ref: {w.payment_reference}</p>}
                      {w.rejection_reason && <p className="text-red-500">{w.rejection_reason}</p>}
                      {w.notes && <p className="italic">{w.notes}</p>}
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
                    <p className="text-xs text-gray-400">{new Date(w.created_at).toLocaleDateString()}</p>
                    <div className="flex gap-1.5">
                      {w.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => setActing({ id: w.id, action: 'approve' })}
                            className="rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setActing({ id: w.id, action: 'reject' })}
                            className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-600"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {w.status === 'approved' && (
                        <button
                          type="button"
                          onClick={() => setActing({ id: w.id, action: 'paid' })}
                          className="flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-700"
                        >
                          <Banknote className="h-3 w-3" /> Paid
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!acting} onClose={() => setActing(null)} ariaLabel="Withdrawal action">
        {acting && (
          <>
            <h3 className="text-base font-bold capitalize">{acting.action} withdrawal</h3>
            {acting.action === 'paid' && (
              <input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="Payment reference (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
            )}
            {acting.action === 'reject' && (
              <input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
            )}
            {acting.action === 'approve' && (
              <p className="text-sm text-gray-600">Approve this withdrawal for payout processing?</p>
            )}
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
