import { Package, DollarSign, Percent, Wallet, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function discountText(type: string, value: number): string {
  switch (type) {
    case 'percentage': return `${value}% off shipping`;
    case 'fixed': return `₦${value.toLocaleString()} off shipping`;
    case 'free': return 'Free shipping';
    default: return 'No shipping discount';
  }
}

function StatCard({ label, value, icon, highlight }: { label: string; value: string; icon: React.ReactNode; highlight?: string }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{label}</p>
          <p className={`text-2xl font-bold ${highlight || 'text-gray-900'}`}>{value}</p>
        </div>
        <div>{icon}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { influencer } = useAuth();
  const [copied, setCopied] = useState(false);

  if (!influencer) return null;

  const pendingCommission = influencer.total_commission_earned - influencer.total_commission_paid;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(influencer.coupon_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Welcome back, {influencer.name.split(' ')[0]}</h1>
        <p className="text-gray-500 mt-1">Here's how your coupon is performing.</p>
      </div>

      {/* Coupon card */}
      <div className="card bg-gradient-to-br from-primary-50 to-secondary-50 border-primary-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-sm text-gray-600 mb-1">Your Coupon Code</p>
            <div className="flex items-center gap-2">
              <code className="text-2xl font-mono font-bold text-primary-700">{influencer.coupon_code}</code>
              <button
                onClick={copyCode}
                className="p-1.5 rounded-lg hover:bg-white/60 transition-colors"
                aria-label="Copy coupon code"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-gray-500" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Shipping perk</p>
              <p className="font-semibold text-gray-900">{discountText(influencer.shipping_discount_type, influencer.shipping_discount_value)}</p>
            </div>
            <div>
              <p className="text-gray-500">Commission rate</p>
              <p className="font-semibold text-gray-900">{influencer.commission_rate}% · {influencer.tier}</p>
            </div>
          </div>
        </div>
        {influencer.minimum_order_value > 0 && (
          <p className="text-xs text-gray-500 mt-3">Minimum order value: ₦{influencer.minimum_order_value.toLocaleString()}</p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Orders" value={String(influencer.total_orders || 0)} icon={<Package className="h-5 w-5 text-blue-600" />} />
        <StatCard label="Product Sales" value={`₦${(influencer.total_sales || 0).toLocaleString()}`} icon={<DollarSign className="h-5 w-5 text-green-600" />} />
        <StatCard label="Shipping Discounts Given" value={`₦${(influencer.total_shipping_discounts || 0).toLocaleString()}`} icon={<Percent className="h-5 w-5 text-orange-600" />} />
        <StatCard
          label="Commission Owed"
          value={`₦${pendingCommission.toLocaleString()}`}
          icon={<Wallet className="h-5 w-5 text-emerald-600" />}
          highlight="text-emerald-600"
        />
      </div>

      <div className="card">
        <p className="text-sm text-gray-500">
          Commission earned to date: <span className="font-semibold text-gray-900">₦{(influencer.total_commission_earned || 0).toLocaleString()}</span>
          {' · '}Paid out so far: <span className="font-semibold text-gray-900">₦{(influencer.total_commission_paid || 0).toLocaleString()}</span>
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Payouts are processed by the JulineMart team. See your Profile page to keep your payout bank details up to date.
        </p>
      </div>
    </div>
  );
}
