import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, RefreshCw } from 'lucide-react';
import { api, EarningsResponse } from '../lib/api';

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function formatDayLabel(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-NG', { weekday: 'short' });
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await api.getEarnings();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load earnings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen pb-10">
      <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100">
        <button type="button" onClick={() => navigate('/')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Home
        </button>
        <h1 className="text-lg font-bold text-gray-900">Earnings</h1>
        <p className="text-xs text-gray-500 mt-0.5">Last 7 days</p>
      </div>

      <div className="px-6 pt-6 space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : data ? (
          <>
            <div className="rounded-2xl border border-gray-200 p-5">
              <p className="text-xs text-gray-500">This week</p>
              <p className="text-3xl font-black text-gray-900 mt-1">{formatNaira(data.weekly_total)}</p>
              <p className="text-xs text-gray-400 mt-1">
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

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Deliveries</p>
              {data.breakdown.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
                  <Package className="w-6 h-6 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No deliveries this week yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {data.breakdown.map((d) => (
                    <div key={d.id} className="rounded-xl border border-gray-200 p-3.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{d.tracking_number || `Order ${d.order_number ?? ''}`}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(d.delivered_at).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-gray-900">{formatNaira(d.fee)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
