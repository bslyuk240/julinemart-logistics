import { useEffect, useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { CUSTOM_ORDER_STATUS_LABELS } from '../../../src/types/custom-order';

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

export default function CustomOrders() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .getCustomOrders()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const advance = async (specId: string, status: string) => {
    setBusyId(specId);
    try {
      await api.updateCustomOrder(specId, { status });
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const nextStatus: Record<string, string> = {
    submitted: 'seller_reviewing',
    seller_reviewing: 'seller_confirmed',
    seller_confirmed: 'in_production',
    in_production: 'ready',
    ready: 'dispatched',
    dispatched: 'delivered',
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-primary-600" />
        Custom orders
      </h1>

      {error && <div className="card text-red-600 text-sm">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !rows.length ? (
        <div className="card text-center py-12 text-gray-500">
          <p>No custom orders yet.</p>
          <p className="text-sm mt-1">Enable customisation on a product to receive made-to-order requests.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const order = row.orders;
            const item = row.order_items;
            const next = nextStatus[row.status];
            return (
              <div key={row.id} className="card space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">{item?.product_name || 'Custom item'}</p>
                    <p className="text-xs text-gray-500">
                      Order #{order?.order_number} · {order?.customer_name}
                    </p>
                  </div>
                  <span className="badge bg-primary-50 text-primary-700 text-xs">
                    {(CUSTOM_ORDER_STATUS_LABELS as Record<string, string>)[row.status] || row.status}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  Qty {item?.quantity} · {fmt(Number(item?.unit_price || 0))} each
                  {row.price_adjustment > 0 && ` (+${fmt(row.price_adjustment)} custom)`}
                </p>
                {Object.entries(row.field_values || {}).length > 0 && (
                  <ul className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 space-y-0.5">
                    {Object.entries(row.field_values).map(([k, v]) => (
                      <li key={k}>
                        <span className="font-medium">{k}:</span> {String(v)}
                      </li>
                    ))}
                  </ul>
                )}
                {next && (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    className="btn-primary btn-sm w-full flex items-center justify-center gap-1"
                    onClick={() => advance(row.id, next)}
                  >
                    Mark {((CUSTOM_ORDER_STATUS_LABELS as Record<string, string>)[next] || next).toLowerCase()}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
