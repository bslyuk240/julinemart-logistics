import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Package, RefreshCw } from 'lucide-react';
import { api, EarningsResponse, Withdrawal } from '../lib/api';
import { BottomNav } from '../components/BottomNav';

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function formatDayLabel(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-NG', { weekday: 'short' });
}

const WITHDRAWAL_STATUS_LABEL: Record<Withdrawal['status'], string> = {
  pending: 'Pending review',
  approved: 'Approved — payment coming',
  paid: 'Paid',
  rejected: 'Rejected',
};

const WITHDRAWAL_STATUS_CLASS: Record<Withdrawal['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
};

function Sparkline({ points }: { points: { date: string; amount: number }[] }) {
  const width = 320;
  const height = 72;
  const padding = 6;
  const max = Math.max(...points.map((p) => p.amount), 1);
  const step = (width - padding * 2) / Math.max(points.length - 1, 1);

  const coords = points.map((p, i) => {
    const x = padding + i * step;
    const y = height - padding - (p.amount / max) * (height - padding * 2);
    return { x, y, amount: p.amount };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
  const areaPath = `${linePath} L${coords[coords.length - 1].x},${height - padding} L${coords[0].x},${height - padding} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[72px]">
      <path d={areaPath} fill="url(#earningsGradient)" opacity={0.15} />
      <path d={linePath} fill="none" stroke="#6d28d9" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={c.amount > 0 ? 3 : 0} fill="#6d28d9" />
      ))}
      <defs>
        <linearGradient id="earningsGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6d28d9" />
          <stop offset="100%" stopColor="#6d28d9" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function Earnings() {
  const navigate = useNavigate();
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);

  const load = async () => {
    try {
      const [earnings, history] = await Promise.all([api.getEarnings(), api.getWithdrawals()]);
      setData(earnings);
      setWithdrawals(history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load earnings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startWithdrawal = () => {
    setWithdrawAmount(data ? String(data.available_balance) : '');
    setWithdrawError(null);
    setWithdrawing(true);
  };

  const submitWithdrawal = async () => {
    setWithdrawError(null);
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) return setWithdrawError('Enter an amount');
    if (data && amount > data.available_balance) return setWithdrawError(`Max available: ${formatNaira(data.available_balance)}`);

    setSubmittingWithdrawal(true);
    try {
      await api.requestWithdrawal(amount);
      setWithdrawing(false);
      await load();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'Could not submit withdrawal');
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  return (
    <div className="min-h-screen pb-24 bg-gray-50">
      <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100">
        <button type="button" onClick={() => navigate('/')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Home
        </button>
        <h1 className="text-lg font-bold text-gray-900">Earnings &amp; Wallet</h1>
      </div>

      <div className="px-6 pt-6 space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : data ? (
          <>
            {/* Wallet hero — available balance + withdraw, always the first thing shown */}
            <div className="rounded-2xl bg-primary-600 p-5 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-primary-100 uppercase tracking-wide">Available Balance</p>
                  <p className="text-3xl font-black mt-1">{formatNaira(data.available_balance)}</p>
                  <p className="text-xs text-primary-100 mt-1">Available to withdraw</p>
                </div>
                {!withdrawing && (
                  <button
                    type="button"
                    onClick={startWithdrawal}
                    disabled={data.available_balance <= 0}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-primary-700 disabled:opacity-40"
                  >
                    <Banknote className="w-4 h-4" />
                    Withdraw
                  </button>
                )}
              </div>
            </div>

            {withdrawing && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
                <div>
                  <label className="field-label">Amount</label>
                  <input
                    className="field-input"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </div>
                {withdrawError && <p className="text-xs text-red-600">{withdrawError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setWithdrawing(false)}
                    disabled={submittingWithdrawal}
                    className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitWithdrawal}
                    disabled={submittingWithdrawal}
                    className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submittingWithdrawal ? 'Submitting…' : 'Request withdrawal'}
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Earnings (Last 7 Days)</p>
              <p className="text-2xl font-black text-gray-900 mt-1">{formatNaira(data.weekly_total)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {data.delivery_count} {data.delivery_count === 1 ? 'delivery' : 'deliveries'}
              </p>

              <div className="mt-4">
                <Sparkline points={data.sparkline} />
                <div className="flex justify-between mt-1">
                  {data.sparkline.map((p) => (
                    <span key={p.date} className="text-[10px] text-gray-400 w-8 text-center">
                      {formatDayLabel(p.date)}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">Today</p>
                <p className="text-2xl font-black text-gray-900 mt-1">{formatNaira(data.today_total)}</p>
              </div>
              <p className="text-xs text-gray-400">
                {data.today_count} {data.today_count === 1 ? 'delivery' : 'deliveries'}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Recent Deliveries</p>
              {data.breakdown.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
                  <Package className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No deliveries this week yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.breakdown.map((d) => (
                    <div key={d.id} className="rounded-xl border border-gray-200 bg-white p-3.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{d.tracking_number || `Order ${d.order_number ?? ''}`}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(d.delivered_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-emerald-600">+{formatNaira(d.fee)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {withdrawals.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Wallet Transactions</p>
                <div className="space-y-2">
                  {withdrawals.map((w) => (
                    <div key={w.id} className="rounded-xl border border-gray-200 bg-white p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900">
                          {w.status === 'paid' ? '−' : ''}
                          {formatNaira(w.amount)}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {w.status === 'paid' ? 'Withdrawal completed' : 'Withdrawal requested'} ·{' '}
                          {new Date(w.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${WITHDRAWAL_STATUS_CLASS[w.status]}`}>
                        {WITHDRAWAL_STATUS_LABEL[w.status]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      <BottomNav />
    </div>
  );
}
