import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, DollarSign, Percent } from 'lucide-react';

interface Influencer {
  id: string;
  name: string;
  email: string;
  phone: string;
  platform: string;
  handle: string;
  coupon_code: string;
  shipping_discount_type: string;
  shipping_discount_value: number;
  minimum_order_value: number;
  commission_rate: number;
  tier: string;
  status: string;
  total_orders: number;
  total_sales: number;
  total_commission_earned: number;
  total_commission_paid: number;
  total_shipping_discounts: number;
  last_sale_date: string;
  created_at: string;
}

interface Sale {
  id: string;
  wc_order_id: string;
  order_number: string;
  customer_email: string;
  product_total: number;
  shipping_original_cost: number;
  shipping_discount_amount: number;
  shipping_customer_paid: number;
  shipping_actual_cost: number;
  influencer_commission_amount: number;
  commission_status: string;
  sale_date: string;
  order_status: string;
}

export default function InfluencerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [influencer, setInfluencer] = useState<Influencer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('this_month');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

      // Load influencer
      const influencerResponse = await fetch(`${apiUrl}/api/influencers/${id}`);
      const influencerResult = await influencerResponse.json();

      if (influencerResult.success) {
        setInfluencer(influencerResult.data);
      }

      // Load sales
      const salesResponse = await fetch(`${apiUrl}/api/influencers/${id}/sales?period=${dateRange}`);
      const salesResult = await salesResponse.json();

      if (salesResult.success) {
        setSales(salesResult.data || []);
      }

    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }, [id, dateRange]);

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id, loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!influencer) {
    return (
      <div className="p-6">
        <div className="text-center">
          <p className="text-red-600">Influencer not found</p>
          <button
            onClick={() => navigate('/admin/influencers')}
            className="mt-4 text-blue-600 hover:underline"
          >
            Back to Influencers
          </button>
        </div>
      </div>
    );
  }

  const pendingCommission = influencer.total_commission_earned - influencer.total_commission_paid;

  return (
    <div className="p-6">
      {/* Back Button */}
      <button
        onClick={() => navigate('/admin/influencers')}
        className="mb-4 text-purple-600 hover:underline flex items-center gap-1"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Influencers
      </button>

      {/* Influencer Header */}
      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex justify-between items-start">
          <div className="flex gap-4">
            <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center text-2xl font-bold text-purple-600">
              {influencer.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{influencer.name}</h1>
              <p className="text-gray-600 mt-1">
                {influencer.platform && influencer.handle && (
                  <>
                    {influencer.platform === 'instagram' && 'IG'}
                    {influencer.platform === 'tiktok' && 'TT'}
                    {influencer.platform === 'facebook' && 'FB'}
                    {influencer.platform === 'youtube' && 'YT'}
                    {' '}@{influencer.handle}
                  </>
                )}
              </p>
              <div className="flex gap-3 mt-2 text-sm text-gray-600">
                {influencer.email && <span>Email: {influencer.email}</span>}
                {influencer.phone && <span>Phone: {influencer.phone}</span>}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
              Edit Details
            </button>
            {pendingCommission > 0 && (
              <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                Process Payment
              </button>
            )}
          </div>
        </div>

        {/* Coupon Info */}
        <div className="mt-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-600">Coupon Code</p>
              <p className="text-lg font-mono font-bold text-purple-600">
                {influencer.coupon_code}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Shipping Discount</p>
              <p className="text-lg font-semibold text-gray-900">
                {influencer.shipping_discount_type === 'percentage' && `${influencer.shipping_discount_value}% off`}
                {influencer.shipping_discount_type === 'fixed' && `₦${influencer.shipping_discount_value} off`}
                {influencer.shipping_discount_type === 'free' && 'Free shipping'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Commission Rate</p>
              <p className="text-lg font-semibold text-gray-900">
                {influencer.commission_rate}%
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Tier</p>
              <p className="text-lg font-semibold text-gray-900">
                {influencer.tier}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Orders"
          value={influencer.total_orders}
          icon={<Package className="h-5 w-5 text-blue-600" />}
        />
        <StatCard
          label="Product Sales"
          value={`₦${influencer.total_sales.toLocaleString()}`}
          icon={<DollarSign className="h-5 w-5 text-green-600" />}
        />
        <StatCard
          label="Shipping Discounts Given"
          value={`₦${influencer.total_shipping_discounts.toLocaleString()}`}
          icon={<Percent className="h-5 w-5 text-orange-600" />}
          className="text-orange-600"
        />
        <StatCard
          label="Commission Owed"
          value={`₦${pendingCommission.toLocaleString()}`}
          icon={<DollarSign className="h-5 w-5 text-emerald-600" />}
          className="text-green-600"
        />
      </div>

      {/* Sales History */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-lg font-semibold">Sales History</h2>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1"
          >
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="last_3_months">Last 3 Months</option>
            <option value="all_time">All Time</option>
          </select>
        </div>

        {sales.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p>No sales recorded yet for this period</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order #</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Product Total</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Shipping</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Discount</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Commission</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {sales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      {new Date(sale.sale_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">
                      {sale.order_number}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold">
                      ₦{sale.product_total.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <div>
                        <p className="line-through text-gray-400">
                          ₦{sale.shipping_original_cost.toLocaleString()}
                        </p>
                        <p className="text-green-600">
                          ₦{sale.shipping_customer_paid.toLocaleString()}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-red-600">
                      -₦{sale.shipping_discount_amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-green-600 font-semibold">
                      ₦{sale.influencer_commission_amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        sale.commission_status === 'paid'
                          ? 'bg-green-100 text-green-800'
                          : sale.commission_status === 'pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {sale.commission_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  icon, 
  className 
}: { 
  label: string; 
  value: string | number; 
  icon: ReactNode; 
  className?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${className || 'text-gray-900'}`}>
            {value}
          </p>
        </div>
        <div>{icon}</div>
      </div>
    </div>
  );
}

