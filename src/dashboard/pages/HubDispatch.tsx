import { useEffect, useMemo, useState } from 'react';
import { Loader, RefreshCw, Truck } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

type Hub = {
  id: string;
  name: string;
  city?: string | null;
};

type ShipmentRow = {
  id: string;
  hub_id: string | null;
  courier_shipment_id?: string | null;
  tracking_number?: string | null;
  metadata?: Record<string, any> | null;
  subtotal?: number | null;
  orders?: {
    woocommerce_order_id?: string | null;
    customer_name?: string | null;
    customer_phone?: string | null;
    delivery_address?: string | null;
    delivery_city?: string | null;
    delivery_state?: string | null;
  } | null;
};

const getSelectedLane = (row: ShipmentRow): string => {
  return row?.metadata?.selected_lane === 'local_rider' ? 'local_rider' : 'fez';
};

export function HubDispatchPage() {
  const notification = useNotification();
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [selectedHubId, setSelectedHubId] = useState<string>('');
  const [subOrders, setSubOrders] = useState<ShipmentRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [dispatching, setDispatching] = useState<boolean>(false);
  const [force, setForce] = useState<boolean>(false);

  const filteredSubOrders = useMemo(() => {
    return subOrders.filter((row) => {
      if (getSelectedLane(row) !== 'fez') return false;
      if (!force && row.courier_shipment_id) return false;
      return true;
    });
  }, [subOrders, force]);

  const selectedRows = useMemo(
    () => filteredSubOrders.filter((row) => selectedIds.includes(row.id)),
    [filteredSubOrders, selectedIds]
  );

  const formatDestination = (row: ShipmentRow) => {
    const address = row.orders?.delivery_address || '';
    const city = row.orders?.delivery_city || '';
    const state = row.orders?.delivery_state || '';
    return `${address}${address && (city || state) ? ', ' : ''}${city}${city && state ? ', ' : ''}${state}`.trim();
  };

  const fetchHubs = async () => {
    const response = await fetch('/.netlify/functions/hubs');
    const payload = await response.json();
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || payload?.message || 'Unable to load hubs');
    }

    const rows = ((payload.data || []) as Hub[]).filter((hub: any) =>
      hub?.is_active !== false
    );
    setHubs(rows);
    if (!selectedHubId && rows.length > 0) {
      setSelectedHubId(rows[0].id);
    }
  };

  const fetchSubOrders = async (hubId: string) => {
    if (!hubId) {
      setSubOrders([]);
      return;
    }

    const response = await fetch(
      `/.netlify/functions/hub-dispatch-list?hubId=${encodeURIComponent(hubId)}`
    );
    const payload = await response.json();
    if (!response.ok || !payload?.success) {
      throw new Error(
        payload?.error || payload?.message || 'Unable to load hub shipments'
      );
    }

    setSubOrders((payload.data || []) as ShipmentRow[]);
    setSelectedIds([]);
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await fetchSubOrders(selectedHubId);
    } catch (error) {
      console.error('Failed to refresh hub dispatch list:', error);
      notification.error(
        'Refresh Failed',
        error instanceof Error ? error.message : 'Unable to load shipments'
      );
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const boot = async () => {
      setLoading(true);
      try {
        await fetchHubs();
      } catch (error) {
        console.error('Failed to load hubs:', error);
        notification.error(
          'Load Failed',
          error instanceof Error ? error.message : 'Unable to load hubs'
        );
      } finally {
        setLoading(false);
      }
    };

    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedHubId) return;
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHubId, force]);

  const allSelected =
    filteredSubOrders.length > 0 &&
    filteredSubOrders.every((row) => selectedIds.includes(row.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(filteredSubOrders.map((row) => row.id));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const dispatchSelected = async () => {
    if (!selectedHubId || selectedIds.length === 0) {
      return;
    }

    setDispatching(true);
    try {
      const response = await fetch('/.netlify/functions/fez-create-shipment-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hubId: selectedHubId,
          subOrderIds: selectedIds,
          force,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || payload?.message || 'Batch dispatch failed');
      }

      notification.success(
        'Batch Dispatch Complete',
        `Success: ${payload.counts?.successes || 0}, Failed: ${payload.counts?.failures || 0}, Skipped: ${payload.counts?.skipped || 0}`
      );
      await refreshAll();
    } catch (error) {
      console.error('Batch dispatch failed:', error);
      notification.error(
        'Dispatch Failed',
        error instanceof Error ? error.message : 'Unable to dispatch selected shipments'
      );
    } finally {
      setDispatching(false);
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
      <div className="card">
        <h1 className="text-2xl font-bold text-gray-900">Hub Dispatch</h1>
        <p className="text-sm text-gray-600 mt-1">
          Dispatch FEZ-eligible shipments in one action by hub.
        </p>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hub
            </label>
            {hubs.length === 0 ? (
              <div className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500 bg-gray-50">
                No hubs available
              </div>
            ) : (
              <select
                value={selectedHubId}
                onChange={(event) => setSelectedHubId(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2"
              >
                {hubs.map((hub) => (
                  <option key={hub.id} value={hub.id}>
                    {hub.name} {hub.city ? `(${hub.city})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
            />
            Force re-dispatch
          </label>

          <button
            onClick={refreshAll}
            disabled={refreshing}
            className="btn-secondary flex items-center justify-center gap-2"
          >
            {refreshing ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Refresh
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              FEZ Candidate Shipments
            </h2>
            <p className="text-sm text-gray-600">
              {filteredSubOrders.length} shipment(s) match lane and dispatch filters.
            </p>
          </div>
          <button
            onClick={dispatchSelected}
            disabled={dispatching || selectedIds.length === 0}
            className="btn-primary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {dispatching ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Truck className="w-4 h-4" />
            )}
            Dispatch Selected to Fez
          </button>
        </div>

        {selectedRows.length > 0 && (
          <div className="mb-4 border border-blue-200 bg-blue-50 rounded-lg p-3">
            <p className="text-sm font-semibold text-blue-900 mb-2">
              Destination Preview ({selectedRows.length} selected)
            </p>
            <div className="space-y-1 text-xs text-blue-900">
              {selectedRows.slice(0, 8).map((row) => (
                <div key={row.id}>
                  #{row.orders?.woocommerce_order_id || '-'} - {row.orders?.customer_name || 'Unknown'} - {formatDestination(row) || 'No address'}
                </div>
              ))}
              {selectedRows.length > 8 && (
                <div>...and {selectedRows.length - 8} more</div>
              )}
            </div>
          </div>
        )}

        {filteredSubOrders.length === 0 ? (
          <div className="text-sm text-gray-600 py-8 text-center">
            No FEZ-eligible shipments found for this hub.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-200">
                  <th className="py-2 pr-2">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                  <th className="py-2 pr-2">Order</th>
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Destination</th>
                  <th className="py-2 pr-2">Subtotal</th>
                  <th className="py-2 pr-2">Lane</th>
                  <th className="py-2">Shipment ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredSubOrders.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100">
                    <td className="py-2 pr-2 align-top">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => toggleOne(row.id)}
                      />
                    </td>
                    <td className="py-2 pr-2 align-top">
                      #{row.orders?.woocommerce_order_id || '-'}
                    </td>
                    <td className="py-2 pr-2 align-top">
                      {row.orders?.customer_name || '-'}
                    </td>
                    <td className="py-2 pr-2 align-top">
                      <div className="max-w-xs">
                        <div className="truncate" title={formatDestination(row)}>
                          {formatDestination(row) || '-'}
                        </div>
                        {row.orders?.customer_phone && (
                          <div className="text-xs text-gray-500">
                            {row.orders.customer_phone}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-2 align-top">
                      ₦{Number(row.subtotal || 0).toLocaleString()}
                    </td>
                    <td className="py-2 pr-2 align-top">{getSelectedLane(row)}</td>
                    <td className="py-2 align-top font-mono text-xs">
                      {row.courier_shipment_id || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
