import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Package, DollarSign, BarChart3, UserX } from 'lucide-react';

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

interface Stats {
  total_influencers: number;
  active_influencers: number;
  total_orders_this_month: number;
  commission_owed: number;
  avg_order_value: number;
}

interface PayModalState {
  influencer: Influencer;
  pendingAmount: number;
}

export default function InfluencersPage() {
  const navigate = useNavigate();
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [payModal, setPayModal] = useState<PayModalState | null>(null);
  const [stats, setStats] = useState<Stats>({
    total_influencers: 0,
    active_influencers: 0,
    total_orders_this_month: 0,
    commission_owed: 0,
    avg_order_value: 0
  });

  useEffect(() => {
    loadInfluencers();
  }, []);

  async function loadInfluencers() {
    try {
      setLoading(true);
      const API_BASE_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${API_BASE_URL}/influencers?status=active`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`
        }
      });
      const result = await response.json();

      if (result.success) {
        setInfluencers(result.data);

        // Calculate stats
        const active = result.data.filter((i: Influencer) => i.status === 'active').length;
        const totalOrders = result.data.reduce((sum: number, i: Influencer) => sum + (i.total_orders || 0), 0);
        const commissionOwed = result.data.reduce(
          (sum: number, i: Influencer) => sum + ((i.total_commission_earned || 0) - (i.total_commission_paid || 0)),
          0
        );
        const totalSales = result.data.reduce((sum: number, i: Influencer) => sum + (i.total_sales || 0), 0);
        const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

        setStats({
          total_influencers: result.data.length,
          active_influencers: active,
          total_orders_this_month: totalOrders,
          commission_owed: commissionOwed,
          avg_order_value: avgOrderValue
        });
      }
    } catch (error) {
      console.error('Error loading influencers:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading influencers...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Influencer Program</h1>
          <p className="text-gray-600 mt-1">Manage affiliate partnerships and track performance</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 transition-colors"
        >
          <span className="text-xl">+</span>
          Add Influencer
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6">
        <StatCard
          icon={<Users className="h-5 w-5 text-purple-600" />}
          label="Active Influencers"
          value={stats.active_influencers}
          subtitle={`of ${stats.total_influencers} total`}
        />
        <StatCard
          icon={<Package className="h-5 w-5 text-blue-600" />}
          label="Total Orders"
          value={stats.total_orders_this_month}
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5 text-green-600" />}
          label="Commission Owed"
          value={`₦${stats.commission_owed.toLocaleString()}`}
          highlight="text-orange-600"
        />
        <StatCard
          icon={<BarChart3 className="h-5 w-5 text-indigo-600" />}
          label="Avg Order Value"
          value={`₦${Math.round(stats.avg_order_value).toLocaleString()}`}
        />
      </div>

      {/* Influencers Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {influencers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-gray-400">
              <div className="flex justify-center mb-4">
                <div className="h-12 w-12 rounded-full bg-purple-50 flex items-center justify-center">
                  <UserX className="h-6 w-6 text-purple-400" />
                </div>
              </div>
              <p className="text-lg mb-2">No influencers yet</p>
              <p className="text-sm mb-4">Click "Add Influencer" to start your affiliate program</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Add Your First Influencer
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sm:hidden space-y-3 p-4">
              {influencers.map((influencer) => {
                const pendingCommission =
                  (influencer.total_commission_earned || 0) -
                  (influencer.total_commission_paid || 0);
                return (
                  <div key={influencer.id} className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-gray-900">{influencer.name}</p>
                        {influencer.platform && influencer.handle && (
                          <p className="text-sm text-gray-500">
                            {influencer.platform === 'instagram' && 'IG'}
                            {influencer.platform === 'tiktok' && 'TT'}
                            {influencer.platform === 'facebook' && 'FB'}
                            {influencer.platform === 'youtube' && 'YT'} @{influencer.handle}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          Code: <span className="font-mono">{influencer.coupon_code}</span>
                        </p>
                      </div>
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          influencer.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : influencer.status === 'paused'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {influencer.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mt-3">
                      <div>
                        <p className="text-gray-400">Discount</p>
                        <p className="text-gray-800">
                          {influencer.shipping_discount_type === 'percentage' &&
                            `${influencer.shipping_discount_value}% off`}
                          {influencer.shipping_discount_type === 'fixed' &&
                            `₦${influencer.shipping_discount_value} off`}
                          {influencer.shipping_discount_type === 'free' && 'Free shipping'}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Orders</p>
                        <p className="text-gray-800">{influencer.total_orders || 0}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Sales</p>
                        <p className="text-gray-800">
                          ₦{(influencer.total_sales || 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Commission</p>
                        <p className="text-green-600">
                          ₦{(influencer.total_commission_earned || 0).toLocaleString()}
                        </p>
                        {pendingCommission > 0 && (
                          <p className="text-[10px] text-orange-600">
                            ₦{pendingCommission.toLocaleString()} pending
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-4">
                      <button
                        onClick={() => navigate(`/admin/influencers/${influencer.id}`)}
                        className="px-3 py-1.5 text-xs bg-blue-50 text-blue-700 rounded-lg"
                      >
                        View
                      </button>
                      {influencer.status === 'active' && (
                        <button
                          onClick={async () => {
                            if (!window.confirm('Terminate this influencer contract and deactivate their coupon?')) {
                              return;
                            }
                            try {
                              const API_BASE_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
                              const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
                              const response = await fetch(`${API_BASE_URL}/influencers/${influencer.id}`, {
                                method: 'PUT',
                                headers: {
                                  'Content-Type': 'application/json',
                                  apikey: anonKey,
                                  Authorization: `Bearer ${anonKey}`
                                },
                                body: JSON.stringify({ status: 'terminated' })
                              });
                              const result = await response.json();
                              if (!result.success) {
                                window.alert(result.error || 'Failed to terminate influencer');
                                return;
                              }
                              loadInfluencers();
                            } catch (error) {
                              window.alert('Failed to terminate influencer');
                            }
                          }}
                          className="px-3 py-1.5 text-xs bg-red-50 text-red-700 rounded-lg"
                        >
                          Terminate
                        </button>
                      )}
                      {pendingCommission > 0 && (
                        <button
                          onClick={() => setPayModal({ influencer, pendingAmount: pendingCommission })}
                          className="px-3 py-1.5 text-xs bg-green-50 text-green-700 rounded-lg"
                        >
                          Pay
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Influencer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Discount
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Orders
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sales
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Commission
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {influencers.map((influencer) => (
                  <InfluencerRow
                    key={influencer.id}
                    influencer={influencer}
                    onViewDetails={() => navigate(`/admin/influencers/${influencer.id}`)}
                    onPay={(pendingAmount) => setPayModal({ influencer, pendingAmount })}
                  />
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Add Influencer Modal */}
      {showAddModal && (
        <AddInfluencerModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            loadInfluencers();
          }}
        />
      )}

      {/* Pay Commission Modal */}
      {payModal && (
        <PayCommissionModal
          influencer={payModal.influencer}
          pendingAmount={payModal.pendingAmount}
          onClose={() => setPayModal(null)}
          onSuccess={() => {
            setPayModal(null);
            loadInfluencers();
          }}
        />
      )}
    </div>
  );
}

// Stats Card Component
function StatCard({ icon, label, value, subtitle, highlight }: {
  icon: ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  highlight?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-3 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] sm:text-sm text-gray-600 mb-1">{label}</p>
          <p className={`text-lg sm:text-2xl font-bold ${highlight || 'text-gray-900'}`}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[10px] sm:text-xs text-gray-400 mt-1">{subtitle}</p>
          )}
        </div>
        <div className="text-sm sm:text-base">{icon}</div>
      </div>
    </div>
  );
}

// Influencer Row Component
function InfluencerRow({
  influencer,
  onViewDetails,
  onPay,
}: {
  influencer: Influencer;
  onViewDetails: () => void;
  onPay: (pendingAmount: number) => void;
}) {
  const pendingCommission = (influencer.total_commission_earned || 0) - (influencer.total_commission_paid || 0);

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'instagram': return 'IG';
      case 'tiktok': return 'TT';
      case 'facebook': return 'FB';
      case 'youtube': return 'YT';
      default: return '??';
    }
  };

  const getDiscountText = (current: Influencer) => {
    switch (current.shipping_discount_type) {
      case 'percentage':
        return `${current.shipping_discount_value}% off`;
      case 'fixed':
        return `₦${current.shipping_discount_value} off`;
      case 'free':
        return 'Free shipping';
      default:
        return 'N/A';
    }
  };

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-6 py-4">
        <div>
          <p className="font-semibold text-gray-900">{influencer.name}</p>
          {influencer.platform && influencer.handle && (
            <p className="text-sm text-gray-500">
              {getPlatformIcon(influencer.platform)} @{influencer.handle}
            </p>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <code className="bg-purple-100 text-purple-800 px-3 py-1 rounded text-sm font-mono font-semibold">
          {influencer.coupon_code}
        </code>
      </td>
      <td className="px-6 py-4 text-sm text-gray-600">
        {getDiscountText(influencer)}
      </td>
      <td className="px-6 py-4 text-right font-semibold text-gray-900">
        {influencer.total_orders || 0}
      </td>
      <td className="px-6 py-4 text-right text-gray-900">
        ₦{(influencer.total_sales || 0).toLocaleString()}
      </td>
      <td className="px-6 py-4 text-right">
        <div>
          <p className="font-semibold text-green-600">
            ₦{(influencer.total_commission_earned || 0).toLocaleString()}
          </p>
          {pendingCommission > 0 && (
            <p className="text-xs text-orange-600">
              ₦{pendingCommission.toLocaleString()} pending
            </p>
          )}
        </div>
      </td>
      <td className="px-6 py-4 text-center">
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          influencer.status === 'active'
            ? 'bg-green-100 text-green-800'
            : influencer.status === 'paused'
            ? 'bg-yellow-100 text-yellow-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {influencer.status}
        </span>
      </td>
      <td className="px-6 py-4 text-center">
        <div className="flex gap-2 justify-center">
          <button
            onClick={onViewDetails}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            View
          </button>
          {influencer.status === 'active' && (
            <button
              onClick={async () => {
                if (!window.confirm('Terminate this influencer contract and deactivate their coupon?')) {
                  return;
                }
                try {
                  const API_BASE_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
                  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
                  const response = await fetch(`${API_BASE_URL}/influencers/${influencer.id}`, {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      apikey: anonKey,
                      Authorization: `Bearer ${anonKey}`
                    },
                    body: JSON.stringify({ status: 'terminated' })
                  });
                  const result = await response.json();
                  if (!result.success) {
                    window.alert(result.error || 'Failed to terminate influencer');
                    return;
                  }
                  window.location.reload();
                } catch (error) {
                  window.alert('Failed to terminate influencer');
                }
              }}
              className="text-red-600 hover:text-red-800 text-sm font-medium"
            >
              Terminate
            </button>
          )}
          {pendingCommission > 0 && (
            <button
              onClick={() => onPay(pendingCommission)}
              className="text-green-600 hover:text-green-800 text-sm font-medium"
            >
              Pay
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Pay Commission Modal
function PayCommissionModal({
  influencer,
  pendingAmount,
  onClose,
  onSuccess,
}: {
  influencer: Influencer;
  pendingAmount: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handlePay() {
    setLoading(true);
    setError('');
    try {
      const API_BASE_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${API_BASE_URL}/influencers/${influencer.id}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          payment_method: paymentMethod,
          payment_reference: paymentReference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const result = await response.json();
      if (!result.success) {
        setError(result.error || 'Payment failed');
        return;
      }
      onSuccess();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Pay Commission</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded text-sm">{error}</div>
          )}

          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-700">Paying commission to</p>
            <p className="font-bold text-green-900 text-lg">{influencer.name}</p>
            <p className="text-2xl font-bold text-green-700 mt-1">₦{pendingAmount.toLocaleString()}</p>
            <p className="text-xs text-green-600 mt-1">Pending commission across all unpaid sales</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash</option>
              <option value="paystack">Paystack</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Reference (optional)</label>
            <input
              type="text"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="e.g. bank trnx ID or receipt no."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              placeholder="Any additional notes..."
            />
          </div>
        </div>

        <div className="p-6 border-t flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePay}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
          >
            {loading ? 'Processing...' : `Pay ₦${pendingAmount.toLocaleString()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Add Influencer Modal Component
function AddInfluencerModal({
  onClose,
  onSuccess
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    platform: 'instagram',
    handle: '',
    coupon_code: '',
    shipping_discount_type: 'percentage',
    shipping_discount_value: 50,
    minimum_order_value: 0,
    commission_rate: 5,
    tier: 'TIER1'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const API_BASE_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const response = await fetch(`${API_BASE_URL}/influencers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || 'Failed to create influencer');
        return;
      }

      onSuccess();

    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b sticky top-0 bg-white z-10">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Add New Influencer</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              x
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Personal Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Personal Information</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Sarah Lagos"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="sarah@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="08012345678"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Platform
                </label>
                <select
                  value={formData.platform}
                  onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="facebook">Facebook</option>
                  <option value="youtube">YouTube</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Handle
                </label>
                <input
                  type="text"
                  value={formData.handle}
                  onChange={(e) => setFormData({ ...formData, handle: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="sarahlagos"
                />
              </div>
            </div>
          </div>

          {/* Coupon Configuration */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold text-gray-900">Coupon Configuration</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Coupon Code <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.coupon_code}
                onChange={(e) => setFormData({
                  ...formData,
                  coupon_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono uppercase"
                placeholder="SARAH50"
                maxLength={20}
              />
              <p className="text-xs text-gray-500 mt-1">Must be unique. Letters and numbers only.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Discount Type
                </label>
                <select
                  value={formData.shipping_discount_type}
                  onChange={(e) => setFormData({ ...formData, shipping_discount_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                >
                  <option value="percentage">Percentage Off</option>
                  <option value="fixed">Fixed Amount Off</option>
                  <option value="free">Free Shipping</option>
                </select>
              </div>

              {formData.shipping_discount_type !== 'free' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Discount Value
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.shipping_discount_value}
                    onChange={(e) => setFormData({
                      ...formData,
                      shipping_discount_value: parseFloat(e.target.value)
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder={formData.shipping_discount_type === 'percentage' ? '50' : '500'}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.shipping_discount_type === 'percentage'
                      ? 'Enter percentage (e.g., 50 for 50%)'
                      : 'Enter amount in Naira'}
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum Order Value (₦)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={formData.minimum_order_value}
                  onChange={(e) => setFormData({
                    ...formData,
                    minimum_order_value: parseFloat(e.target.value)
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="0"
                />
                <p className="text-xs text-gray-500 mt-1">0 = No minimum</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Commission Rate (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={formData.commission_rate}
                  onChange={(e) => setFormData({
                    ...formData,
                    commission_rate: parseFloat(e.target.value)
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="5"
                />
                <p className="text-xs text-gray-500 mt-1">Commission on product total</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tier
              </label>
              <select
                value={formData.tier}
                onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="TIER1">Tier 1 (Micro-influencer, 1K-10K followers)</option>
                <option value="TIER2">Tier 2 (Mid-tier, 10K-50K followers)</option>
                <option value="TIER3">Tier 3 (Premium, 50K+ followers)</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400 transition-colors"
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Influencer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
