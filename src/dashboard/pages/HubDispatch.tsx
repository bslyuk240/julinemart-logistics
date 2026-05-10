import { useEffect, useMemo, useState } from 'react';
import { Loader, RefreshCw, Truck, User } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

type Hub = { id: string; name: string; city?: string | null };

type SubOrderRow = {
  id: string;
  main_order_id: string;
  hub_id: string | null;
  vendor_id: string | null;
  courier_shipment_id?: string | null;
  tracking_number?: string | null;
  metadata?: Record<string, any> | null;
  subtotal?: number | null;
  items?: Array<{ weight?: number; quantity?: number; name?: string }> | null;
  vendors?: { store_name?: string | null } | null;
  orders?: {
    woocommerce_order_id?: string | null;
    order_number?: string | number | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    delivery_address?: string | null;
    delivery_city?: string | null;
    delivery_state?: string | null;
  } | null;
};

type OrderGroup = {
  orderKey: string; // main_order_id
  orderLabel: string;
  customer: string;
  destination: string;
  vendorNames: string[];
  combinedWeight: number;
  combinedSubtotal: number;
  subOrderIds: string[];
  alreadyDispatched: boolean;
};

function isValidTracking(v?: string | null) {
  if (!v) return false;
  const bad = ['error', 'cannot', 'failed', 'jlo-', 'cr-'];
  return !bad.some((b) => v.toLowerCase().includes(b));
}

function calcWeight(items?: SubOrderRow['items']) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((s, i) => s + Number(i.weight || 0) * Number(i.quantity || 1), 0);
}

export function HubDispatchPage() {
  const notification = useNotification();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState<string>('');
  const [subOrders, setSubOrders] = useState<SubOrderRow[]>([]);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [force, setForce] = useState(false);
  const [riderModal, setRiderModal] = useState<string | null>(null);
  const [riderInfo, setRiderInfo] = useState({ name: '', phone: '', vehicle: '' });
  const [assigningRider, setAssigningRider] = useState(false);

  const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

  // ── Split into Fez groups and local deliveries ───────────────────────────
  const fezGroups = useMemo<OrderGroup[]>(() => {
    const fezRows = subOrders.filter((r) => {
      const lane = r.metadata?.selected_lane || 'fez';
      return lane === 'fez';
    });

    const map = new Map<string, OrderGroup>();
    for (const row of fezRows) {
      const key = row.main_order_id;
      if (!map.has(key)) {
        const o = row.orders;
        const label = o?.order_number
          ? `#${o.order_number}`
          : o?.woocommerce_order_id
          ? `#${o.woocommerce_order_id}`
          : `#${key.slice(0, 8)}`;
        map.set(key, {
          orderKey: key,
          orderLabel: label,
          customer: o?.customer_name || '—',
          destination: [o?.delivery_city, o?.delivery_state].filter(Boolean).join(', '),
          vendorNames: [],
          combinedWeight: 0,
          combinedSubtotal: 0,
          subOrderIds: [],
          alreadyDispatched: true,
        });
      }
      const g = map.get(key)!;
      if (row.vendors?.store_name) g.vendorNames.push(row.vendors.store_name);
      g.combinedWeight += calcWeight(row.items);
      g.combinedSubtotal += Number(row.subtotal || 0);
      g.subOrderIds.push(row.id);
      if (!force && !isValidTracking(row.tracking_number)) {
        g.alreadyDispatched = false;
      }
    }

    return Array.from(map.values()).filter((g) => force || !g.alreadyDispatched);
  }, [subOrders, force]);

  const localRows = useMemo(() => {
    return subOrders.filter((r) => {
      const lane = r.metadata?.selected_lane;
      return lane === 'local_rider';
    });
  }, [subOrders]);

  const allFezSelected =
    fezGroups.length > 0 && fezGroups.every((g) => selectedGroupKeys.includes(g.orderKey));

  const toggleAllFez = () => {
    if (allFezSelected) setSelectedGroupKeys([]);
    else setSelectedGroupKeys(fezGroups.map((g) => g.orderKey));
  };

  const toggleGroup = (key: string) =>
    setSelectedGroupKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const fetchHubs = async () => {
    const res = await fetch('/.netlify/functions/hubs');
    const payload = await res.json();
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Unable to load hubs');
    const rows = ((payload.data || []) as any[]).filter((h) => h?.is_active !== false);
    setHubs(rows);
    if (!selectedHubId && rows.length > 0) setSelectedHubId(rows[0].id);
  };

  const fetchSubOrders = async (hubId: string) => {
    if (!hubId) { setSubOrders([]); return; }
    const res = await fetch(`/.netlify/functions/hub-dispatch-list?hubId=${encodeURIComponent(hubId)}`);
    const payload = await res.json();
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Unable to load hub shipments');
    setSubOrders((payload.data || []) as SubOrderRow[]);
    setSelectedGroupKeys([]);
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try { await fetchSubOrders(selectedHubId); }
    catch (err) { notification.error('Refresh Failed', err instanceof Error ? err.message : 'Unable to load shipments'); }
    finally { setRefreshing(false); }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { await fetchHubs(); }
      catch (err) { notification.error('Load Failed', err instanceof Error ? err.message : 'Unable to load hubs'); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedHubId) return;
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHubId, force]);

  const dispatchSelected = async () => {
    if (!selectedHubId || selectedGroupKeys.length === 0) return;
    const subOrderIds = fezGroups
      .filter((g) => selectedGroupKeys.includes(g.orderKey))
      .flatMap((g) => g.subOrderIds);

    setDispatching(true);
    try {
      const res = await fetch(`${functionsBase}/fez-create-shipment-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hubId: selectedHubId, subOrderIds, force }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Batch dispatch failed');
      notification.success(
        'Batch Dispatch Complete',
        `Success: ${payload.counts?.successes || 0}, Failed: ${payload.counts?.failures || 0}, Skipped: ${payload.counts?.skipped || 0}`
      );
      await refreshAll();
    } catch (err) {
      notification.error('Dispatch Failed', err instanceof Error ? err.message : 'Unable to dispatch');
    } finally {
      setDispatching(false);
    }
  };

  const assignRider = async (subOrderId: string) => {
    if (!riderInfo.name || !riderInfo.phone) return;
    setAssigningRider(true);
    try {
      const res = await fetch(`${functionsBase}/assign-rider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sub_order_id: subOrderId,
          rider_name: riderInfo.name.trim(),
          rider_phone: riderInfo.phone.trim(),
          rider_vehicle: riderInfo.vehicle || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to assign rider');
      notification.success('Rider Assigned', 'Local rider saved for this shipment');
      setRiderModal(null);
      setRiderInfo({ name: '', phone: '', vehicle: '' });
      await refreshAll();
    } catch (err) {
      notification.error('Assignment Failed', err instanceof Error ? err.message : 'Unable to assign rider');
    } finally {
      setAssigningRider(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[320px] flex items-center justify-center">
        <Loader className="w-6 h-6 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900">Hub Dispatch</h1>
        <p className="text-sm text-gray-600 mt-1">
          Consolidate and dispatch Fez shipments by hub. Local deliveries are managed separately.
        </p>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Hub</label>
            {hubs.length === 0 ? (
              <div className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50">No hubs available</div>
            ) : (
              <select
                value={selectedHubId}
                onChange={(e) => setSelectedHubId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {hubs.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}{h.city ? ` (${h.city})` : ''}</option>
                ))}
              </select>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Force re-dispatch
          </label>
          <button onClick={refreshAll} disabled={refreshing} className="btn-secondary flex items-center justify-center gap-2">
            {refreshing ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>
      </div>

      {/* ── FEZ SHIPMENTS ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              Fez Shipments
            </h2>
            <p className="text-sm text-gray-600">
              Orders grouped for consolidated Fez dispatch — one shipment per order per hub.
            </p>
          </div>
          <button
            onClick={dispatchSelected}
            disabled={dispatching || selectedGroupKeys.length === 0}
            className="btn-primary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {dispatching ? <Loader className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
            Dispatch Selected ({selectedGroupKeys.length})
          </button>
        </div>

        {fezGroups.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center">
            No Fez-eligible orders pending dispatch for this hub.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 text-gray-600">
                  <th className="py-2 pr-3">
                    <input type="checkbox" checked={allFezSelected} onChange={toggleAllFez} />
                  </th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Customer → Destination</th>
                  <th className="py-2 pr-3">Vendors</th>
                  <th className="py-2 pr-3">Weight</th>
                  <th className="py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {fezGroups.map((g) => (
                  <tr key={g.orderKey} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={selectedGroupKeys.includes(g.orderKey)}
                        onChange={() => toggleGroup(g.orderKey)}
                      />
                    </td>
                    <td className="py-2 pr-3 font-medium">{g.orderLabel}</td>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-gray-900">{g.customer}</p>
                      <p className="text-xs text-gray-500">{g.destination}</p>
                    </td>
                    <td className="py-2 pr-3">
                      <p className="text-gray-700">{g.vendorNames.length} vendor{g.vendorNames.length !== 1 ? 's' : ''}</p>
                      {g.vendorNames.length > 0 && (
                        <p className="text-xs text-gray-400 truncate max-w-[160px]" title={g.vendorNames.join(', ')}>
                          {g.vendorNames.join(', ')}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-medium">{g.combinedWeight.toFixed(2)}kg</span>
                    </td>
                    <td className="py-2">₦{g.combinedSubtotal.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── LOCAL DELIVERIES ──────────────────────────────────────────────── */}
      <div className="card">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <User className="w-5 h-5 text-green-600" />
            Local Deliveries
          </h2>
          <p className="text-sm text-gray-600">
            Sub-orders where the customer's city matches this hub — assign a local rider.
          </p>
        </div>

        {localRows.length === 0 ? (
          <div className="text-sm text-gray-500 py-8 text-center">
            No local deliveries pending for this hub.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200 text-gray-600">
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Customer → Destination</th>
                  <th className="py-2 pr-3">Vendor</th>
                  <th className="py-2 pr-3">Value</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {localRows.map((row) => {
                  const o = row.orders;
                  const label = o?.order_number
                    ? `#${o.order_number}`
                    : o?.woocommerce_order_id
                    ? `#${o.woocommerce_order_id}`
                    : `#${row.main_order_id.slice(0, 8)}`;
                  return (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-3 font-medium">{label}</td>
                      <td className="py-2 pr-3">
                        <p className="font-medium text-gray-900">{o?.customer_name || '—'}</p>
                        <p className="text-xs text-gray-500">
                          {[o?.delivery_city, o?.delivery_state].filter(Boolean).join(', ')}
                        </p>
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{row.vendors?.store_name || '—'}</td>
                      <td className="py-2 pr-3">₦{Number(row.subtotal || 0).toLocaleString()}</td>
                      <td className="py-2">
                        <button
                          onClick={() => { setRiderModal(row.id); setRiderInfo({ name: '', phone: '', vehicle: '' }); }}
                          className="btn-secondary text-xs px-3 py-1"
                        >
                          Assign Rider
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Rider Assignment Modal ─────────────────────────────────────────── */}
      {riderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">Assign Local Rider</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Rider Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={riderInfo.name}
                  onChange={(e) => setRiderInfo({ ...riderInfo, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="Enter rider name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone Number <span className="text-red-500">*</span></label>
                <input
                  type="tel"
                  value={riderInfo.phone}
                  onChange={(e) => setRiderInfo({ ...riderInfo, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                  placeholder="+234 800 000 0000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Vehicle Type</label>
                <select
                  value={riderInfo.vehicle}
                  onChange={(e) => setRiderInfo({ ...riderInfo, vehicle: e.target.value })}
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value="">Select vehicle</option>
                  <option value="Motorcycle">Motorcycle</option>
                  <option value="Bicycle">Bicycle</option>
                  <option value="Van">Van</option>
                  <option value="Car">Car</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => { setRiderModal(null); setRiderInfo({ name: '', phone: '', vehicle: '' }); }}
                className="flex-1 px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => assignRider(riderModal)}
                disabled={!riderInfo.name || !riderInfo.phone || assigningRider}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {assigningRider && <Loader className="w-4 h-4 animate-spin" />}
                Assign Rider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
