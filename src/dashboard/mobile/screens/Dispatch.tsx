import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronRight, Loader, QrCode, Truck } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { Sheet } from '../Sheet';
import { PullToRefresh } from '../PullToRefresh';
import { Scanner } from '../Scanner';
import { SectionLabel } from '../components/MobileDetailParts';
import { TABBAR_SPACE, functionsAuthHeader, functionsBase } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';

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
  orderKey: string;
  orderLabel: string;
  customer: string;
  destination: string;
  vendorNames: string[];
  combinedWeight: number;
  combinedSubtotal: number;
  subOrderIds: string[];
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

function orderLabelFromRow(row: SubOrderRow) {
  const o = row.orders;
  if (o?.order_number) return `#${o.order_number}`;
  if (o?.woocommerce_order_id) return `#${o.woocommerce_order_id}`;
  return `#${row.main_order_id.slice(0, 8)}`;
}

export default function MobileDispatch() {
  const navigate = useNavigate();
  const notification = useNotification();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState('');
  const [subOrders, setSubOrders] = useState<SubOrderRow[]>([]);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [force, setForce] = useState(false);
  const [riderTarget, setRiderTarget] = useState<SubOrderRow | null>(null);
  const [riderInfo, setRiderInfo] = useState({ name: '', phone: '', vehicle: '' });
  const [assigningRider, setAssigningRider] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanResult, setScanResult] = useState<{ code: string; match: SubOrderRow | null } | null>(null);

  const handleScanDetected = (code: string) => {
    setScannerOpen(false);
    const match = subOrders.find((row) => row.tracking_number === code) || null;
    setScanResult({ code, match });
  };

  const fezGroups = useMemo<OrderGroup[]>(() => {
    const fezRows = subOrders.filter((r) => (r.metadata?.selected_lane || 'fez') === 'fez');
    const map = new Map<string, OrderGroup>();
    for (const row of fezRows) {
      const key = row.main_order_id;
      if (!force && isValidTracking(row.tracking_number)) continue;
      if (!map.has(key)) {
        const o = row.orders;
        const label = o?.order_number ? `#${o.order_number}` : o?.woocommerce_order_id ? `#${o.woocommerce_order_id}` : `#${key.slice(0, 8)}`;
        map.set(key, {
          orderKey: key,
          orderLabel: label,
          customer: o?.customer_name || '—',
          destination: [o?.delivery_city, o?.delivery_state].filter(Boolean).join(', '),
          vendorNames: [],
          combinedWeight: 0,
          combinedSubtotal: 0,
          subOrderIds: [],
        });
      }
      const g = map.get(key)!;
      if (row.vendors?.store_name) g.vendorNames.push(row.vendors.store_name);
      g.combinedWeight += calcWeight(row.items);
      g.combinedSubtotal += Number(row.subtotal || 0);
      g.subOrderIds.push(row.id);
    }
    return Array.from(map.values());
  }, [subOrders, force]);

  const localRows = useMemo(
    () => subOrders.filter((r) => r.metadata?.selected_lane === 'local_rider'),
    [subOrders],
  );

  const fetchHubs = async () => {
    const res = await fetch(`${functionsBase}/hubs`);
    const payload = await res.json();
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Unable to load hubs');
    const rows = ((payload.data || []) as Hub[]).filter((h: any) => h?.is_active !== false);
    setHubs(rows);
    if (!selectedHubId && rows.length > 0) setSelectedHubId(rows[0].id);
  };

  const fetchSubOrders = async (hubId: string) => {
    if (!hubId) {
      setSubOrders([]);
      return;
    }
    const res = await fetch(`${functionsBase}/hub-dispatch-list?hubId=${encodeURIComponent(hubId)}`);
    const payload = await res.json();
    if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Unable to load hub shipments');
    setSubOrders((payload.data || []) as SubOrderRow[]);
    setSelectedGroupKeys([]);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await fetchHubs();
      } catch (err) {
        notification.error('Load Failed', err instanceof Error ? err.message : 'Unable to load hubs');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedHubId) return;
    fetchSubOrders(selectedHubId).catch((err) =>
      notification.error('Refresh Failed', err instanceof Error ? err.message : 'Unable to load shipments'),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHubId, force]);

  const toggleGroup = (key: string) =>
    setSelectedGroupKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const dispatchSelected = async () => {
    if (!selectedHubId || selectedGroupKeys.length === 0) return;
    const subOrderIds = fezGroups.filter((g) => selectedGroupKeys.includes(g.orderKey)).flatMap((g) => g.subOrderIds);

    setDispatching(true);
    try {
      const res = await fetch(`${functionsBase}/fez-create-shipment-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await functionsAuthHeader()),
        },
        body: JSON.stringify({ hubId: selectedHubId, subOrderIds, force }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Batch dispatch failed');
      notification.success(
        'Batch Dispatch Complete',
        `Success: ${payload.counts?.successes || 0}, Failed: ${payload.counts?.failures || 0}, Skipped: ${payload.counts?.skipped || 0}`,
      );
      await fetchSubOrders(selectedHubId);
    } catch (err) {
      notification.error('Dispatch Failed', err instanceof Error ? err.message : 'Unable to dispatch');
    } finally {
      setDispatching(false);
    }
  };

  const assignRider = async () => {
    if (!riderTarget || !riderInfo.name || !riderInfo.phone) return;
    setAssigningRider(true);
    try {
      const res = await fetch(`${functionsBase}/assign-rider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await functionsAuthHeader()) },
        body: JSON.stringify({
          sub_order_id: riderTarget.id,
          rider_name: riderInfo.name.trim(),
          rider_phone: riderInfo.phone.trim(),
          rider_vehicle: riderInfo.vehicle || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) throw new Error(payload?.error || 'Failed to assign rider');
      notification.success('Rider Assigned', 'Local rider saved for this shipment');
      setRiderTarget(null);
      setRiderInfo({ name: '', phone: '', vehicle: '' });
      await fetchSubOrders(selectedHubId);
    } catch (err) {
      notification.error('Assignment Failed', err instanceof Error ? err.message : 'Unable to assign rider');
    } finally {
      setAssigningRider(false);
    }
  };

  const openOrder = (mainOrderId: string) => {
    setScanResult(null);
    navigate(`/admin/orders/${mainOrderId}`);
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  const selectedHub = hubs.find((h) => h.id === selectedHubId);

  return (
    <>
      <PullToRefresh onRefresh={() => fetchSubOrders(selectedHubId)}>
        <div className="space-y-4 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          {hubs.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No hubs available</div>
          ) : (
            <>
              <SectionLabel>Hub</SectionLabel>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {hubs.map((h) => {
                  const active = h.id === selectedHubId;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setSelectedHubId(h.id)}
                      className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                        active ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'
                      }`}
                    >
                      {h.name}
                      {h.city ? ` · ${h.city}` : ''}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
          >
            <QrCode className="h-4 w-4" />
            Scan waybill
          </button>

          <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs text-gray-600 ring-1 ring-gray-100">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            Force re-dispatch
          </label>

          <SectionLabel>Fez shipments · {fezGroups.length} pending</SectionLabel>
          {fezGroups.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">
              {selectedHub ? `No Fez-eligible orders pending at ${selectedHub.name}.` : 'Select a hub to load shipments.'}
            </div>
          ) : (
            <div className="space-y-2">
              {fezGroups.map((g) => {
                const checked = selectedGroupKeys.includes(g.orderKey);
                return (
                  <div
                    key={g.orderKey}
                    className={`overflow-hidden rounded-xl bg-white ring-1 ${checked ? 'ring-primary-600' : 'ring-gray-100'}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.orderKey)}
                      aria-pressed={checked}
                      className="flex w-full items-start gap-3 p-3 text-left"
                    >
                      <div
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                          checked ? 'border-primary-600 bg-primary-600' : 'border-gray-300'
                        }`}
                      >
                        {checked && <span className="text-[10px] font-bold text-white">✓</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-gray-900">{g.orderLabel}</span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                            {formatNaira(g.combinedSubtotal)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-sm text-gray-700">{g.customer}</div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-gray-500">
                          <span className="truncate">{g.destination || '—'}</span>
                          <span className="shrink-0">{g.combinedWeight.toFixed(2)} kg</span>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => openOrder(g.orderKey)}
                      className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2.5 text-left text-sm font-medium text-primary-600 active:bg-gray-50"
                    >
                      View order
                      <ChevronRight className="ml-auto h-4 w-4 text-gray-300" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <SectionLabel>Local deliveries · {localRows.length}</SectionLabel>
          {localRows.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No local deliveries pending for this hub.</div>
          ) : (
            <div className="space-y-2">
              {localRows.map((row) => {
                const o = row.orders;
                const label = orderLabelFromRow(row);
                return (
                  <div key={row.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-100">
                    <button
                      type="button"
                      onClick={() => openOrder(row.main_order_id)}
                      className="flex w-full items-center gap-3 p-3 text-left active:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-900">{label}</div>
                        <div className="mt-0.5 text-sm text-gray-700">{o?.customer_name || '—'}</div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {[o?.delivery_city, o?.delivery_state].filter(Boolean).join(', ') || '—'}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                    <div className="border-t border-gray-100 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRiderTarget(row);
                          setRiderInfo({ name: '', phone: '', vehicle: '' });
                        }}
                        className="w-full rounded-lg border border-primary-200 bg-primary-50 py-2 text-xs font-semibold text-primary-700"
                      >
                        Assign rider
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedGroupKeys.length > 0 && (
            <div
              className="fixed inset-x-0 z-30 border-t border-gray-200 bg-white p-3"
              style={{ bottom: TABBAR_SPACE }}
            >
              <button
                type="button"
                onClick={dispatchSelected}
                disabled={dispatching}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {dispatching ? <Loader className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                Dispatch selected ({selectedGroupKeys.length})
              </button>
            </div>
          )}

          <Sheet open={!!riderTarget} onClose={() => setRiderTarget(null)} ariaLabel="Assign local rider">
            <h3 className="text-base font-bold text-gray-900">Assign local rider</h3>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Rider name"
                value={riderInfo.name}
                onChange={(event) => setRiderInfo((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
              <input
                type="tel"
                placeholder="Rider phone"
                value={riderInfo.phone}
                onChange={(event) => setRiderInfo((prev) => ({ ...prev, phone: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
              <input
                type="text"
                placeholder="Vehicle (optional)"
                value={riderInfo.vehicle}
                onChange={(event) => setRiderInfo((prev) => ({ ...prev, vehicle: event.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
            </div>
            <button
              type="button"
              onClick={assignRider}
              disabled={assigningRider || !riderInfo.name || !riderInfo.phone}
              className="rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {assigningRider ? 'Saving…' : 'Save rider'}
            </button>
          </Sheet>
        </div>
      </PullToRefresh>

      {scannerOpen && <Scanner onDetect={handleScanDetected} onClose={() => setScannerOpen(false)} />}

      <Sheet open={!!scanResult} onClose={() => setScanResult(null)} ariaLabel="Scan result">
        {scanResult &&
          (scanResult.match ? (
            <>
              <div>
                <div className="text-xs text-gray-500">{scanResult.code}</div>
                <div className="mt-0.5 text-lg font-bold tracking-tight text-gray-900">
                  {scanResult.match.orders?.customer_name || '—'}
                </div>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-500">Order</dt>
                <dd className="font-medium text-gray-900">{orderLabelFromRow(scanResult.match)}</dd>
                <dt className="text-gray-500">Destination</dt>
                <dd className="text-gray-900">
                  {[scanResult.match.orders?.delivery_city, scanResult.match.orders?.delivery_state].filter(Boolean).join(', ') || '—'}
                </dd>
                <dt className="text-gray-500">Vendor</dt>
                <dd className="text-gray-900">{scanResult.match.vendors?.store_name || '—'}</dd>
              </dl>
              <button
                type="button"
                onClick={() => openOrder(scanResult.match!.main_order_id)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white"
              >
                View order
                <ArrowRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <div className="py-4 text-center">
              <p className="text-xs text-gray-500">{scanResult.code}</p>
              <p className="mt-2 text-sm text-gray-600">No shipment at this hub matches that code.</p>
            </div>
          ))}
      </Sheet>
    </>
  );
}
