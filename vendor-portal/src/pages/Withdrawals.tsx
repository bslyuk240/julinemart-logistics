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
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [balance, setBalance]         = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [showForm, setShowForm]       = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [formError, setFormError]     = useState('');
  const [amount, setAmount]           = useState('');
  const [bankName, setBankName]       = useState(vendor?.bank_name || '');
  const [accountNo, setAccountNo]     = useState(vendor?.bank_account_number || '');
  const [accountName, setAccountName] = useState(vendor?.bank_account_name || '');
  const [notes, setNotes]             = useState('');

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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Withdrawals</h1>
      </div>

      {/* Balance card */}
      <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-5 text-white">
        <p className="text-green-100 text-xs font-medium mb-1">Available Balance</p>
        <p className="text-3xl font-bold">{fmt(balance)}</p>
        <p className="text-green-200 text-xs mt-2 leading-relaxed">After platform commission · Voucher discounts absorbed by JulineMart</p>
        <button
          onClick={() => setShowForm(true)}
          className="mt-4 w-full bg-white text-green-700 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-green-50 transition-colors active:scale-[0.99]"
        >
          <Plus className="w-4 h-4" />
          Request Withdrawal
        </button>
      </div>

      {error && (
        <div className="card flex items-center gap-3 text-red-600">
          <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Request form — full-screen on mobile, modal on desktop */}
      {showForm && (
        <div className="fixed inset-0 z-50 lg:flex lg:items-center lg:justify-center lg:p-4 lg:bg-black/40">
          <div className="bg-white lg:rounded-2xl lg:shadow-2xl w-full h-full lg:h-auto lg:max-w-md flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="font-bold text-gray-900">Request Withdrawal</h2>
              <button
                onClick={() => { setShowForm(false); setFormError(''); }}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-xs text-green-600">Available</p>
                <p className="text-2xl font-bold text-green-700">{fmt(balance)}</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Amount (₦)</label>
                <input className="input" type="number" min="1" max={balance} value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Max: ${fmt(balance)}`} required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Bank Name</label>
                <input className="input" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. First Bank" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Account Number</label>
                <input className="input" inputMode="numeric" value={accountNo} onChange={e => setAccountNo(e.target.value)} placeholder="0123456789" maxLength={10} required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Account Name</label>
                <input className="input" value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="Full name as on account" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notes (optional)</label>
                <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              {formError && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{formError}</p>}
              <div className="flex gap-3 pt-2 pb-safe">
                <button type="button" onClick={() => { setShowForm(false); setFormError(''); }} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1">
                  {submitting ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Withdrawal history — card list */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : withdrawals.length ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">History</h2>
          {withdrawals.map(w => (
            <div key={w.id} className="card p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`badge ${STATUS_BADGE[w.status] || 'bg-gray-100 text-gray-600'}`}>{w.status}</span>
                  <span className="text-xs text-gray-400">{new Date(w.created_at).toLocaleDateString('en-GB')}</span>
                </div>
                <p className="text-sm text-gray-700">{w.bank_name}</p>
                <p className="text-xs text-gray-400">{w.bank_account_number} · {w.bank_account_name}</p>
                {w.rejection_reason && <p className="text-xs text-red-500 mt-1">{w.rejection_reason}</p>}
                {w.payment_reference && <p className="text-xs text-gray-400 font-mono mt-1">Ref: {w.payment_reference}</p>}
              </div>
              <p className="text-lg font-bold text-gray-900 flex-shrink-0">{fmt(w.amount)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="card text-center py-16 text-gray-400">
          <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No withdrawals yet</p>
          <p className="text-sm mt-1">Your requests will appear here</p>
        </div>
      )}
    </div>
  );
}
