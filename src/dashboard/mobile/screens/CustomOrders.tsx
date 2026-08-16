import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, ChevronRight, ImageIcon, Loader, MessageSquare, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import {
  CUSTOM_ORDER_STATUS_LABELS,
  type CustomFieldDefinition,
  type CustomOrderStatus,
} from '../../../types/custom-order';

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

export default function MobileCustomOrders() {
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
    <>
      <PullToRefresh onRefresh={loadSpecs}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary-600" />
              <h1 className="text-lg font-bold text-gray-900">Custom Orders</h1>
            </div>
            <select
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
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
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : specs.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <Sparkles className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No custom orders for this filter</p>
              </div>
            ) : (
              specs.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold text-gray-900">
                        #{s.orders?.order_number ?? '—'}
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[s.status]}`}>
                        {CUSTOM_ORDER_STATUS_LABELS[s.status]}
                      </span>
                    </div>
                    <p className="truncate text-xs text-gray-500">{s.order_items?.product_name ?? '—'}</p>
                    <p className="text-xs text-gray-400">
                      {s.orders?.customer_name ?? '—'}
                      {s.order_items?.vendors?.store_name ? ` · ${s.order_items.vendors.store_name}` : ''}
                      {s.message_count ? ` · ${s.message_count} msg` : ''}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        ariaLabel="Custom order details"
      >
        {detailLoading || !detail ? (
          <div className="flex justify-center py-16">
            <Loader className="h-7 w-7 animate-spin text-primary-600" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-gray-900">
                  Order #{detail.orders?.order_number ?? '—'}
                </h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[detail.status]}`}>
                  {CUSTOM_ORDER_STATUS_LABELS[detail.status]}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {detail.orders?.customer_name} · {detail.orders?.customer_email}
              </p>
              <p className="text-xs text-gray-500">Vendor: {detail.order_items?.vendors?.store_name ?? '—'}</p>
            </div>

            <div className="space-y-1.5 rounded-2xl bg-gray-50 p-3.5 text-sm ring-1 ring-gray-100">
              <p className="font-medium text-gray-800">{detail.order_items?.product_name}</p>
              <p className="text-gray-600">
                Qty {detail.order_items?.quantity} · Unit {formatNaira(detail.order_items?.unit_price || 0)}
                {detail.price_adjustment ? ` (+${formatNaira(detail.price_adjustment)} customisation)` : ''}
              </p>
              {Object.keys(detail.field_values || {}).length > 0 && (
                <div className="space-y-1 border-t border-gray-200 pt-2">
                  {Object.entries(detail.field_values).map(([key, value]) => (
                    <p key={key} className="text-xs text-gray-700">
                      <span className="text-gray-500">{fieldLabels.get(key)?.label || key}:</span> {String(value)}
                    </p>
                  ))}
                </div>
              )}
              {detail.approved_proof_url && (
                <a
                  href={detail.approved_proof_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 pt-1 text-xs text-primary-600 underline"
                >
                  <ImageIcon className="h-3.5 w-3.5" /> View proof
                </a>
              )}
            </div>

            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                <MessageSquare className="h-3.5 w-3.5" /> Messages
              </p>
              <div className="max-h-40 space-y-2 overflow-y-auto pr-1">
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
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Message vendor & customer…"
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy || !messageDraft.trim()}
                  onClick={sendMessage}
                  className="shrink-0 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>

            <div className="space-y-2 border-t border-gray-100 pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Admin actions</p>
              <textarea
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                placeholder="Optional note posted to the thread with the action below"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <select
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
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
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-700 disabled:opacity-50"
              >
                <Ban className="h-4 w-4" />
                Cancel order
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
