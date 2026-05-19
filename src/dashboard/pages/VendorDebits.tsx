import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw, Link2, Banknote, XCircle, Search, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VendorDebit {
  id: string;
  vendor_id: string;
  amount: number;
  status: 'pending' | 'deducted' | 'paid_back' | 'waived';
  recovery_method: string | null;
  notes: string | null;
  paystack_payment_link: string | null;
  paystack_reference: string | null;
  created_at: string;
  updated_at: string;
  vendors?: { id: string; store_name: string; email: string } | null;
  return_requests?: {
    id: string;
    order_id: string;
    status: string;
    orders?: { order_number: string | number } | null;
  } | null;
}

type ActionType = 'send-payment-link' | 'mark-paid' | 'waive';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-yellow-100 text-yellow-700' },
  deducted:  { label: 'Deducted',  cls: 'bg-blue-100 text-blue-700' },
  paid_back: { label: 'Paid Back', cls: 'bg-green-100 text-green-700' },
  waived:    { label: 'Waived',    cls: 'bg-gray-100 text-gray-600' },
};

const RECOVERY_CONFIG: Record<string, string> = {
  deduction:     'Auto deduction',
  paystack:      'Paystack',
  bank_transfer: 'Bank transfer',
  waived:        'Waived',
};

const API = import.meta.env.VITE_API_URL || '';

async function callApi(path: string, method: string, body?: object) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token || '';
  const qs = method === 'GET' && body ? '?' + new URLSearchParams(body as Record<string, string>).toString() : '';
  const res = await fetch(`${API}/.netlify/functions/${path}${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(method !== 'GET' && body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VendorDebits() {
  const [debits, setDebits]       = useState<VendorDebit[]>([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatus] = useState('pending');
  const [search, setSearch]       = useState('');
  const [expanded, setExpanded]   = useState<string | null>(null);

  // action modal
  const [acting, setActing]       = useState<{ debit: VendorDebit; action: ActionType } | null>(null);
  const [notes, setNotes]         = useState('');
  const [payRef, setPayRef]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    const res = await callApi('admin-vendor-debits', 'GET', params);
    if (res.success) setDebits(res.data || []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const openAction = (debit: VendorDebit, action: ActionType) => {
    setActing({ debit, action });
    setNotes('');
    setPayRef('');
  };

  const submitAction = async () => {
    if (!acting) return;
    setSubmitting(true);
    const body: Record<string, string> = { action: acting.action, debit_id: acting.debit.id };
    if (notes) body.notes = notes;
    if (acting.action === 'mark-paid' && payRef) body.payment_reference = payRef;
    const res = await callApi('admin-vendor-debits', 'POST', body);
    setSubmitting(false);
    if (res.success) {
      showToast(
        acting.action === 'send-payment-link' ? 'Payment link sent to vendor.' :
        acting.action === 'mark-paid'         ? 'Debit marked as paid.' :
                                                'Debit waived.'
      );
      setActing(null);
      load();
    } else {
      showToast(`Error: ${res.error}`);
    }
  };

  const filtered = debits.filter(d => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.vendors?.store_name?.toLowerCase().includes(q) ||
      d.vendors?.email?.toLowerCase().includes(q) ||
      String(d.return_requests?.orders?.order_number || '').toLowerCase().includes(q)
    );
  });

  const totalPending = debits
    .filter(d => d.status === 'pending')
    .reduce((s, d) => s + Number(d.amount), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendor Return Debits</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Earnings owed back by vendors after customer returns
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Summary strip */}
      {totalPending > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span><strong>{fmt(totalPending)}</strong> outstanding across {debits.filter(d => d.status === 'pending').length} pending debit(s).</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search vendor or order…"
            className="pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg w-60 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="deducted">Deducted</option>
          <option value="paid_back">Paid Back</option>
          <option value="waived">Waived</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500 text-sm">No debits found.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Vendor</th>
                <th className="px-4 py-3 text-left">Order</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Recovery</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(debit => {
                const isExpanded = expanded === debit.id;
                const cfg = STATUS_CONFIG[debit.status] ?? { label: debit.status, cls: 'bg-gray-100 text-gray-600' };
                return (
                  <>
                    <tr key={debit.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : debit.id)}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{debit.vendors?.store_name || '—'}</p>
                        <p className="text-xs text-gray-500">{debit.vendors?.email || ''}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        #{debit.return_requests?.orders?.order_number || debit.return_requests?.order_id?.slice(0, 8) || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(debit.amount)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {debit.recovery_method ? RECOVERY_CONFIG[debit.recovery_method] || debit.recovery_method : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(debit.created_at).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        {debit.status === 'pending' && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openAction(debit, 'send-payment-link')}
                              title="Send Paystack payment link to vendor"
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                            >
                              <Link2 className="w-3 h-3" /> Pay Link
                            </button>
                            <button
                              onClick={() => openAction(debit, 'mark-paid')}
                              title="Mark as paid via bank transfer"
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100"
                            >
                              <Banknote className="w-3 h-3" /> Mark Paid
                            </button>
                            <button
                              onClick={() => openAction(debit, 'waive')}
                              title="Write off this debit"
                              className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                            >
                              <XCircle className="w-3 h-3" /> Waive
                            </button>
                          </div>
                        )}
                        {debit.status !== 'pending' && (
                          <button onClick={() => setExpanded(isExpanded ? null : debit.id)} className="text-gray-400 hover:text-gray-600">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {isExpanded && (
                      <tr key={`${debit.id}-detail`} className="bg-gray-50">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-500 uppercase mb-1">Return Request ID</p>
                              <p className="text-gray-700 font-mono text-xs">{debit.return_request_id || debit.return_requests?.id || '—'}</p>
                            </div>
                            {debit.paystack_reference && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase mb-1">Reference</p>
                                <p className="text-gray-700 font-mono text-xs">{debit.paystack_reference}</p>
                              </div>
                            )}
                            {debit.paystack_payment_link && (
                              <div>
                                <p className="text-xs text-gray-500 uppercase mb-1">Payment Link</p>
                                <a href={debit.paystack_payment_link} target="_blank" rel="noreferrer"
                                   className="flex items-center gap-1 text-blue-600 hover:underline text-xs">
                                  Open link <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            )}
                            {debit.notes && (
                              <div className="col-span-2">
                                <p className="text-xs text-gray-500 uppercase mb-1">Notes</p>
                                <p className="text-gray-700">{debit.notes}</p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action Modal */}
      {acting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {acting.action === 'send-payment-link' && 'Send Payment Link'}
              {acting.action === 'mark-paid'         && 'Mark as Paid (Bank Transfer)'}
              {acting.action === 'waive'             && 'Waive Debit'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              Vendor: <strong>{acting.debit.vendors?.store_name}</strong> — {fmt(acting.debit.amount)}
            </p>

            {acting.action === 'send-payment-link' && (
              <p className="text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mb-4">
                A Paystack payment link will be generated and emailed to <strong>{acting.debit.vendors?.email}</strong>.
              </p>
            )}

            {acting.action === 'mark-paid' && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">Payment Reference (optional)</label>
                <input
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                  placeholder="Bank teller or transfer ref"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            )}

            {acting.action === 'waive' && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-4">
                This will write off the debit — the vendor will not be required to repay.
              </p>
            )}

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setActing(null)}
                disabled={submitting}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitAction}
                disabled={submitting}
                className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50 ${
                  acting.action === 'waive'              ? 'bg-gray-500 hover:bg-gray-600' :
                  acting.action === 'send-payment-link'  ? 'bg-blue-600 hover:bg-blue-700' :
                                                           'bg-green-600 hover:bg-green-700'
                }`}
              >
                {submitting ? 'Processing…' :
                  acting.action === 'send-payment-link' ? 'Send Link' :
                  acting.action === 'mark-paid'         ? 'Confirm Paid' :
                                                          'Waive Debit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white px-4 py-3 rounded-xl text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
