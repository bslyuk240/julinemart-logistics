import { useCallback, useEffect, useState } from 'react';
import {
  Gift,
  Package,
  Truck,
  CheckCircle2,
  Printer,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

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
  requested_delivery_date?: string | null;
  occasion_date?: string | null;
  pack_photo_url?: string | null;
  qc_notes?: string | null;
  gift_boxes?: { name: string; slug: string } | null;
  gift_fulfilment_centres?: { name: string; code: string } | null;
  orders?: {
    order_number: string | number;
    customer_name: string;
    payment_status: string;
    total_amount: number;
  } | null;
};

type GiftOpsDetail = GiftOpsOrder & {
  events?: { status: string; note?: string; created_at: string }[];
  packing_checklist?: { name: string; quantity: number; customisation?: string[] | null }[];
};

const TABS: { id: Tab; label: string; icon: typeof Gift }[] = [
  { id: 'new', label: 'New', icon: Gift },
  { id: 'packing', label: 'Packing', icon: Package },
  { id: 'dispatch', label: 'Dispatch', icon: Truck },
  { id: 'done', label: 'Done', icon: CheckCircle2 },
];

export default function GiftOpsPage() {
  const { session } = useAuth();
  const notification = useNotification();
  const [tab, setTab] = useState<Tab>('new');
  const [hubs, setHubs] = useState<GiftHub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState('');
  const [orders, setOrders] = useState<GiftOpsOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GiftOpsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
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
        { headers }
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

  const loadDetail = useCallback(async (id: string) => {
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
  }, [authHeaders, notification]);

  useEffect(() => {
    if (selectedHubId) loadQueue();
  }, [selectedHubId, tab, loadQueue]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    const headers = authHeaders();
    if (!headers || !selectedId) return;
    try {
      const res = await fetch(`${functionsBase}/admin-gift-ops?id=${encodeURIComponent(selectedId)}`, {
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
    }
  };

  const printCard = async () => {
    const headers = authHeaders();
    if (!headers || !selectedId) return;
    try {
      const res = await fetch(
        `${functionsBase}/gift-message-card?gift_order_id=${encodeURIComponent(selectedId)}`,
        { headers }
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

  return (
    <div className="w-full max-w-none px-4 sm:px-6 xl:px-8 py-4 md:py-6">
      <div className="flex items-center gap-3 mb-6">
        <Gift className="w-8 h-8 text-primary-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Gift ops</h1>
          <p className="text-sm text-gray-600">Pack, QC, dispatch — Warri and other hubs</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative">
          <select
            className="appearance-none border rounded-lg pl-3 pr-8 py-2 text-sm bg-white"
            value={selectedHubId}
            onChange={(e) => setSelectedHubId(e.target.value)}
          >
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        <div className="flex gap-1 flex-wrap ml-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setTab(id); setSelectedId(null); }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${
                tab === id ? 'bg-primary-600 text-white' : 'bg-white border text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-medium capitalize">{tab} ({orders.length})</div>
          {loading ? (
            <p className="p-4 text-sm text-gray-500">Loading…</p>
          ) : orders.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">No orders in this queue.</p>
          ) : (
            <ul className="divide-y max-h-[70vh] overflow-y-auto">
              {orders.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selectedId === o.id ? 'bg-primary-50' : ''}`}
                    onClick={() => setSelectedId(o.id)}
                  >
                    <p className="font-medium text-sm">#{o.orders?.order_number} · {o.gift_boxes?.name}</p>
                    <p className="text-xs text-gray-500">
                      To {o.recipient_name} · {o.recipient_city} · {o.gift_status}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border rounded-xl p-4 space-y-4">
          {!selectedId ? (
            <p className="text-sm text-gray-500">Select an order to pack or dispatch.</p>
          ) : detailLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : detail ? (
            <>
              <div>
                <p className="font-semibold">#{detail.orders?.order_number} — {detail.gift_boxes?.name}</p>
                <p className="text-sm text-gray-600">From {detail.orders?.customer_name} → {detail.recipient_name}</p>
                <p className="text-xs text-gray-500 mt-1">{detail.recipient_city}, {detail.recipient_state}</p>
                {(detail.requested_delivery_date || detail.occasion_date) && (
                  <p className="text-xs text-primary-700 mt-2">
                    {detail.requested_delivery_date
                      ? `Deliver by ${detail.requested_delivery_date}`
                      : null}
                    {detail.requested_delivery_date && detail.occasion_date ? ' · ' : null}
                    {detail.occasion_date ? `Occasion ${detail.occasion_date}` : null}
                  </p>
                )}
              </div>

              {detail.gift_message && (
                <blockquote className="text-sm italic border-l-4 border-primary-200 pl-3 text-gray-700">
                  {detail.gift_message}
                </blockquote>
              )}

              {detail.packing_checklist && detail.packing_checklist.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Packing checklist</p>
                  <ul className="text-sm space-y-1">
                    {detail.packing_checklist.map((item, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-gray-500">{item.quantity}×</span>
                        <span>
                          {item.name}
                          {item.customisation?.length ? (
                            <span className="block text-xs text-primary-700">
                              {item.customisation.join(' · ')}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                type="button"
                onClick={printCard}
                className="inline-flex items-center gap-2 text-sm text-primary-600 font-medium"
              >
                <Printer className="w-4 h-4" /> Print message card
              </button>

              {(tab === 'packing' || detail.gift_status === 'packing') && (
                <div className="space-y-2 border-t pt-3">
                  <input
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="Pack photo URL (optional)"
                    value={packPhotoUrl}
                    onChange={(e) => setPackPhotoUrl(e.target.value)}
                  />
                  <textarea
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="QC notes"
                    rows={2}
                    value={qcNotes}
                    onChange={(e) => setQcNotes(e.target.value)}
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t pt-3">
                {['new', 'paid'].includes(detail.gift_status) && (
                  <button type="button" className="bg-primary-600 text-white px-3 py-2 rounded-lg text-sm" onClick={() => runAction('start_packing')}>
                    Start packing
                  </button>
                )}
                {detail.gift_status === 'packing' && (
                  <button
                    type="button"
                    className="bg-primary-600 text-white px-3 py-2 rounded-lg text-sm"
                    onClick={() => runAction('mark_packed', { pack_photo_url: packPhotoUrl, qc_notes: qcNotes })}
                  >
                    Mark packed
                  </button>
                )}
                {detail.gift_status === 'packed' && (
                  <button type="button" className="bg-primary-600 text-white px-3 py-2 rounded-lg text-sm" onClick={() => runAction('dispatch')}>
                    Mark dispatched
                  </button>
                )}
                {detail.gift_status === 'dispatch' && (
                  <button type="button" className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm" onClick={() => runAction('complete')}>
                    Mark delivered
                  </button>
                )}
                {detail.pack_photo_url && (
                  <a href={detail.pack_photo_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-gray-600">
                    <ExternalLink className="w-3 h-3" /> Pack photo
                  </a>
                )}
              </div>

              {detail.events && detail.events.length > 0 && (
                <ol className="text-xs text-gray-500 space-y-1 border-t pt-3">
                  {detail.events.map((ev, i) => (
                    <li key={i}>{new Date(ev.created_at).toLocaleString()} — {ev.status}{ev.note ? `: ${ev.note}` : ''}</li>
                  ))}
                </ol>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
