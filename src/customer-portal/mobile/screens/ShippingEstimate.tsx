import { useState } from 'react';
import { Calculator, Package, TrendingUp } from 'lucide-react';
import { callSupabaseFunction } from '../../../lib/supabaseFunctions';

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

interface ShippingEstimate {
  zoneName: string;
  totalShippingFee: number;
  subOrders: Array<{
    hubName: string;
    courierName: string;
    totalWeight: number;
    totalShippingFee: number;
    deliveryTimelineDays: number;
  }>;
}

export default function MobileShippingEstimate() {
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [weight, setWeight] = useState('');
  const [orderValue, setOrderValue] = useState('');
  const [estimate, setEstimate] = useState<ShippingEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const calculateShipping = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setEstimate(null);

    try {
      const data = await callSupabaseFunction('shipping-estimate', {
        method: 'POST',
        body: {
          state,
          city,
          items: [
            {
              hubId: 'default',
              quantity: 1,
              weight: parseFloat(weight),
              price: parseFloat(orderValue) || 0,
            },
          ],
        },
      });

      if (data.success && data.data) {
        setEstimate(data.data);
      } else {
        setError(data.error || 'Failed to calculate shipping');
      }
    } catch {
      setError('Failed to calculate shipping estimate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Shipping estimate</h1>
        <p className="mt-1 text-sm text-gray-600">Get an instant delivery cost for your location.</p>
      </div>

      <form onSubmit={calculateShipping} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary-600" />
          <p className="text-sm font-semibold text-gray-900">Calculate shipping</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Delivery state</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500"
            style={{ fontSize: '16px' }}
            required
          >
            <option value="">Select state…</option>
            {NIGERIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">City</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Ikeja"
            className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500"
            style={{ fontSize: '16px' }}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Weight (kg)</label>
          <input
            type="number"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="e.g. 2.5"
            className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500"
            style={{ fontSize: '16px' }}
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">Order value (₦)</label>
          <input
            type="number"
            value={orderValue}
            onChange={(e) => setOrderValue(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500"
            style={{ fontSize: '16px' }}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Calculating…' : 'Calculate cost'}
        </button>
      </form>

      {estimate && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-gradient-to-br from-primary-50 to-blue-50 p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Total shipping</p>
            <p className="mt-1 text-3xl font-bold text-primary-600">
              ₦{estimate.totalShippingFee.toLocaleString('en-NG')}
            </p>
            <p className="mt-1 text-sm text-gray-600">Zone: {estimate.zoneName}</p>
          </div>

          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Breakdown</p>
          {estimate.subOrders.map((sub, index) => (
            <div key={index} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{sub.hubName}</p>
                  <p className="text-xs text-gray-500">{sub.courierName}</p>
                </div>
                <p className="text-sm font-bold text-primary-600">₦{sub.totalShippingFee.toLocaleString('en-NG')}</p>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Package className="h-3.5 w-3.5" />
                  {sub.totalWeight} kg
                </span>
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {sub.deliveryTimelineDays} days
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
