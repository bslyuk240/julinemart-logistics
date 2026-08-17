import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, MessageSquare, Ban, ImageIcon, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import {
  CUSTOM_ORDER_STATUS_LABELS,
  type CustomFieldDefinition,
  type CustomOrderStatus,
} from '../../types/custom-order';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

const STATUS_OPTIONS: CustomOrderStatus[] = [
  'submitted',
  'seller_reviewing',
  'seller_confirmed',
  'proof_sent',
  'customer_approved',
  'in_production',
  'quality_check',
  'ready',
  'dispatched',
  'delivered',
  'cancelled',
];

const STATUS_BADGE: Record<CustomOrderStatus, string> = {
  submitted: 'bg-gray-100 text-gray-700',
  seller_reviewing: 'bg-amber-100 text-amber-700',
  seller_confirmed: 'bg-blue-100 text-blue-700',
  proof_sent: 'bg-purple-100 text-purple-700',
  customer_approved: 'bg-indigo-100 text-indigo-700',
  in_production: 'bg-orange-100 text-orange-700',
  quality_check: 'bg-teal-100 text-teal-700',
  ready: 'bg-emerald-100 text-emerald-700',
  dispatched: 'bg-cyan-100 text-cyan-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

type Spec = {
  id: string;
  order_id: string;
  order_item_id: string | null;
  schema_id: string | null;
  field_values: Record<string, unknown>;
  price_adjustment: number;
  status: CustomOrderStatus;
  approved_proof_url?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
  message_count?: number;
  orders?: {
    id: string;
    order_number: string | number;
    customer_name: string;
    customer_email: string;
    overall_status: string;
    created_at: string;
  } | null;
  order_items?: {
    id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    vendor_id: string | null;
    vendors?: { id: string; store_name: string } | null;
  } | null;
};

type Message = {
  id: string;
  sender_type: 'customer' | 'vendor' | 'admin';
  message: string;
  created_at: string;
};

type SpecDetail = Spec & {
  messages: Message[];
  product_customisation_schemas?: { fields?: CustomFieldDefinition[] } | null;
};

function formatNaira(n: number) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

export default function CustomOrdersPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | CustomOrderStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SpecDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const authHeaders = useCallback(() => {
    if (!session?.access_token) return null;
    return {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    };
  }, [session?.access_token]);

  const loadSpecs = useCallback(async () => {
    const headers = authHeaders();
    if (!headers) return;
    setLoading(true);
    try {
      const url =
        statusFilter === 'all'
          ? `${functionsBase}/admin-custom-orders`
          : `${functionsBase}/admin-custom-orders?status=${statusFilter}`;
      const res = await fetch(url, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load custom orders');
      setSpecs(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load custom orders');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, notification, statusFilter]);

  useEffect(() => {
    loadSpecs();
  }, [loadSpecs]);

  const loadDetail = useCallback(
    async (id: string) => {
      const headers = authHeaders();
      if (!headers) return;
      setDetailLoading(true);
      try {
        const res = await fetch(`${functionsBase}/admin-custom-orders?id=${encodeURIComponent(id)}`, {
          headers,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load custom order');
        setDetail(json.data);
      } catch (err) {
        notification.error(err instanceof Error ? err.message : 'Failed to load custom order');
      } finally {
        setDetailLoading(false);
      }
    },
    [authHeaders, notification]
  );

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const fieldLabels = useMemo(() => {
    const map = new Map<string, CustomFieldDefinition>();
    for (const f of detail?.product_customisation_schemas?.fields || []) map.set(f.id, f);
    return map;
  }, [detail]);

  const setStatus = async (status: CustomOrderStatus) => {
    if (!selectedId) return;
    const headers = authHeaders();
    if (!headers) return;
    setBusy(true);
    try {
      const res = await fetch(`${functionsBase}/admin-custom-orders?id=${selectedId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'set_status', status, note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success('Status updated');
      setNote('');
      await Promise.all([loadDetail(selectedId), loadSpecs()]);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    if (!selectedId) return;
    if (!confirm('Cancel this custom order? This cannot be undone by the vendor or customer.')) return;
    const headers = authHeaders();
    if (!headers) return;
    setBusy(true);
    try {
      const res = await fetch(`${functionsBase}/admin-custom-orders?id=${selectedId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action: 'cancel', note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      notification.success('Custom order cancelled');
      setNote('');
      await Promise.all([loadDetail(selectedId), loadSpecs()]);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    if (!selectedId || !messageDraft.trim()) return;
    const headers = authHeaders();
    if (!headers) return;
    setBusy(true);
    try {
      const res = await fetch(`${functionsBase}/admin-custom-orders?id=${selectedId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: messageDraft.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setMessageDraft('');
      await loadDetail(selectedId);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="flex items-center gap-3 mb-6">
        <Sparkles className="w-8 h-8 text-primary-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Custom orders</h1>
          <p className="text-sm text-gray-600">
            Oversight for vendor↔customer customised item orders — this is the only admin view into them.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <select
            className="appearance-none rounded-lg border border-gray-200 bg-white pl-3 pr-8 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {CUSTOM_ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-gray-400" />
        </div>
        <p className="text-xs text-gray-500">{specs.length} custom order(s)</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4">
        <div className="card overflow-x-auto">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
          ) : specs.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No custom orders for this filter.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Vendor</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Msgs</th>
                </tr>
              </thead>
              <tbody>
                {specs.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={`cursor-pointer border-b last:border-0 hover:bg-gray-50 ${
                      selectedId === s.id ? 'bg-primary-50' : ''
                    }`}
                  >
                    <td className="py-2.5 pr-3 font-medium text-gray-900">
                      #{s.orders?.order_number ?? '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700">{s.order_items?.product_name ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-gray-700">
                      {s.order_items?.vendors?.store_name ?? '—'}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-700">{s.orders?.customer_name ?? '—'}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[s.status]}`}>
                        {CUSTOM_ORDER_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-gray-500">
                      {s.message_count ? (
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" />
                          {s.message_count}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          {!selectedId ? (
            <p className="text-sm text-gray-500 py-8 text-center">Select a custom order to view details.</p>
          ) : detailLoading || !detail ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">
                    Order #{detail.orders?.order_number ?? '—'}
                  </h2>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[detail.status]}`}>
                    {CUSTOM_ORDER_STATUS_LABELS[detail.status]}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {detail.orders?.customer_name} · {detail.orders?.customer_email}
                </p>
                <p className="text-xs text-gray-500">
                  Vendor: {detail.order_items?.vendors?.store_name ?? '—'}
                </p>
              </div>

              <div className="rounded-lg bg-gray-50 p-3 space-y-1.5 text-sm">
                <p className="font-medium text-gray-800">{detail.order_items?.product_name}</p>
                <p className="text-gray-600">
                  Qty {detail.order_items?.quantity} · Unit {formatNaira(detail.order_items?.unit_price || 0)}
                  {detail.price_adjustment ? ` (+${formatNaira(detail.price_adjustment)} customisation)` : ''}
                </p>
                {Object.keys(detail.field_values || {}).length > 0 && (
                  <div className="pt-2 border-t border-gray-200 space-y-1">
                    {Object.entries(detail.field_values).map(([key, value]) => (
                      <p key={key} className="text-xs text-gray-700">
                        <span className="text-gray-500">{fieldLabels.get(key)?.label || key}:</span>{' '}
                        {String(value)}
                      </p>
                    ))}
                  </div>
                )}
                {detail.approved_proof_url && (
                  <a
                    href={detail.approved_proof_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary-600 underline pt-1"
                  >
                    <ImageIcon className="w-3.5 h-3.5" /> View proof
                  </a>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Messages</p>
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {detail.messages.length === 0 ? (
                    <p className="text-xs text-gray-400">No messages yet.</p>
                  ) : (
                    detail.messages.map((m) => (
                      <div key={m.id} className="text-xs">
                        <span
                          className={`font-medium ${
                            m.sender_type === 'admin'
                              ? 'text-purple-700'
                              : m.sender_type === 'vendor'
                              ? 'text-blue-700'
                              : 'text-gray-700'
                          }`}
                        >
                          {m.sender_type}:
                        </span>{' '}
                        <span className="text-gray-700">{m.message}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    placeholder="Message vendor & customer…"
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !messageDraft.trim()}
                    onClick={sendMessage}
                    className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>

              <div className="border-t pt-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Admin actions</p>
                <textarea
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                  placeholder="Optional note posted to the thread with the action below"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                    value=""
                    disabled={busy}
                    onChange={(e) => {
                      if (e.target.value) setStatus(e.target.value as CustomOrderStatus);
                    }}
                  >
                    <option value="">Force status…</option>
                    {STATUS_OPTIONS.filter((s) => s !== 'cancelled').map((s) => (
                      <option key={s} value={s}>
                        {CUSTOM_ORDER_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || detail.status === 'cancelled'}
                    onClick={cancelOrder}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Cancel order
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
