import { useCallback, useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

interface Withdrawal {
  id: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  rejection_reason: string | null;
  notes: string | null;
  payment_reference: string | null;
  payment_date: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-orange',
  approved: 'badge-orange',
  paid: 'badge-green',
  rejected: 'badge-red',
};

export default function Withdrawals() {
  const { influencer } = useAuth();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [available, setAvailable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, available_balance } = await api.getWithdrawals();
      setWithdrawals(data);
      setAvailable(available_balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load withdrawals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!influencer) return null;

  const hasBankDetails = !!influencer.account_number;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const value = Number(amount);
    if (!value || value <= 0) { setError('Enter a valid amount'); return; }
    if (value > available) { setError(`Amount exceeds your available balance of ₦${available.toLocaleString()}`); return; }

    setSubmitting(true);
    try {
      await api.requestWithdrawal({ amount: value, notes: notes.trim() || undefined });
      setShowForm(false);
      setAmount('');
      setNotes('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request withdrawal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Withdrawals</h1>
        <p className="text-gray-500 mt-1">Request a payout of your earned commission.</p>
      </div>

      <div className="card bg-gradient-to-br from-primary-50 to-secondary-50 border-primary-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm text-gray-600 mb-1">Available Balance</p>
            <p className="text-3xl font-bold text-primary-700">₦{available.toLocaleString()}</p>
          </div>
          <button
            className="btn-primary"
            disabled={available <= 0}
            onClick={() => setShowForm(true)}
          >
            Request Withdrawal
          </button>
        </div>
        {!hasBankDetails && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Add your payout bank details on the <Link to="/profile" className="underline font-medium">Profile</Link> page before requesting a withdrawal.
          </p>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount (₦)</label>
            <input
              type="number"
              className="input"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              min={1}
              max={available}
              placeholder={`Up to ₦${available.toLocaleString()}`}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Payout to</label>
            <div className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
              {influencer.bank_name || '—'} · {influencer.account_number} · {influencer.account_name}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <textarea
              className="input"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary flex-1" onClick={() => { setShowForm(false); setError(''); }} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary flex-1" disabled={submitting || !hasBankDetails}>
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : withdrawals.length === 0 ? (
        <div className="card text-center text-gray-400 py-12">No withdrawal requests yet.</div>
      ) : (
        <div className="space-y-2">
          {withdrawals.map(w => (
            <div key={w.id} className="card">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <p className="font-semibold text-gray-900">₦{w.amount.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{new Date(w.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`badge ${STATUS_BADGE[w.status]}`}>{w.status}</span>
              </div>
              {w.status === 'rejected' && w.rejection_reason && (
                <p className="text-xs text-red-600 mt-2">Reason: {w.rejection_reason}</p>
              )}
              {w.status === 'paid' && w.payment_reference && (
                <p className="text-xs text-gray-500 mt-2">Ref: {w.payment_reference}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
