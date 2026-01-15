import { useEffect, useState, useMemo } from 'react';
import { 
  Ticket, Plus, Edit, Trash2, Eye, EyeOff, Loader2, 
  Calendar, Users, DollarSign, Package, TrendingUp, AlertCircle,
  CheckCircle, XCircle, Clock
} from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

interface CampaignVoucher {
  id: string;
  code: string;
  campaign_name: string;
  description: string | null;
  discount_type: 'free' | 'percentage' | 'fixed_amount';
  discount_value: number | null;
  product_ids: string[] | null;
  product_skus: string[] | null;
  vendor_ids: string[] | null;
  max_uses: number;
  current_uses: number;
  max_uses_per_customer: number;
  valid_from: string;
  valid_until: string | null;
  status: 'active' | 'used' | 'expired' | 'cancelled';
  total_cost_absorbed: number;
  total_vendor_payout: number;
  created_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface VoucherRedemption {
  id: string;
  voucher_id: string;
  customer_email: string;
  customer_name: string;
  original_price: number;
  discount_applied: number;
  customer_paid: number;
  vendor_payout: number;
  julinemart_absorbed: number;
  redeemed_at: string;
}

interface FormState {
  code: string;
  campaign_name: string;
  description: string;
  discount_type: 'free' | 'percentage' | 'fixed_amount';
  discount_value: number | '';
  product_ids: string;
  product_skus: string;
  vendor_ids: string;
  max_uses: number;
  max_uses_per_customer: number;
  valid_from: string;
  valid_until: string;
  notes: string;
}

const emptyForm: FormState = {
  code: '',
  campaign_name: '',
  description: '',
  discount_type: 'free',
  discount_value: '',
  product_ids: '',
  product_skus: '',
  vendor_ids: '',
  max_uses: 1,
  max_uses_per_customer: 1,
  valid_from: new Date().toISOString().slice(0, 16),
  valid_until: '',
  notes: '',
};

const statusColors = {
  active: 'bg-green-100 text-green-800',
  used: 'bg-gray-100 text-gray-800',
  expired: 'bg-red-100 text-red-800',
  cancelled: 'bg-orange-100 text-orange-800',
};

const statusIcons = {
  active: CheckCircle,
  used: XCircle,
  expired: Clock,
  cancelled: AlertCircle,
};

export function VouchersPage() {
  const { user } = useAuth();
  const notification = useNotification();
  const [vouchers, setVouchers] = useState<CampaignVoucher[]>([]);
  const [redemptions, setRedemptions] = useState<VoucherRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedVoucher, setSelectedVoucher] = useState<CampaignVoucher | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);
  const [showCode, setShowCode] = useState<Record<string, boolean>>({});

  const isAdmin = useMemo(() => user?.role === 'admin', [user?.role]);

  useEffect(() => {
    void loadVouchers();
  }, []);

  const loadVouchers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('campaign_vouchers')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setVouchers(data || []);
    } catch (err: any) {
      console.error('Failed to load vouchers', err);
      notification.error('Load failed', err?.message || 'Could not fetch vouchers');
    } finally {
      setLoading(false);
    }
  };

  const loadRedemptions = async (voucherId: string) => {
    try {
      const { data, error } = await supabase
        .from('voucher_redemptions')
        .select('*')
        .eq('voucher_id', voucherId)
        .order('redeemed_at', { ascending: false });
      if (error) throw error;
      setRedemptions(data || []);
    } catch (err: any) {
      console.error('Failed to load redemptions', err);
      notification.error('Load failed', err?.message || 'Could not fetch redemptions');
    }
  };

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (voucher: CampaignVoucher) => {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can manage vouchers');
      return;
    }
    setEditingId(voucher.id);
    setFormData({
      code: voucher.code,
      campaign_name: voucher.campaign_name,
      description: voucher.description || '',
      discount_type: voucher.discount_type,
      discount_value: voucher.discount_value ?? '',
      product_ids: (voucher.product_ids || []).join(', '),
      product_skus: (voucher.product_skus || []).join(', '),
      vendor_ids: (voucher.vendor_ids || []).join(', '),
      max_uses: voucher.max_uses,
      max_uses_per_customer: voucher.max_uses_per_customer,
      valid_from: new Date(voucher.valid_from).toISOString().slice(0, 16),
      valid_until: voucher.valid_until ? new Date(voucher.valid_until).toISOString().slice(0, 16) : '',
      notes: voucher.notes || '',
    });
    setFormOpen(true);
  };

  const openDetails = async (voucher: CampaignVoucher) => {
    setSelectedVoucher(voucher);
    setDetailsOpen(true);
    await loadRedemptions(voucher.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can manage vouchers');
      return;
    }

    if (!formData.code.trim() || !formData.campaign_name.trim()) {
      notification.error('Validation', 'Code and campaign name are required');
      return;
    }

    if (formData.discount_type !== 'free' && (!formData.discount_value || Number(formData.discount_value) <= 0)) {
      notification.error('Validation', 'Discount value must be greater than 0');
      return;
    }

    const parseArray = (value: string) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const payload = {
      code: formData.code.trim().toUpperCase(),
      campaign_name: formData.campaign_name.trim(),
      description: formData.description.trim() || null,
      discount_type: formData.discount_type,
      discount_value: formData.discount_type === 'free' ? 0 : Number(formData.discount_value),
      product_ids: parseArray(formData.product_ids),
      product_skus: parseArray(formData.product_skus).map((sku) => sku.toUpperCase()),
      vendor_ids: parseArray(formData.vendor_ids),
      max_uses: Number(formData.max_uses),
      max_uses_per_customer: Number(formData.max_uses_per_customer),
      valid_from: new Date(formData.valid_from).toISOString(),
      valid_until: formData.valid_until ? new Date(formData.valid_until).toISOString() : null,
      notes: formData.notes.trim() || null,
      created_by: user?.email || 'system',
    };

    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from('campaign_vouchers')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
        notification.success('Updated', 'Voucher updated successfully');
      } else {
        const { error } = await supabase.from('campaign_vouchers').insert(payload);
        if (error) throw error;
        notification.success('Created', 'Voucher created successfully');
      }
      setFormOpen(false);
      resetForm();
      await loadVouchers();
    } catch (err: any) {
      console.error('Save voucher error', err);
      notification.error('Save failed', err?.message || 'Unable to save voucher');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can delete vouchers');
      return;
    }
    if (!confirm('Delete this voucher? This will also delete all redemption records.')) return;
    try {
      const { error } = await supabase.from('campaign_vouchers').delete().eq('id', id);
      if (error) throw error;
      notification.success('Deleted', 'Voucher removed');
      await loadVouchers();
    } catch (err: any) {
      console.error('Delete voucher error', err);
      notification.error('Delete failed', err?.message || 'Unable to delete voucher');
    }
  };

  const handleCancel = async (id: string) => {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can cancel vouchers');
      return;
    }
    if (!confirm('Cancel this voucher? It will no longer be usable.')) return;
    try {
      const { error } = await supabase
        .from('campaign_vouchers')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
      notification.success('Cancelled', 'Voucher cancelled');
      await loadVouchers();
    } catch (err: any) {
      console.error('Cancel voucher error', err);
      notification.error('Cancel failed', err?.message || 'Unable to cancel voucher');
    }
  };

  const toggleCodeVisibility = (id: string) => {
    setShowCode(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const formatCurrency = (amount: number) => {
    return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'No expiry';
    return new Date(date).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getDiscountLabel = (voucher: CampaignVoucher) => {
    switch (voucher.discount_type) {
      case 'free':
        return '100% Off';
      case 'percentage':
        return `${voucher.discount_value}% Off`;
      case 'fixed_amount':
        return `${formatCurrency(voucher.discount_value || 0)} Off`;
      default:
        return 'Discount';
    }
  };

  const stats = useMemo(() => {
    const active = vouchers.filter(v => v.status === 'active').length;
    const totalAbsorbed = vouchers.reduce((sum, v) => sum + (v.total_cost_absorbed || 0), 0);
    const totalRedemptions = vouchers.reduce((sum, v) => sum + v.current_uses, 0);
    const avgDiscount = totalRedemptions > 0 ? totalAbsorbed / totalRedemptions : 0;

    return { active, totalAbsorbed, totalRedemptions, avgDiscount };
  }, [vouchers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Campaign Vouchers</h1>
          <p className="text-gray-600 mt-2">
            Manage promotional codes where JulineMart absorbs the cost while vendors receive full payment
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary flex items-center">
            <Plus className="w-5 h-5 mr-2" />
            Create Voucher
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Vouchers</p>
              <p className="text-2xl font-bold text-gray-900">{stats.active}</p>
            </div>
            <Ticket className="w-8 h-8 text-green-600" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Redemptions</p>
              <p className="text-2xl font-bold text-gray-900">{stats.totalRedemptions}</p>
            </div>
            <Users className="w-8 h-8 text-blue-600" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Cost Absorbed</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.totalAbsorbed)}</p>
            </div>
            <DollarSign className="w-8 h-8 text-red-600" />
          </div>
        </div>

        <div className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Avg Discount</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.avgDiscount)}</p>
            </div>
            <TrendingUp className="w-8 h-8 text-purple-600" />
          </div>
        </div>
      </div>

      {/* Vouchers List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : vouchers.length === 0 ? (
        <div className="card text-center py-12">
          <Ticket className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">No vouchers created yet.</p>
          {isAdmin && (
            <button onClick={openCreate} className="btn-primary">
              Create your first voucher
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {vouchers.map((voucher) => {
            const StatusIcon = statusIcons[voucher.status];
            const usagePercent = (voucher.current_uses / voucher.max_uses) * 100;

            return (
              <div key={voucher.id} className="card space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Ticket className="w-4 h-4 text-primary-600" />
                      <h3 className="font-semibold text-gray-900">{voucher.campaign_name}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                        {showCode[voucher.id] ? voucher.code : '••••••••'}
                      </code>
                      <button
                        onClick={() => toggleCodeVisibility(voucher.id)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {showCode[voucher.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${statusColors[voucher.status]}`}>
                    <StatusIcon className="w-3 h-3" />
                    {voucher.status}
                  </span>
                </div>

                {/* Discount Badge */}
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm font-medium">
                  <Package className="w-4 h-4" />
                  {getDiscountLabel(voucher)}
                </div>

                {/* Usage Bar */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-600">Usage</span>
                    <span className="font-medium">{voucher.current_uses} / {voucher.max_uses}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        usagePercent >= 100 ? 'bg-red-500' : usagePercent >= 75 ? 'bg-orange-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(usagePercent, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Financial Info */}
                {voucher.total_cost_absorbed > 0 && (
                  <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-red-600">Cost Absorbed</span>
                      <span className="font-semibold text-red-900">{formatCurrency(voucher.total_cost_absorbed)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-gray-600">Vendor Payout</span>
                      <span className="font-medium text-gray-900">{formatCurrency(voucher.total_vendor_payout)}</span>
                    </div>
                  </div>
                )}

                {/* Dates */}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>Valid until: {formatDate(voucher.valid_until)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t">
                  <button
                    onClick={() => openDetails(voucher)}
                    className="flex-1 btn-secondary text-sm"
                  >
                    View Details
                  </button>
                  {isAdmin && voucher.status === 'active' && (
                    <>
                      <button
                        onClick={() => openEdit(voucher)}
                        className="btn-secondary p-2"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleCancel(voucher.id)}
                        className="btn-secondary p-2 text-orange-600 hover:text-orange-700"
                        title="Cancel"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(voucher.id)}
                        className="btn-secondary p-2 text-red-600 hover:text-red-700"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {formOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold">
                {editingId ? 'Edit Voucher' : 'Create New Voucher'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Voucher Code *
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="e.g., FREESHIP2025"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Campaign Name *
                  </label>
                  <input
                    type="text"
                    value={formData.campaign_name}
                    onChange={(e) => setFormData({ ...formData, campaign_name: e.target.value })}
                    placeholder="e.g., Launch Promotion"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Campaign description..."
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Discount Type *
                  </label>
                  <select
                    value={formData.discount_type}
                    onChange={(e) => setFormData({ ...formData, discount_type: e.target.value as any })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="free">Free (100% Off)</option>
                    <option value="percentage">Percentage Off</option>
                    <option value="fixed_amount">Fixed Amount Off</option>
                  </select>
                </div>

                {formData.discount_type !== 'free' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Discount Value *
                    </label>
                    <input
                      type="number"
                      value={formData.discount_value}
                      onChange={(e) => setFormData({ ...formData, discount_value: e.target.value === '' ? '' : Number(e.target.value) })}
                      placeholder={formData.discount_type === 'percentage' ? 'e.g., 50' : 'e.g., 5000'}
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                      required
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Product IDs (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.product_ids}
                    onChange={(e) => setFormData({ ...formData, product_ids: e.target.value })}
                    placeholder="e.g., 123, 456, 789 (leave empty for all)"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Product SKUs (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.product_skus}
                    onChange={(e) => setFormData({ ...formData, product_skus: e.target.value })}
                    placeholder="e.g., SKU123, SKU456 (leave empty to not filter by SKU)"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm uppercase"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vendor IDs (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={formData.vendor_ids}
                    onChange={(e) => setFormData({ ...formData, vendor_ids: e.target.value })}
                    placeholder="UUIDs (leave empty for all vendors)"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Total Uses *
                  </label>
                  <input
                    type="number"
                    value={formData.max_uses}
                    onChange={(e) => setFormData({ ...formData, max_uses: Number(e.target.value) })}
                    min="1"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Max Uses Per Customer *
                  </label>
                  <input
                    type="number"
                    value={formData.max_uses_per_customer}
                    onChange={(e) => setFormData({ ...formData, max_uses_per_customer: Number(e.target.value) })}
                    min="1"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valid From *
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.valid_from}
                    onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valid Until (optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.valid_until}
                    onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Internal Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Internal notes (not shown to customers)..."
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                  className="btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary flex items-center"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      {editingId ? 'Update Voucher' : 'Create Voucher'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details Modal */}
      {detailsOpen && selectedVoucher && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{selectedVoucher.campaign_name}</h2>
                <button
                  onClick={() => {
                    setDetailsOpen(false);
                    setSelectedVoucher(null);
                    setRedemptions([]);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Voucher Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Code</p>
                  <p className="font-mono font-semibold">{selectedVoucher.code}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Discount</p>
                  <p className="font-semibold">{getDiscountLabel(selectedVoucher)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Usage</p>
                  <p className="font-semibold">{selectedVoucher.current_uses} / {selectedVoucher.max_uses}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Status</p>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[selectedVoucher.status]}`}>
                    {selectedVoucher.status}
                  </span>
                </div>
              </div>

              {/* Redemptions */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Redemptions ({redemptions.length})</h3>
                {redemptions.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No redemptions yet</p>
                ) : (
                  <div className="space-y-3">
                    {redemptions.map((redemption) => (
                      <div key={redemption.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-medium">{redemption.customer_name}</p>
                            <p className="text-sm text-gray-600">{redemption.customer_email}</p>
                          </div>
                          <p className="text-sm text-gray-500">
                            {new Date(redemption.redeemed_at).toLocaleString('en-NG')}
                          </p>
                        </div>
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-gray-600">Original</p>
                            <p className="font-medium">{formatCurrency(redemption.original_price)}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Discount</p>
                            <p className="font-medium text-red-600">-{formatCurrency(redemption.discount_applied)}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Customer Paid</p>
                            <p className="font-medium text-green-600">{formatCurrency(redemption.customer_paid)}</p>
                          </div>
                          <div>
                            <p className="text-gray-600">Vendor Gets</p>
                            <p className="font-medium text-blue-600">{formatCurrency(redemption.vendor_payout)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
