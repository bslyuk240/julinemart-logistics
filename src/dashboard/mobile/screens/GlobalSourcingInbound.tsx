import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader, Package, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { DetailRow, SectionLabel } from '../components/MobileDetailParts';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { callGlobalSourcing } from '../lib/globalSourcingApi';
import {
  SHIPMENT_FILTERS,
  type InboundShipment,
  type ShipmentFilter,
  formatInboundStatus,
  getShipmentSupplierOrderStatus,
  getShipmentTitle,
  inboundStatusStyle,
  matchesShipmentFilter,
} from '../lib/globalSourcingInbound';

interface GlobalSourcingInboundProps {
  embedded?: boolean;
}

export default function GlobalSourcingInbound({ embedded = false }: GlobalSourcingInboundProps) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const notification = useNotification();

  const [shipments, setShipments] = useState<InboundShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ShipmentFilter>('all');
  const [selected, setSelected] = useState<InboundShipment | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const response = await callGlobalSourcing<{ data: InboundShipment[] }>('global-sourcing-inbound-shipments', {
        method: 'GET',
      });
      setShipments(response.data || []);
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load inbound shipments');
    } finally {
      setLoading(false);
    }
  }, [notification, session?.access_token]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => shipments.filter((s) => matchesShipmentFilter(s, filter)), [shipments, filter]);

  const postAction = async (body: Record<string, unknown>, successMessage: string) => {
    if (!selected) return;
    setActionId(selected.id);
    try {
      await callGlobalSourcing('global-sourcing-inbound-shipments', { method: 'POST', body: JSON.stringify(body) });
      notification.success('Updated', successMessage);
      setSelected(null);
      await load();
    } catch (err) {
      notification.error('Action failed', err instanceof Error ? err.message : 'Unable to update shipment');
    } finally {
      setActionId(null);
    }
  };

  const markReceived = () => postAction({ action: 'mark_received_at_hub', shipment_id: selected!.id }, 'Marked received at hub');

  const refreshTracking = () => postAction({ action: 'refresh_cj_tracking', shipment_id: selected!.id }, 'Tracking refreshed');

  const createSupplierOrder = () => postAction({ action: 'create_supplier_order', shipment_id: selected!.id }, 'Supplier order created');

  const selectedStatus = selected ? getShipmentSupplierOrderStatus(selected) : null;
  const mainOrderId = selected?.sub_orders?.main_order_id;

  const contentPadding = embedded ? undefined : { paddingBottom: TABBAR_SPACE };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className={embedded ? 'space-y-3' : 'space-y-3 p-4'} style={contentPadding}>
          {!embedded && (
            <div>
              <h1 className="text-lg font-bold text-gray-900">Inbound Shipments</h1>
              <p className="text-xs text-gray-500">Global sourcing queue — supplier to hub</p>
            </div>
          )}

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
            {SHIPMENT_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium ${
                  filter === key ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <SectionLabel>
            {filtered.length} shipment{filtered.length !== 1 ? 's' : ''}
          </SectionLabel>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No inbound shipments in this filter.</div>
          ) : (
            <div className="space-y-2">
              {filtered.map((shipment) => {
                const status = getShipmentSupplierOrderStatus(shipment);
                return (
                  <button
                    key={shipment.id}
                    type="button"
                    onClick={() => setSelected(shipment)}
                    className="flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                      {shipment.product_image ? (
                        <img src={shipment.product_image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{getShipmentTitle(shipment)}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{shipment.hubs?.name || 'Hub TBD'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${inboundStatusStyle(status)}`}>
                          {formatInboundStatus(status)}
                        </span>
                        {shipment.inbound_tracking_number && (
                          <span className="truncate text-[10px] text-gray-400">{shipment.inbound_tracking_number}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Inbound shipment details">
        {selected && (
          <>
            <div>
              <p className="text-xs text-gray-500">{selected.provider.toUpperCase()} · {selected.hubs?.name || 'Hub'}</p>
              <h3 className="mt-0.5 text-lg font-bold text-gray-900">{getShipmentTitle(selected)}</h3>
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${inboundStatusStyle(selectedStatus || '')}`}>
                {formatInboundStatus(selectedStatus || selected.inbound_status)}
              </span>
            </div>

            <div className="divide-y divide-gray-100 overflow-hidden rounded-xl bg-gray-50">
              {selected.cj_order_id && <DetailRow label="CJ order" value={selected.cj_order_id} mono />}
              {selected.inbound_tracking_number && <DetailRow label="Tracking" value={selected.inbound_tracking_number} mono />}
              {selected.estimated_arrival_at && (
                <DetailRow label="ETA" value={new Date(selected.estimated_arrival_at).toLocaleDateString()} />
              )}
              {selected.received_at_hub_at && (
                <DetailRow label="Received" value={new Date(selected.received_at_hub_at).toLocaleDateString()} />
              )}
            </div>

            <div className="space-y-2">
              {selectedStatus === 'awaiting_supplier_order' && (
                <button
                  type="button"
                  disabled={actionId === selected.id}
                  onClick={createSupplierOrder}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {actionId === selected.id ? <Loader className="h-4 w-4 animate-spin" /> : null}
                  Create CJ order
                </button>
              )}
              {selected.cj_order_id && selectedStatus !== 'received_at_hub' && (
                <button
                  type="button"
                  disabled={actionId === selected.id}
                  onClick={refreshTracking}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-900 disabled:opacity-60"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh tracking
                </button>
              )}
              {selectedStatus !== 'received_at_hub' && (
                <button
                  type="button"
                  disabled={actionId === selected.id}
                  onClick={markReceived}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Mark received at hub
                </button>
              )}
              {mainOrderId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    navigate(`/admin/orders/${mainOrderId}`);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-primary-600"
                >
                  View customer order
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
