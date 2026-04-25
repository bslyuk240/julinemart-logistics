import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Store, Mail, Phone, MapPin, CreditCard,
  ShoppingBag, TrendingUp, Send, CheckCircle, XCircle,
  Edit2, Check, X, RefreshCw, ExternalLink, Power, PowerOff, Package,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface SubOrder {
  id: string;
  status: string;
  subtotal: number;
  allocated_shipping_fee: number;
  created_at: string;
  main_order: {
    id: string;
    order_number: number;
    customer_name: string;
    overall_status: string;
  } | null;
}

interface EarningSummary {
  total_orders: number;
  gross_sales: number;
  net_earnings: number;
  pending_orders: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  `₦${Number(n || 0).toLocaleString()}`;

/** WCFM/Woo often stores `vendors.address` as a JSON string; show readable lines in the UI. */
function formatJsonAddressToPlain(raw: string | null | undefined): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const t = String(raw).trim();
  if (!t.startsWith('{')) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const street1 = String(o.street_1 ?? '').trim();
    const street2 = String(o.street_2 ?? '').trim();
    const city = String(o.city ?? '').trim();
    const state = String(o.state ?? '').trim();
    const zip = String(o.zip ?? '').trim();
    const country = String(o.country ?? '').trim();
    const line1 = [street1, street2].filter(Boolean).join(', ');
    const line2 = [city, state, zip].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const lines = [line1, line2, country].filter(Boolean);
    return lines.length ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

const API = import.meta.env.VITE_API_URL || '';

async function callApi(path: string, body: object) {
  const token = await getToken();
  const res = await fetch(`${API}/.netlify/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Editable field component ─────────────────────────────────────────────────

function EditableField({
  label,
  value,
  onSave,
  type = 'text',
  mono = false,
  displayValue,
  multiline = false,
}: {
  label: string;
  value: string | null | undefined;
  onSave: (v: string) => Promise<void>;
  type?: string;
  mono?: boolean;
  /** When set, shown in read mode instead of raw `value` (e.g. formatted address). */
  displayValue?: string | null;
  /** Use textarea when editing; pre-line for read mode. */
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);

  const readShown =
    displayValue != null && String(displayValue).trim() !== ''
      ? displayValue
      : value;
  const editSeed =
    displayValue != null && String(displayValue).trim() !== ''
      ? String(displayValue)
      : value || '';

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <div>
        <p className="text-xs text-gray-400 mb-1">{label}</p>
        <div className="flex items-start gap-2">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              autoFocus
              className="flex-1 border border-purple-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-200 outline-none resize-y min-h-[5rem]"
            />
          ) : (
            <input
              type={type}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
              autoFocus
              className="flex-1 border border-purple-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-200 outline-none"
            />
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="p-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 shrink-0 self-start"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setDraft(editSeed);
            }}
            className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <div className={`flex gap-2 ${multiline ? 'items-start' : 'items-center'}`}>
        <p
          className={`text-sm font-medium text-gray-800 flex-1 min-w-0 ${mono ? 'font-mono' : ''} ${multiline ? 'whitespace-pre-line' : ''}`}
        >
          {readShown ? readShown : <span className="text-gray-400 italic">Not set</span>}
        </p>
        <button
          type="button"
          onClick={() => {
            setDraft(editSeed);
            setEditing(true);
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-purple-600 transition-opacity shrink-0"
        >
          <Edit2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  packed:     'bg-purple-100 text-purple-700',
  shipped:    'bg-indigo-100 text-indigo-700',
  delivered:  'bg-green-100 text-green-700',
  cancelled:  'bg-red-100 text-red-700',
};

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [vendor, setVendor]               = useState<Vendor | null>(null);
  const [subOrders, setSubOrders]         = useState<SubOrder[]>([]);
  const [summary, setSummary]             = useState<EarningSummary | null>(null);
  const [publishedProducts, setPublished] = useState<number>(0);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [saveMsg, setSaveMsg]             = useState('');

  const [inviting, setInviting]   = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteOk, setInviteOk]   = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [{ data: v }, { data: so }, { count: prodCount }] = await Promise.all([
      (supabase as any).from('vendors').select('*').eq('id', id).single(),
      (supabase as any)
        .from('sub_orders')
        .select('id, status, subtotal, allocated_shipping_fee, created_at, main_order:orders(id, order_number, customer_name, overall_status)')
        .eq('vendor_id', id)
        .order('created_at', { ascending: false })
        .limit(50),
      (supabase as any)
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('vendor_id', id)
        .eq('status', 'published'),
    ]);

    setPublished(prodCount || 0);

    setVendor(v || null);

    const orders: SubOrder[] = (so || []).map((s: any) => ({
      ...s,
      main_order: Array.isArray(s.main_order) ? s.main_order[0] : s.main_order,
    }));
    setSubOrders(orders);

    // Compute summary
    if (orders.length) {
      const rate = v?.commission_rate || 0;
      const gross = orders.reduce((sum: number, o: SubOrder) => sum + o.subtotal, 0);
      const net   = gross * (1 - rate / 100);
      setSummary({
        total_orders:   orders.length,
        gross_sales:    gross,
        net_earnings:   net,
        pending_orders: orders.filter((o: SubOrder) => o.status === 'pending').length,
      });
    } else {
      setSummary({ total_orders: 0, gross_sales: 0, net_earnings: 0, pending_orders: 0 });
    }

    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ── Save a single field ────────────────────────────────────────────────────
  const saveField = async (field: string, value: string) => {
    if (!id) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from('vendors')
      .update({ [field]: value || null })
      .eq('id', id);
    setSaving(false);
    if (!error) {
      setVendor(prev => prev ? { ...prev, [field]: value || null } : prev);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 2000);
    }
  };

  // ── Toggle active status ───────────────────────────────────────────────────
  const toggleActive = async () => {
    if (!vendor) return;
    const next = !vendor.is_active;
    await (supabase as any).from('vendors').update({ is_active: next }).eq('id', id);
    setVendor(prev => prev ? { ...prev, is_active: next } : prev);
  };

  // ── Send / resend invite ───────────────────────────────────────────────────
  const handleInvite = async () => {
    setInviting(true); setInviteMsg('');
    const res = await callApi('vendor-invite', { vendor_id: id });
    setInviteMsg(res.message || res.error || 'Unknown error');
    setInviteOk(!!res.success);
    setInviting(false);
    if (res.success) load();
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-96">
      <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!vendor) return (
    <div className="p-6 text-center text-gray-400">Vendor not found.</div>
  );

  const streetPlain = formatJsonAddressToPlain(vendor.address);

  const deactivateLabel = vendor.is_active ? 'Deactivate vendor (hide from storefront)' : 'Activate vendor (visible on storefront)';
  const inviteLabel = vendor.user_id
    ? 'Resend vendor portal invite email'
    : 'Send vendor portal invite email';

  return (
    <div className="w-full max-w-none px-1 sm:px-0">

      {/* Back + identity + actions — stacked on mobile so header never overflows */}
      <div className="mb-6 space-y-3">
        <div className="flex items-start gap-2 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/admin/vendors')}
            className="shrink-0 mt-0.5 p-1.5 sm:p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            title="Back to vendors"
            aria-label="Back to vendors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
            {vendor.logo_url ? (
              <img
                src={vendor.logo_url}
                alt=""
                className="w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-full object-cover border-2 border-purple-100 shadow-sm"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <div className="w-11 h-11 sm:w-14 sm:h-14 shrink-0 rounded-full bg-purple-100 flex items-center justify-center">
                <Store className="w-5 h-5 sm:w-7 sm:h-7 text-purple-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 leading-snug break-words">
                {vendor.store_name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                <span
                  className={`text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full font-medium shrink-0 ${
                    vendor.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {vendor.is_active ? 'Active' : 'Inactive'}
                </span>
                {vendor.user_id ? (
                  <span className="text-[10px] sm:text-xs flex items-center gap-0.5 text-green-600 min-w-0">
                    <CheckCircle className="w-3 h-3 shrink-0" />
                    <span className="truncate">Portal linked</span>
                  </span>
                ) : (
                  <span className="text-[10px] sm:text-xs flex items-center gap-0.5 text-gray-400 min-w-0">
                    <XCircle className="w-3 h-3 shrink-0" />
                    <span className="sm:hidden">No portal</span>
                    <span className="hidden sm:inline">No portal account</span>
                  </span>
                )}
                {vendor.woocommerce_vendor_id && (
                  <span className="text-[10px] sm:text-xs text-gray-400 shrink-0">
                    WP #{vendor.woocommerce_vendor_id}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 pt-1 border-t border-gray-100 sm:border-0 sm:pt-0">
          {saveMsg && (
            <span className="text-[10px] sm:text-xs text-green-600 mr-auto sm:mr-0">{saveMsg}</span>
          )}
          <button
            type="button"
            onClick={toggleActive}
            title={deactivateLabel}
            aria-label={deactivateLabel}
            className={`inline-flex h-9 w-9 sm:h-8 sm:w-auto sm:min-h-0 sm:px-2.5 sm:py-1.5 items-center justify-center rounded-lg border transition touch-manipulation ${
              vendor.is_active
                ? 'border-red-200 text-red-600 hover:bg-red-50 active:bg-red-100'
                : 'border-green-200 text-green-600 hover:bg-green-50 active:bg-green-100'
            }`}
          >
            {vendor.is_active ? (
              <PowerOff className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            ) : (
              <Power className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            )}
            <span className="hidden sm:inline text-xs font-medium ml-1.5">
              {vendor.is_active ? 'Deactivate' : 'Activate'}
            </span>
          </button>
          <button
            type="button"
            onClick={handleInvite}
            disabled={inviting}
            title={inviteLabel}
            aria-label={inviteLabel}
            className="inline-flex h-9 w-9 sm:h-8 sm:w-auto sm:min-h-0 sm:px-2.5 sm:py-1.5 items-center justify-center rounded-lg bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition touch-manipulation"
          >
            {inviting ? (
              <RefreshCw className="w-4 h-4 sm:w-3.5 sm:h-3.5 animate-spin shrink-0" />
            ) : (
              <Send className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
            )}
            <span className="hidden sm:inline text-xs font-medium ml-1.5">
              {vendor.user_id ? 'Resend' : 'Invite'}
            </span>
          </button>
        </div>
      </div>

      {inviteMsg && (
        <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm ${inviteOk ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {inviteMsg}
        </div>
      )}

      {/* Banner */}
      {vendor.banner_url && (
        <div className="rounded-2xl overflow-hidden h-32 mb-6 bg-gray-100">
          <img src={vendor.banner_url} alt="" className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
        </div>
      )}

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Total Orders',       value: summary.total_orders,    icon: ShoppingBag, color: 'bg-blue-50 text-blue-600' },
            { label: 'Pending',            value: summary.pending_orders,  icon: RefreshCw,   color: 'bg-yellow-50 text-yellow-600' },
            { label: 'Published Products', value: publishedProducts,       icon: Package,     color: 'bg-indigo-50 text-indigo-600' },
            { label: 'Gross Sales',        value: fmt(summary.gross_sales), icon: TrendingUp, color: 'bg-purple-50 text-purple-600' },
            { label: 'Net Earnings',       value: fmt(summary.net_earnings), icon: TrendingUp, color: 'bg-green-50 text-green-600' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color}`}>
                <s.icon className="w-4 h-4" />
              </div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

        {/* Store info */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Store className="w-4 h-4 text-purple-500" />
            <h2 className="font-semibold text-gray-900">Store Info</h2>
          </div>
          <div className="space-y-4">
            <EditableField label="Store Name"      value={vendor.store_name}    onSave={v => saveField('store_name', v)} />
            <EditableField label="Email"            value={vendor.email}         onSave={v => saveField('email', v)} type="email" />
            <EditableField label="Phone"            value={vendor.phone}         onSave={v => saveField('phone', v)} type="tel" />
            <EditableField
              label="Commission Rate (%)"
              value={String(vendor.commission_rate ?? 0)}
              type="number"
              onSave={async v => {
                await saveField('commission_rate', v);
                setVendor(prev => prev ? { ...prev, commission_rate: Number(v) } : prev);
              }}
            />
            <EditableField label="Description"     value={vendor.description}   onSave={v => saveField('description', v)} />
          </div>
        </div>

        {/* Address */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="w-4 h-4 text-purple-500" />
            <h2 className="font-semibold text-gray-900">Address</h2>
          </div>
          <div className="space-y-4">
            <EditableField
              label="Street Address"
              value={vendor.address}
              displayValue={streetPlain ?? undefined}
              multiline={!!streetPlain || /\r?\n/.test(vendor.address || '')}
              onSave={(v) => saveField('address', v)}
            />
            <EditableField label="City"             value={vendor.city}          onSave={v => saveField('city', v)} />
            <EditableField label="State"            value={vendor.state}         onSave={v => saveField('state', v)} />
          </div>

          <div className="flex items-center gap-2 mb-4 mt-6">
            <CreditCard className="w-4 h-4 text-purple-500" />
            <h2 className="font-semibold text-gray-900">Bank Details</h2>
          </div>
          <div className="space-y-4">
            <EditableField label="Bank Name"            value={vendor.bank_name}           onSave={v => saveField('bank_name', v)} />
            <EditableField label="Account Number"       value={vendor.bank_account_number} onSave={v => saveField('bank_account_number', v)} mono />
            <EditableField label="Account Name"         value={vendor.bank_account_name}   onSave={v => saveField('bank_account_name', v)} />
          </div>
        </div>

        {/* Media URLs */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-4 h-4 text-purple-500" />
            <h2 className="font-semibold text-gray-900">Media</h2>
          </div>
          <div className="space-y-4">
            <EditableField label="Logo URL"    value={vendor.logo_url}   onSave={v => saveField('logo_url', v)} />
            {vendor.logo_url && (
              <img src={vendor.logo_url} alt="" className="w-12 h-12 rounded-full object-cover border" onError={e => (e.currentTarget.style.display = 'none')} />
            )}
            <EditableField label="Banner URL"  value={vendor.banner_url} onSave={v => saveField('banner_url', v)} />
            {vendor.banner_url && (
              <img src={vendor.banner_url} alt="" className="w-full h-20 object-cover rounded-xl border" onError={e => (e.currentTarget.style.display = 'none')} />
            )}
          </div>
        </div>

        {/* Portal account */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-4 h-4 text-purple-500" />
            <h2 className="font-semibold text-gray-900">Portal Account</h2>
          </div>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Auth User ID</p>
              <p className="font-mono text-xs text-gray-600 break-all">{vendor.user_id || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">WooCommerce Vendor ID</p>
              <p className="font-mono text-xs text-gray-600">{vendor.woocommerce_vendor_id || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Joined</p>
              <p className="text-gray-800">{new Date(vendor.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Store Slug</p>
              <p className="font-mono text-xs text-gray-600">{vendor.store_slug || '—'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Order history */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 flex items-center gap-2">
          <ShoppingBag className="w-4 h-4 text-purple-500" />
          <h2 className="font-semibold text-gray-900">Order History</h2>
          <span className="ml-auto text-xs text-gray-400">{subOrders.length} sub-orders</span>
        </div>

        {subOrders.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No orders yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">Order #</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {subOrders.map(o => {
                const net = o.subtotal * (1 - (vendor.commission_rate || 0) / 100);
                return (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      #{o.main_order?.order_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {o.main_order?.customer_name || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-600'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(o.subtotal)}</td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">{fmt(net)}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(o.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/admin/orders/${o.main_order?.id || o.id}`}
                        className="text-xs text-purple-600 hover:underline flex items-center gap-0.5"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
