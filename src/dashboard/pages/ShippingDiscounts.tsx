import { useEffect, useMemo, useState } from 'react';
import { Percent, Tag, Plus, Edit, Trash2, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

type DiscountType = 'free' | 'flat' | 'percent';

interface ShippingDiscount {
  id: string;
  name: string;
  type: DiscountType;
  discount_value: number | null;
  min_order_value: number | null;
  states: string[] | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface FormState {
  name: string;
  type: DiscountType;
  discount_value: number | '';
  min_order_value: number | '';
  states: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  name: '',
  type: 'free',
  discount_value: '',
  min_order_value: '',
  states: '',
  start_date: '',
  end_date: '',
  is_active: true,
};

const typeLabels: Record<DiscountType, string> = {
  free: 'Free Shipping',
  flat: 'Flat Discount',
  percent: 'Percentage Discount',
};

const typeBadges: Record<DiscountType, string> = {
  free: 'bg-green-100 text-green-800',
  flat: 'bg-blue-100 text-blue-800',
  percent: 'bg-purple-100 text-purple-800',
};

function formatDateInput(value: string | null) {
  if (!value) return '';
  // toISOString keeps consistent formatting for datetime-local input
  return new Date(value).toISOString().slice(0, 16);
}

export function ShippingDiscountsPage() {
  const { user } = useAuth();
  const notification = useNotification();
  const [discounts, setDiscounts] = useState<ShippingDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormState>(emptyForm);

  const isAdmin = useMemo(() => user?.role === 'admin', [user?.role]);

  useEffect(() => {
    void loadDiscounts();
  }, []);

  const loadDiscounts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shipping_discounts')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setDiscounts(data || []);
    } catch (err: any) {
      console.error('Failed to load discounts', err);
      notification.error('Load failed', err?.message || 'Could not fetch discounts');
    } finally {
      setLoading(false);
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

  const openEdit = (discount: ShippingDiscount) => {
    setEditingId(discount.id);
    setFormData({
      name: discount.name || '',
      type: (discount.type as DiscountType) || 'free',
      discount_value: discount.discount_value ?? '',
      min_order_value: discount.min_order_value ?? '',
      states: (discount.states || []).join(', '),
      start_date: formatDateInput(discount.start_date),
      end_date: formatDateInput(discount.end_date),
      is_active: discount.is_active,
    });
    setFormOpen(true);
  };

  const parseStates = (value: string) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can manage discounts');
      return;
    }

    if (!formData.name.trim()) {
      notification.error('Validation', 'Name is required');
      return;
    }

    if (formData.type !== 'free' && (!formData.discount_value || Number(formData.discount_value) <= 0)) {
      notification.error('Validation', 'Discount value must be greater than 0');
      return;
    }

    const payload = {
      name: formData.name.trim(),
      type: formData.type,
      discount_value: formData.type === 'free' ? 0 : Number(formData.discount_value),
      min_order_value: formData.min_order_value === '' ? 0 : Number(formData.min_order_value),
      states: parseStates(formData.states),
      start_date: formData.start_date ? new Date(formData.start_date).toISOString() : null,
      end_date: formData.end_date ? new Date(formData.end_date).toISOString() : null,
      is_active: formData.is_active,
    };

    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from('shipping_discounts')
          .update(payload)
          .eq('id', editingId);
        if (error) throw error;
        notification.success('Updated', 'Discount updated successfully');
      } else {
        const { error } = await supabase.from('shipping_discounts').insert(payload);
        if (error) throw error;
        notification.success('Created', 'Discount created successfully');
      }
      setFormOpen(false);
      resetForm();
      await loadDiscounts();
    } catch (err: any) {
      console.error('Save discount error', err);
      notification.error('Save failed', err?.message || 'Unable to save discount');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can manage discounts');
      return;
    }
    if (!confirm('Delete this discount?')) return;
    try {
      const { error } = await supabase.from('shipping_discounts').delete().eq('id', id);
      if (error) throw error;
      notification.success('Deleted', 'Discount removed');
      await loadDiscounts();
    } catch (err: any) {
      console.error('Delete discount error', err);
      notification.error('Delete failed', err?.message || 'Unable to delete discount');
    }
  };

  const toggleActive = async (discount: ShippingDiscount) => {
    if (!isAdmin) {
      notification.error('Not allowed', 'Only admins can manage discounts');
      return;
    }
    try {
      const { error } = await supabase
        .from('shipping_discounts')
        .update({ is_active: !discount.is_active })
        .eq('id', discount.id);
      if (error) throw error;
      notification.success('Updated', `Discount ${!discount.is_active ? 'activated' : 'deactivated'}`);
      await loadDiscounts();
    } catch (err: any) {
      console.error('Toggle discount error', err);
      notification.error('Update failed', err?.message || 'Unable to update discount');
    }
  };

  const renderStateBadges = (states?: string[] | null) => {
    if (!states || states.length === 0) return <span className="text-gray-500 text-sm">All states</span>;
    return (
      <div className="flex flex-wrap gap-2">
        {states.map((s) => (
          <span key={s} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">
            {s}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Shipping Discounts</h1>
          <p className="text-gray-600 mt-2">
            Configure free, flat, or percentage discounts. The best discount is auto-applied at checkout.
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary flex items-center">
            <Plus className="w-5 h-5 mr-2" />
            Add Discount
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : discounts.length === 0 ? (
        <div className="card text-center py-12">
          <Percent className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">No discounts configured yet.</p>
          {isAdmin && (
            <button onClick={openCreate} className="btn-primary">
              Create your first discount
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {discounts.map((discount) => (
            <div key={discount.id} className="card space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-primary-600" />
                    <h3 className="font-semibold text-gray-900">{discount.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{typeLabels[discount.type]}</p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    discount.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {discount.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${typeBadges[discount.type]}`}>
                  {discount.type}
                </span>
                {discount.type !== 'free' && (
                  <span className="text-sm text-gray-700">
                    {discount.type === 'flat' ? `- ₦${Number(discount.discount_value || 0).toLocaleString()}` : `- ${discount.discount_value || 0}%`}
                  </span>
                )}
              </div>

              <div className="text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Min order</span>
                  <span className="font-medium">
                    ₦{Number(discount.min_order_value || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>States</span>
                  <div className="text-right">{renderStateBadges(discount.states)}</div>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Start</span>
                  <span>{discount.start_date ? new Date(discount.start_date).toLocaleString() : 'Any'}</span>
                </div>
                <div className="flex justify-between">
                  <span>End</span>
                  <span>{discount.end_date ? new Date(discount.end_date).toLocaleString() : 'Any'}</span>
                </div>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 pt-2 border-t">
                  <button
                    onClick={() => toggleActive(discount)}
                    className="btn-secondary flex items-center justify-center gap-2 flex-1"
                  >
                    {discount.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {discount.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => openEdit(discount)}
                    className="btn-primary flex items-center justify-center gap-2 flex-1"
                  >
                    <Edit className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(discount.id)}
                    className="btn-orange flex items-center justify-center gap-2 flex-1"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full shadow-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingId ? 'Edit Discount' : 'Add Discount'}
                </h2>
                <p className="text-sm text-gray-600">The best discount is auto-applied during shipping calculation.</p>
              </div>
              <button onClick={() => { setFormOpen(false); resetForm(); }} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    required
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value as DiscountType }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="free">Free shipping</option>
                    <option value="flat">Flat amount off</option>
                    <option value="percent">Percentage off</option>
                  </select>
                </div>

                {formData.type !== 'free' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {formData.type === 'flat' ? 'Discount value (amount)' : 'Discount value (%)'} *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.discount_value}
                      onChange={(e) => setFormData((prev) => ({ ...prev, discount_value: Number(e.target.value) }))}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Minimum order value</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.min_order_value}
                    onChange={(e) => setFormData((prev) => ({ ...prev, min_order_value: Number(e.target.value) }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">States (comma separated)</label>
                  <input
                    type="text"
                    value={formData.states}
                    onChange={(e) => setFormData((prev) => ({ ...prev, states: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    placeholder="e.g. Lagos, Abuja"
                  />
                  <p className="text-xs text-gray-500 mt-1">Leave empty to apply to all states.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start date</label>
                  <input
                    type="datetime-local"
                    value={formData.start_date}
                    onChange={(e) => setFormData((prev) => ({ ...prev, start_date: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End date</label>
                  <input
                    type="datetime-local"
                    value={formData.end_date}
                    onChange={(e) => setFormData((prev) => ({ ...prev, end_date: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                </div>

                <div className="flex items-center mt-2">
                  <input
                    id="is_active"
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                    Active
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setFormOpen(false);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
