import { useState } from 'react';
import { Calculator, MapPin, Package, TrendingUp, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../shared/BrandLogo';

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
];

interface ShippingEstimate {
  zoneName: string;
  totalShippingFee: number;
  subOrders: Array<{
    hubName: string;
    courierName: string;
    totalWeight: number;
    baseRate: number;
    vat: number;
    totalShippingFee: number;
    deliveryTimelineDays: number;
  }>;
}

export function ShippingEstimatePage() {
  const navigate = useNavigate();
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

    try {
      const response = await fetch('/api/shipping-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state,
          city,
          items: [{
            hubId: 'default', // Will use default hub for estimate
            quantity: 1,
            weight: parseFloat(weight),
            price: parseFloat(orderValue),
          }],
        }),
      });

      const data = await response.json();
      console.log('Shipping estimate response', data);

      if (data.success && data.data) {
        setEstimate(data.data);
      } else {
        setError(data.error || 'Failed to calculate shipping');
      }
    } catch (err) {
      setError('Failed to calculate shipping estimate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <BrandLogo withText size={28} textClassName="text-2xl font-bold text-primary-600" />
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 hover:text-primary-600 flex items-center gap-2"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to Home
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-8">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Shipping Cost Calculator
          </h2>
          <p className="text-xl text-gray-600">
            Get an instant estimate for delivery to your location
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Calculator Form */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <Calculator className="w-6 h-6 text-primary-600" />
              <h3 className="text-xl font-bold">Calculate Shipping</h3>
            </div>

            <form onSubmit={calculateShipping} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Delivery State *
                </label>
                <select
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  required
                >
                  <option value="">Select state...</option>
                  {NIGERIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  City
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g., Ikeja"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Package Weight (kg) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="e.g., 2.5"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Order Value (₦)
                </label>
                <input
                  type="number"
                  value={orderValue}
                  onChange={(e) => setOrderValue(e.target.value)}
                  placeholder="e.g., 50000"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800 text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 text-white py-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Calculating...' : 'Calculate Shipping Cost'}
              </button>
            </form>
          </div>

          {/* Results */}
          <div>
            {estimate ? (
              <div className="bg-white rounded-2xl shadow-xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Package className="w-6 h-6 text-green-600" />
                  <h3 className="text-xl font-bold">Shipping Estimate</h3>
                </div>

                <div className="bg-gradient-to-br from-primary-50 to-blue-50 rounded-lg p-6 mb-6">
                  <p className="text-sm text-gray-600 mb-2">Total Shipping Cost</p>
                  <p className="text-4xl font-bold text-primary-600">
                    ₦{estimate.totalShippingFee.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-600 mt-2">
                    Zone: {estimate.zoneName}
                  </p>
                </div>

                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-900">Breakdown by Hub</h4>
                  {estimate.subOrders.map((subOrder, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">{subOrder.hubName}</p>
                          <p className="text-sm text-gray-600">via {subOrder.courierName}</p>
                        </div>
                        <p className="font-bold text-lg">₦{subOrder.totalShippingFee.toLocaleString()}</p>
                      </div>
                      
                      <div className="space-y-1 text-sm text-gray-600">
                        <div className="flex justify-between">
                          <span>Weight:</span>
                          <span>{subOrder.totalWeight} kg</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Base Rate:</span>
                          <span>₦{subOrder.baseRate.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>VAT (7.5%):</span>
                          <span>₦{subOrder.vat.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t">
                          <span className="font-medium">Estimated Delivery:</span>
                          <span className="font-medium">{subOrder.deliveryTimelineDays} days</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-900">
                    💡 <strong>Note:</strong> This is an estimate. Final shipping cost may vary based on actual package dimensions and weight.
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                  <TrendingUp className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Ready to Calculate
                </h3>
                <p className="text-gray-600">
                  Fill in the form to get your shipping estimate
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          <div className="bg-white rounded-lg p-6 text-center">
            <MapPin className="w-8 h-8 text-primary-600 mx-auto mb-3" />
            <h4 className="font-semibold mb-2">Nationwide Coverage</h4>
            <p className="text-sm text-gray-600">We deliver to all 36 states + FCT</p>
          </div>

          <div className="bg-white rounded-lg p-6 text-center">
            <Package className="w-8 h-8 text-green-600 mx-auto mb-3" />
            <h4 className="font-semibold mb-2">Multi-Hub Network</h4>
            <p className="text-sm text-gray-600">Faster delivery from closest hub</p>
          </div>

          <div className="bg-white rounded-lg p-6 text-center">
            <Calculator className="w-8 h-8 text-blue-600 mx-auto mb-3" />
            <h4 className="font-semibold mb-2">Transparent Pricing</h4>
            <p className="text-sm text-gray-600">No hidden fees, VAT included</p>
          </div>
        </div>
      </div>
    </div>
  );
}
