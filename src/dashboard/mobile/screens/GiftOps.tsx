import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Gift,
  Loader,
  Package,
  Printer,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsBase } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';

type Tab = 'new' | 'packing' | 'dispatch' | 'done';

type GiftHub = { id: string; name: string; code: string; is_default: boolean };

type GiftOpsOrder = {
  id: string;
  gift_status: string;
  recipient_name: string;
  recipient_city: string;
  recipient_state: string;
  gift_message?: string | null;
  sender_visible: boolean;
  occasion?: string | null;
  pack_photo_url?: string | null;
  qc_notes?: string | null;
  gift_boxes?: { name: string; slug: string } | null;
  gift_fulfilment_centres?: { name: string; code: string } | null;
  gift_packaging_types?: { code: string; name: string; description?: string | null } | null;
  orders?: {
    order_number: string | number;
    customer_name: string;
    payment_status: string;
    total_amount: number;
  } | null;
};

type GiftOpsDetail = GiftOpsOrder & {
  events?: { status: string; note?: string; created_at: string }[];
  packing_checklist?: { name: string; quantity: number }[];
};

const TABS: { id: Tab; label: string; icon: typeof Gift }[] = [
  { id: 'new', label: 'New', icon: Gift },
  { id: 'packing', label: 'Packing', icon: Package },
  { id: 'dispatch', label: 'Dispatch', icon: Truck },
  { id: 'done', label: 'Done', icon: CheckCircle2 },
];

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-900 outline-none focus:border-primary-500 focus:bg-white';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

function statusChip(status: string) {
  const map: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800',
    paid: 'bg-emerald-100 text-emerald-800',
    packing: 'bg-amber-100 text-amber-800',
    packed: 'bg-violet-100 text-violet-800',
    dispatch: 'bg-indigo-100 text-indigo-800',
    delivered: 'bg-green-100 text-green-800',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
}

export default function MobileGiftOps() {
  const { session } = useAuth();
  const notification = useNotification();
  const [tab, setTab] = useState<Tab>('new');
  const [hubs, setHubs] = useState<GiftHub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState('');
  const [orders, setOrders] = useState<GiftOpsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<GiftOpsOrder | null>(null);
  const [detail, setDetail] = useState<GiftOpsDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [packPhotoUrl, setPackPhotoUrl] = useState('');
  const [qcNotes, setQcNotes] = useState('');

  const authHeaders = useCallback(() => {
    if (!session?.access_token) return null;
    return {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    };
  }, [session?.access_token]);

  useEffect(() => {
    const headers = authHeaders();
    if (!headers) return;
    fetch(`${functionsBase}/admin-gift-fulfilment-centres`, { headers })
      .then((r) => r.json())
      .then((json) => {
        const list: GiftHub[] = json.data || [];
        setHubs(list);
        if (list.length) {
          const def = list.find((h) => h.is_default) || list[0];
          setSelectedHubId(def.id);
        }
      })
      .catch(() => notification.error('Failed to load hubs'));
  }, [authHeaders, notification]);

  const loadQueue = useCallback(async () => {
    const headers = authHeaders();
    if (!headers || !selectedHubId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${functionsBase}/admin-gift-ops?tab=${tab}&gfc_id=${encodeURIComponent(selectedHubId)}`,
        { headers },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load queue');
      setOrders(json.data || []);
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, notification, selectedHubId, tab]);

  const loadDetail = useCallback(
    async (id: string) => {
      const headers = authHeaders();
      if (!headers) return;
      setDetailLoading(true);
      try {
        const res = await fetch(`${functionsBase}/admin-gift-ops?id=${encodeURIComponent(id)}`, { headers });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load detail');
        setDetail(json.data);
        setPackPhotoUrl(json.data?.pack_photo_url || '');
        setQcNotes(json.data?.qc_notes || '');
      } catch (err) {
        notification.error(err instanceof Error ? err.message : 'Failed to load detail');
      } finally {
        setDetailLoading(false);
      }
    },
    [authHeaders, notification],
  );

  useEffect(() => {
    if (selectedHubId) loadQueue();
  }, [selectedHubId, tab, loadQueue]);

  useEffect(() => {
    if (selectedOrder) loadDetail(selectedOrder.id);
    else setDetail(null);
  }, [selectedOrder, loadDetail]);

  const refresh = async () => {
    await loadQueue();
    if (selectedOrder) await loadDetail(selectedOrder.id);
  };

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    const headers = authHeaders();
    if (!headers || !selectedOrder) return;
    setActioning(true);
    try {
      const res = await fetch(`${functionsBase}/admin-gift-ops?id=${encodeURIComponent(selectedOrder.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Action failed');
      notification.success('Updated');
      setDetail(json.data);
      await loadQueue();
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActioning(false);
    }
  };

  const printCard = async () => {
    const headers = authHeaders();
    if (!headers || !selectedOrder) return;
    try {
      const res = await fetch(
        `${functionsBase}/gift-message-card?gift_order_id=${encodeURIComponent(selectedOrder.id)}`,
        { headers },
      );
      const html = await res.text();
      if (!res.ok) throw new Error('Could not load card');
      const w = window.open('', '_blank', 'width=480,height=640');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } catch (err) {
      notification.error(err instanceof Error ? err.message : 'Print failed');
    }
  };

  const openOrder = (order: GiftOpsOrder) => setSelectedOrder(order);

  return (
    <>
      <PullToRefresh onRefresh={refresh}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <Gift className="h-5 w-5 text-primary-600" />
                <h1 className="text-lg font-bold text-gray-900">Gift Ops</h1>
              </div>
              <p className="text-xs text-gray-500">Pack, QC & dispatch at the hub</p>
            </div>

            <Field label="Hub">
              <select
                value={selectedHubId}
                onChange={(e) => {
                  setSelectedHubId(e.target.value);
                  setSelectedOrder(null);
                }}
                className={inputCls}
              >
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="mt-3 flex gap-1.5 overflow-x-auto scrollbar-none -mx-1 px-1 pb-1">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTab(id);
                    setSelectedOrder(null);
                  }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold ${
                    tab === id ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <Package className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-sm text-gray-500">No orders in this queue.</p>
              </div>
            ) : (
              orders.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => openOrder(o)}
                  className="flex w-full flex-col gap-1 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm text-gray-900">
                      #{o.orders?.order_number} · {o.gift_boxes?.name || 'Custom box'}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusChip(o.gift_status)}`}>
                      {o.gift_status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    To {o.recipient_name} · {o.recipient_city}
                    {o.gift_packaging_types ? ` · ${o.gift_packaging_types.name}` : ''}
                  </p>
                  {o.orders?.total_amount != null && (
                    <p className="text-xs text-gray-400">{formatNaira(Number(o.orders.total_amount))}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!selectedOrder} onClose={() => setSelectedOrder(null)} ariaLabel="Gift order detail">
        {selectedOrder && (
          <div className="space-y-4">
            {detailLoading ? (
              <div className="flex justify-center py-8">
                <Loader className="h-6 w-6 animate-spin text-primary-600" />
              </div>
            ) : detail ? (
              <>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    #{detail.orders?.order_number} — {detail.gift_boxes?.name || 'Custom box'}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {detail.orders?.customer_name} → {detail.recipient_name}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {detail.recipient_city}, {detail.recipient_state}
                  </p>
                  <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusChip(detail.gift_status)}`}>
                    {detail.gift_status}
                  </span>
                  {detail.gift_packaging_types && (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      <Package className="h-3.5 w-3.5" />
                      Pack as: {detail.gift_packaging_types.name}
                    </p>
                  )}
                </div>

                {detail.gift_message && (
                  <blockquote className="rounded-xl bg-primary-50 px-3 py-2.5 text-sm italic text-gray-700 ring-1 ring-primary-100">
                    {detail.gift_message}
                  </blockquote>
                )}

                {detail.packing_checklist && detail.packing_checklist.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold text-gray-900">Packing checklist</p>
                    <ul className="space-y-1.5 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-100">
                      {detail.packing_checklist.map((item, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span className="font-medium text-gray-500">{item.quantity}×</span>
                          <span>{item.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  type="button"
                  onClick={printCard}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600"
                >
                  <Printer className="h-4 w-4" />
                  Print message card
                </button>

                {(tab === 'packing' || detail.gift_status === 'packing') && (
                  <div className="space-y-2 border-t border-gray-100 pt-3">
                    <Field label="Pack photo URL">
                      <input
                        value={packPhotoUrl}
                        onChange={(e) => setPackPhotoUrl(e.target.value)}
                        className={inputCls}
                        placeholder="https://…"
                      />
                    </Field>
                    <Field label="QC notes">
                      <textarea
                        value={qcNotes}
                        onChange={(e) => setQcNotes(e.target.value)}
                        rows={2}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2 border-t border-gray-100 pt-3">
                  {['new', 'paid'].includes(detail.gift_status) && (
                    <button
                      type="button"
                      disabled={actioning}
                      onClick={() => runAction('start_packing')}
                      className="w-full rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Start packing
                    </button>
                  )}
                  {detail.gift_status === 'packing' && (
                    <button
                      type="button"
                      disabled={actioning}
                      onClick={() => runAction('mark_packed', { pack_photo_url: packPhotoUrl, qc_notes: qcNotes })}
                      className="w-full rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Mark packed
                    </button>
                  )}
                  {detail.gift_status === 'packed' && (
                    <button
                      type="button"
                      disabled={actioning}
                      onClick={() => runAction('dispatch')}
                      className="w-full rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Mark dispatched
                    </button>
                  )}
                  {detail.gift_status === 'dispatch' && (
                    <button
                      type="button"
                      disabled={actioning}
                      onClick={() => runAction('complete')}
                      className="w-full rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Mark delivered
                    </button>
                  )}
                  {detail.pack_photo_url && (
                    <a
                      href={detail.pack_photo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1 py-2 text-sm text-gray-600"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View pack photo
                    </a>
                  )}
                </div>

                {detail.events && detail.events.length > 0 && (
                  <ol className="space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500">
                    {detail.events.map((ev, i) => (
                      <li key={i}>
                        {new Date(ev.created_at).toLocaleString()} — {ev.status}
                        {ev.note ? `: ${ev.note}` : ''}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">Could not load order detail.</p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
