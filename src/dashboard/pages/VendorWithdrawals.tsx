import { useState, useEffect, useCallback } from 'react';
import { Wallet, CheckCircle, XCircle, Banknote, RefreshCw, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Withdrawal {
  id: string;
  vendor_id: string;
  amount: number;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  payment_reference: string | null;
  payment_date: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  vendor?: { store_name: string; email: string };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Pending',  cls: 'bg-yellow-100 text-yellow-700' },
  approved: { label: 'Approved', cls: 'bg-blue-100 text-blue-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  paid:     { label: 'Paid',     cls: 'bg-green-100 text-green-700' },
};

const API = import.meta.env.VITE_API_URL || '';

async function callApi(path: string, method: string, body?: object) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || '';
  const res = await fetch(`${API}/.netlify/functions/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(method !== 'GET' && body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function VendorWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatus]     = useState('');
  const [search, setSearch]           = useState('');
  const [expanded, setExpanded]       = useState<string | null>(null);

  const [acting, setActing]           = useState<{ id: string; action: 'approve' | 'reject' | 'paid' } | null>(null);
  const [payRef, setPayRef]           = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [toast, setToast]             = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await callApi('vendor-withdrawals-admin', 'GET', {});
    if (res.success) setWithdrawals(res.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const submitAction = async () => {
    if (!acting) return;
    setSubmitting(true);
    const body: Record<string, string> = { action: acting.action };
    if (acting.action === 'paid')   { body.payment_reference = payRef; }
    if (acting.action === 'reject') { body.rejection_reason  = rejectReason; }

    const res = await callApi(`vendor-withdrawals/${acting.id}`, 'PUT', body);
    setSubmitting(false);
    if (res.success) {
      showToast(`Withdrawal ${acting.action === 'paid' ? 'marked as paid' : acting.action + 'd'} successfully`);
      setActing(null); setPayRef(''); setRejectReason('');
      load();
    } else {
      showToast(`Error: ${res.error}`);
    }
  };

  const filtered = withdrawals.filter(w => {
    if (statusFilter && w.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        w.vendor?.store_name?.toLowerCase().includes(q) ||
        w.vendor?.email?.toLowerCase().includes(q) ||
        w.bank_account_number?.includes(q) ||
        w.bank_account_name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totals = {
    pending:  withdrawals.filter(w => w.status === 'pending').reduce((s, w) => s + w.amount, 0),
    approved: withdrawals.filter(w => w.status === 'approved').reduce((s, w) => s + w.amount, 0),
    paid:     withdrawals.filter(w => w.status === 'paid').reduce((s, w) => s + w.amount, 0),
  };

  return (
    <div className="w-full max-w-none p-4 sm:p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Wallet className="w-6 h-6 text-purple-600 shrink-0" />
        <h1 className="text-2xl font-bold text-gray-900">Vendor Withdrawals</h1>
        <button onClick={load} className="ml-auto p-2 text-gray-400 hover:text-purple-600 hover:bg-gray-100 rounded-lg transition">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Summary cards — 1 col mobile, 3 col desktop */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Pending Requests', value: fmt(totals.pending),  count: withdrawals.filter(w => w.status === 'pending').length,  cls: 'border-yellow-200 bg-yellow-50' },
          { label: 'Approved (Queued)', value: fmt(totals.approved), count: withdrawals.filter(w => w.status === 'approved').length, cls: 'border-blue-200 bg-blue-50' },
          { label: 'Total Paid Out',   value: fmt(totals.paid),      count: withdrawals.filter(w => w.status === 'paid').length,    cls: 'border-green-200 bg-green-50' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.cls}`}>
            <p className="text-xs text-gray-500 font-medium">{c.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{c.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{c.count} request{c.count !== 1 ? 's' : ''}</p>
          </div>
        ))}
      </div>

      {/* Filters — stack on mobile */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none"
            placeholder="Search vendor name, email, account…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none"
          value={statusFilter}
          onChange={e => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No withdrawal requests found</p>
        </div>
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Bank Details</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(w => (
                  <>
                    <tr key={w.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{w.vendor?.store_name || '—'}</p>
                        <p className="text-xs text-gray-400">{w.vendor?.email || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(w.amount)}</td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-gray-700">{w.bank_account_number || '—'}</p>
                        <p className="text-xs text-gray-400">{w.bank_name} · {w.bank_account_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CONFIG[w.status]?.cls || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_CONFIG[w.status]?.label || w.status}
                        </span>
                        {w.payment_reference && (
                          <p className="text-xs text-gray-400 mt-0.5">Ref: {w.payment_reference}</p>
                        )}
                        {w.rejection_reason && (
                          <p className="text-xs text-red-400 mt-0.5 max-w-[160px] truncate">{w.rejection_reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {w.notes && (
                            <button
                              onClick={() => setExpanded(expanded === w.id ? null : w.id)}
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                              title="View notes"
                            >
                              {expanded === w.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {w.status === 'pending' && (
                            <>
                              <button onClick={() => setActing({ id: w.id, action: 'approve' })}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg font-medium transition">
                                <CheckCircle className="w-3 h-3" /> Approve
                              </button>
                              <button onClick={() => setActing({ id: w.id, action: 'reject' })}
                                className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg font-medium transition">
                                <XCircle className="w-3 h-3" /> Reject
                              </button>
                            </>
                          )}
                          {w.status === 'approved' && (
                            <button onClick={() => setActing({ id: w.id, action: 'paid' })}
                              className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg font-medium transition">
                              <Banknote className="w-3 h-3" /> Mark Paid
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === w.id && (
                      <tr key={`${w.id}-notes`} className="bg-yellow-50">
                        <td colSpan={6} className="px-4 py-2 text-xs text-gray-600 italic">
                          Vendor note: {w.notes}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <div className="sm:hidden space-y-3">
            {filtered.map(w => (
              <div key={w.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Top row: vendor + amount */}
                <div className="flex items-start justify-between px-4 pt-4 pb-2 gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 leading-snug">{w.vendor?.store_name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{w.vendor?.email || ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-gray-900">{fmt(w.amount)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_CONFIG[w.status]?.cls || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_CONFIG[w.status]?.label || w.status}
                    </span>
                  </div>
                </div>

                {/* Bank details */}
                <div className="px-4 pb-3 border-b border-gray-100">
                  <p className="font-mono text-xs text-gray-700">{w.bank_account_number || '—'}</p>
                  <p className="text-xs text-gray-400">{[w.bank_name, w.bank_account_name].filter(Boolean).join(' · ') || '—'}</p>
                  {w.payment_reference && <p className="text-xs text-gray-400 mt-0.5">Ref: {w.payment_reference}</p>}
                  {w.rejection_reason && <p className="text-xs text-red-400 mt-0.5">{w.rejection_reason}</p>}
                  {w.notes && (
                    <button
                      onClick={() => setExpanded(expanded === w.id ? null : w.id)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mt-1"
                    >
                      {expanded === w.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {expanded === w.id ? 'Hide note' : 'View note'}
                    </button>
                  )}
                  {expanded === w.id && (
                    <p className="text-xs text-gray-600 italic mt-1 bg-yellow-50 rounded px-2 py-1">{w.notes}</p>
                  )}
                </div>

                {/* Footer: date + actions */}
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                  <p className="text-xs text-gray-400">
                    {new Date(w.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="flex items-center gap-2">
                    {w.status === 'pending' && (
                      <>
                        <button onClick={() => setActing({ id: w.id, action: 'approve' })}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg font-medium transition">
                          <CheckCircle className="w-3 h-3" /> Approve
                        </button>
                        <button onClick={() => setActing({ id: w.id, action: 'reject' })}
                          className="flex items-center gap-1 text-xs px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg font-medium transition">
                          <XCircle className="w-3 h-3" /> Reject
                        </button>
                      </>
                    )}
                    {w.status === 'approved' && (
                      <button onClick={() => setActing({ id: w.id, action: 'paid' })}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg font-medium transition">
                        <Banknote className="w-3 h-3" /> Mark Paid
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Action modal */}
      {acting && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">
              {acting.action === 'approve' && 'Approve Withdrawal'}
              {acting.action === 'reject'  && 'Reject Withdrawal'}
              {acting.action === 'paid'    && 'Mark as Paid'}
            </h2>

            {acting.action === 'paid' && (
              <div>
                <label className="text-xs text-gray-500 font-medium">Payment Reference (optional)</label>
                <input
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none"
                  placeholder="e.g. transfer ID, Paystack ref…"
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                />
              </div>
            )}

            {acting.action === 'reject' && (
              <div>
                <label className="text-xs text-gray-500 font-medium">Reason for rejection *</label>
                <textarea
                  className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none resize-none"
                  rows={3}
                  placeholder="Explain why this request is being rejected…"
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                />
              </div>
            )}

            {acting.action === 'approve' && (
              <p className="text-sm text-gray-600">
                This will move the request to <strong>Approved</strong> status. You can mark it as paid after the transfer is complete.
              </p>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => { setActing(null); setPayRef(''); setRejectReason(''); }}
                className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={submitAction}
                disabled={submitting || (acting.action === 'reject' && !rejectReason.trim())}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50 ${
                  acting.action === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
