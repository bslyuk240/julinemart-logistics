import { useEffect, useState, FormEvent } from 'react';
import { Wallet, AlertCircle, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

const STATUS_BADGE: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  paid:     'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function Withdrawals() {
  const { vendor } = useAuth();
  const [withdrawals, setWithdrawals]   = useState<any[]>([]);
  const [balance, setBalance]           = useState(0);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [showForm, setShowForm]         = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [formError, setFormError]       = useState('');
  const [amount, setAmount]             = useState('');
  const [bankName, setBankName]         = useState(vendor?.bank_name || '');
  const [accountNo, setAccountNo]       = useState(vendor?.bank_account_number || '');
  const [accountName, setAccountName]   = useState(vendor?.bank_account_name || '');
  const [notes, setNotes]               = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [wds, stats] = await Promise.all([api.getWithdrawals(), api.getStats()]);
      setWithdrawals(Array.isArray(wds) ? wds : []);
      setBalance(stats?.earnings?.available_balance || 0);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    setBankName(vendor?.bank_name || '');
    setAccountNo(vendor?.bank_account_number || '');
    setAccountName(vendor?.bank_account_name || '');
  }, [vendor]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    const amt = Number(amount);
    if (!amt || amt <= 0) return setFormError('Enter a valid amount');
    if (amt > balance) return setFormError(`Amount exceeds available balance (${fmt(balance)})`);
    if (!bankName || !accountNo || !accountName) return setFormError('Bank details are required');
    setSubmitting(true);
    try {
      await api.requestWithdrawal({ amount: amt, bank_name: bankName, bank_account_number: accountNo, bank_account_name: accountName, notes });
      setShowForm(false);
      setAmount(''); setNotes('');
      await loadData();
    } catch (e: any) { setFormError(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Withdrawals</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Request Withdrawal
        </button>
      </div>

      {/* Balance card */}
      <div className="card bg-gradient-to-br from-green-500 to-emerald-600 text-white">
        <p className="text-green-100 text-sm">Available Balance</p>
        <p className="text-4xl font-bold mt-1">{fmt(balance)}</p>
        <p className="text-green-200 text-xs mt-2">After platform commission deduction · Voucher discounts not deducted (absorbed by JulineMart)</p>
      </div>

      {error && <div className="card flex items-center gap-3 text-red-600"><AlertCircle className="w-5 h-5" />{error}</div>}

      {/* Request form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-bold text-gray-900">Request Withdrawal</h2>
              <button onClick={() => { setShowForm(false); setFormError(''); }} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₦)</label>
                <input className="input" type="number" min="1" max={balance} value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Max: ${fmt(balance)}`} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                <input className="input" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. First Bank" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                <input className="input" value={accountNo} onChange={e => setAccountNo(e.target.value)} placeholder="0123456789" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                <input className="input" value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Full name as on account" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowForm(false); setFormError(''); }} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1">
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Withdrawal history */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : withdrawals.length ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-gray-500">
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Bank</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium hidden sm:table-cell">Date</th>
                <th className="px-4 py-3 font-medium hidden md:table-cell">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {withdrawals.map(w => (
                <tr key={w.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-bold">{fmt(w.amount)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    <p>{w.bank_name}</p>
                    <p className="text-xs text-gray-400">{w.bank_account_number} · {w.bank_account_name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_BADGE[w.status] || 'bg-gray-100 text-gray-600'}`}>{w.status}</span>
                    {w.rejection_reason && <p className="text-xs text-red-500 mt-1">{w.rejection_reason}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-400 hidden sm:table-cell text-xs">{new Date(w.created_at).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-400 hidden md:table-cell">{w.payment_reference || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card text-center py-12 text-gray-400">
          <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No withdrawal requests yet</p>
        </div>
      )}
    </div>
  );
}
