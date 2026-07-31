import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  ChevronRight,
  Loader,
  Package,
  Power,
  PowerOff,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { supabase } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { DetailRow, SectionLabel } from '../components/MobileDetailParts';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { formatJsonAddressToPlain, vendorPost } from '../lib/vendorApi';

interface Vendor {
  id: string;
  store_name: string;
  store_slug: string;
  email: string;
  phone: string | null;
  commission_rate: number;
  is_active: boolean;
  user_id: string | null;
  woocommerce_vendor_id: string | null;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  created_at: string;
}

interface OrderItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

interface SubOrder {
  id: string;
  status: string;
  subtotal: number;
  created_at: string;
  main_order: {
    id: string;
    order_number: number;
    customer_name: string;
    order_items: OrderItem[];
  } | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  packed: 'bg-purple-100 text-purple-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

type EditField = {
  key: string;
  label: string;
  value: string;
  multiline?: boolean;
};

export default function MobileVendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notification = useNotification();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [subOrders, setSubOrders] = useState<SubOrder[]>([]);
  const [publishedProducts, setPublishedProducts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editField, setEditField] = useState<EditField | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: v }, { data: so }, { count }] = await Promise.all([
      (supabase as any).from('vendors').select('*').eq('id', id).single(),
      (supabase as any)
        .from('sub_orders')
        .select(
          'id, status, subtotal, created_at, main_order:orders(id, order_number, customer_name, order_items(id, product_name, quantity, unit_price))',
        )
        .eq('vendor_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      (supabase as any)
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('vendor_id', id)
        .eq('status', 'published'),
    ]);
    setVendor(v || null);
    setPublishedProducts(count || 0);
    setSubOrders(
      (so || []).map((s: SubOrder & { main_order: unknown }) => ({
        ...s,
        main_order: Array.isArray(s.main_order) ? s.main_order[0] : s.main_order,
      })),
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const gross = subOrders.reduce((s, o) => s + o.subtotal, 0);
  const rate = vendor?.commission_rate || 0;
  const net = gross * (1 - rate / 100);

  const saveField = async () => {
    if (!id || !editField) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from('vendors')
      .update({ [editField.key]: editDraft.trim() || null })
      .eq('id', id);
    setSaving(false);
    if (error) {
      notification.error('Save failed', error.message);
    } else {
      setVendor((prev) => (prev ? { ...prev, [editField.key]: editDraft.trim() || null } : prev));
      setEditField(null);
      notification.success('Saved', `${editField.label} updated`);
    }
  };

  const toggleActive = async () => {
    if (!vendor || !id) return;
    const next = !vendor.is_active;
    await (supabase as any).from('vendors').update({ is_active: next }).eq('id', id);
    setVendor((prev) => (prev ? { ...prev, is_active: next } : prev));
    notification.success(next ? 'Activated' : 'Deactivated', vendor.store_name);
  };

  const handleInvite = async () => {
    if (!id) return;
    setInviting(true);
    const res = await vendorPost<{ success?: boolean; message?: string; error?: string }>('vendor-invite', {
      vendor_id: id,
    });
    setInviting(false);
    if (res.success) {
      notification.success('Invite sent', res.message || 'Invite sent');
      load();
    } else {
      notification.error('Invite failed', res.message || res.error || 'Unable to send invite');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const res = await vendorPost<{ success?: boolean; error?: string }>('vendor-delete', { vendor_id: id });
    if (res.success) {
      navigate('/admin/vendors');
    } else {
      notification.error('Delete failed', res.error || 'Unable to delete vendor');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const openEdit = (key: string, label: string, value: string | null | undefined, multiline = false) => {
    setEditField({ key, label, value: value || '', multiline });
    setEditDraft(value || '');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!vendor) {
    return <div className="p-4 text-center text-sm text-gray-500">Vendor not found.</div>;
  }

  const streetPlain = formatJsonAddressToPlain(vendor.address);
  const addressDisplay = streetPlain || vendor.address;

  const fields: { section: string; items: { key: string; label: string; value: string | null | undefined; multiline?: boolean }[] }[] = [
    {
      section: 'Store',
      items: [
        { key: 'store_name', label: 'Store name', value: vendor.store_name },
        { key: 'email', label: 'Email', value: vendor.email },
        { key: 'phone', label: 'Phone', value: vendor.phone },
        { key: 'commission_rate', label: 'Commission %', value: String(vendor.commission_rate ?? 0) },
        { key: 'description', label: 'Description', value: vendor.description, multiline: true },
      ],
    },
    {
      section: 'Address',
      items: [
        { key: 'address', label: 'Street', value: addressDisplay, multiline: true },
        { key: 'city', label: 'City', value: vendor.city },
        { key: 'state', label: 'State', value: vendor.state },
      ],
    },
    {
      section: 'Bank',
      items: [
        { key: 'bank_name', label: 'Bank name', value: vendor.bank_name },
        { key: 'bank_account_number', label: 'Account number', value: vendor.bank_account_number },
        { key: 'bank_account_name', label: 'Account name', value: vendor.bank_account_name },
      ],
    },
  ];

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/admin/vendors')} className="rounded-lg p-2 text-gray-500">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-bold text-gray-900">{vendor.store_name}</h1>
              <div className="mt-0.5 flex flex-wrap gap-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    vendor.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {vendor.is_active ? 'Active' : 'Inactive'}
                </span>
                {vendor.user_id ? (
                  <span className="flex items-center gap-0.5 rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-700">
                    <CheckCircle className="h-3 w-3" /> Portal
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] text-gray-400">
                    <XCircle className="h-3 w-3" /> No portal
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Orders</p>
              <p className="text-lg font-bold">{subOrders.length}</p>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Products</p>
              <p className="text-lg font-bold">{publishedProducts}</p>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Gross</p>
              <p className="text-sm font-bold">{formatNaira(gross)}</p>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
              <p className="text-[10px] uppercase text-gray-400">Net</p>
              <p className="text-sm font-bold text-green-700">{formatNaira(net)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void toggleActive()}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-2.5 text-xs font-semibold"
            >
              {vendor.is_active ? <PowerOff className="h-3.5 w-3.5 text-red-600" /> : <Power className="h-3.5 w-3.5 text-green-600" />}
              {vendor.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              type="button"
              disabled={inviting}
              onClick={() => void handleInvite()}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary-600 py-2.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {inviting ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {vendor.user_id ? 'Resend invite' : 'Send invite'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center justify-center rounded-lg border border-red-200 px-3 py-2.5 text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {fields.map(({ section, items }) => (
            <div key={section}>
              <SectionLabel>{section}</SectionLabel>
              <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white ring-1 ring-gray-100">
                {items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => openEdit(item.key, item.label, item.value, item.multiline)}
                    className="flex w-full items-center justify-between px-3 py-3 text-left active:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="text-[10px] uppercase text-gray-400">{item.label}</p>
                      <p className={`text-sm text-gray-900 ${item.multiline ? 'whitespace-pre-line' : 'truncate'}`}>
                        {item.value || '—'}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div>
            <SectionLabel>Portal</SectionLabel>
            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-white ring-1 ring-gray-100">
              <DetailRow label="Woo vendor ID" value={vendor.woocommerce_vendor_id || '—'} mono />
              <DetailRow label="Auth user" value={vendor.user_id || '—'} mono />
              <DetailRow label="Joined" value={new Date(vendor.created_at).toLocaleDateString()} />
            </div>
          </div>

          <div>
            <SectionLabel>{subOrders.length} recent orders</SectionLabel>
            {subOrders.length === 0 ? (
              <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No orders yet.</div>
            ) : (
              <div className="space-y-2">
                {subOrders.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => o.main_order?.id && navigate(`/admin/orders/${o.main_order.id}`)}
                    className="w-full rounded-xl bg-white p-3 text-left ring-1 ring-gray-100 active:bg-gray-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          #{o.main_order?.order_number || '—'} · {o.main_order?.customer_name || 'Customer'}
                        </p>
                        <p className="text-xs text-gray-500">{new Date(o.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatNaira(o.subtotal)}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>
                          {o.status}
                        </span>
                      </div>
                    </div>
                    {(o.main_order?.order_items?.length ?? 0) > 0 && (
                      <p className="mt-1 truncate text-xs text-gray-500">
                        <Package className="mr-1 inline h-3 w-3" />
                        {o.main_order!.order_items.map((i) => i.product_name).join(', ')}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!editField} onClose={() => setEditField(null)} ariaLabel="Edit field">
        {editField && (
          <>
            <h3 className="text-base font-bold">{editField.label}</h3>
            {editField.multiline ? (
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
            ) : (
              <input
                type="text"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
            )}
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveField()}
              className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} ariaLabel="Confirm delete">
        <h3 className="text-base font-bold text-red-700">Delete {vendor.store_name}?</h3>
        <p className="text-sm text-gray-600">
          This permanently deletes the vendor, products, earnings, and portal account. Order history is preserved.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleDelete()}
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Sheet>
    </>
  );
}
