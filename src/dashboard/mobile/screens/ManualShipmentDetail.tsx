import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  ExternalLink,
  Loader,
  Package,
  RefreshCw,
  Send,
  Tag,
  Trash2,
  Truck,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { ContactSection, DetailRow, SectionLabel } from '../components/MobileDetailParts';
import RiderPicker from '../../components/RiderPicker';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsAuthHeader, functionsBase } from '../lib/functionsAuth';
import { openLabelPrint, openWaybillPrint } from '../../lib/waybillPrint';
import { formatNaira, statusLabel, statusStyle } from '../lib/displayUtils';
import { ShipmentTrackingEvents } from '../../../shared/ShipmentTrackingEvents';

interface Address {
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email?: string;
}

interface TrackingEvent {
  status: string;
  description: string;
  location: string | null;
  timestamp: string;
}

interface ManualShipment {
  id: string;
  shipment_code: string;
  sender: Address;
  recipient: Address;
  item_description: string;
  item_weight: number;
  item_value: number;
  status: string;
  tracking_number: string | null;
  courier_tracking_url: string | null;
  delivery_person_name: string | null;
  delivery_person_phone: string | null;
  waybill_number: string | null;
  last_tracking_update: string | null;
  metadata: { selected_lane?: 'fez' | 'local_rider' } | null;
  created_at: string;
  tracking_events?: TrackingEvent[];
}

function isRealFezTrackingNumber(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  if (['error', 'cannot', 'failed', 'invalid'].some((w) => lower.includes(w))) return false;
  if (/^(FEZ|JLO|CR)(-\d+-[A-Z0-9]+|-[A-Z0-9]{6,10})$/i.test(value)) return false;
  return value.length > 5 && value.length < 30 && /^[A-Za-z0-9]+$/.test(value.trim());
}

export default function MobileManualShipmentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notification = useNotification();

  const [shipment, setShipment] = useState<ManualShipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetchingTracking, setFetchingTracking] = useState(false);
  const [riderOpen, setRiderOpen] = useState(false);
  const [riderId, setRiderId] = useState('');

  const fetchShipment = useCallback(async () => {
    if (!id) return;
    try {
      const response = await fetch(`${functionsBase}/manual-shipments/${id}`, { headers: await functionsAuthHeader() });
      const data = await response.json();
      if (data.success) setShipment(data.data);
      else notification.error('Not found', data.error || 'Manual shipment not found');
    } catch {
      notification.error('Error', 'Failed to load shipment');
    } finally {
      setLoading(false);
    }
  }, [id, notification]);

  useEffect(() => {
    fetchShipment();
  }, [fetchShipment]);

  const dispatchViaFez = async () => {
    if (!id) return;
    setDispatching(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipment-fez-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await functionsAuthHeader()) },
        body: JSON.stringify({ shipment_id: id }),
      });
      const data = await response.json();
      if (data.success) {
        notification.success('Dispatched via Fez', `Tracking: ${data.data.tracking_number}`);
        await fetchShipment();
      } else {
        notification.error('Dispatch Failed', data.message || data.error || 'Unable to dispatch via Fez');
      }
    } catch {
      notification.error('Error', 'Failed to dispatch via Fez');
    } finally {
      setDispatching(false);
    }
  };

  const assignRider = async () => {
    if (!id) return;
    setDispatching(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipment-assign-rider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await functionsAuthHeader()) },
        body: JSON.stringify({
          shipment_id: id,
          rider_id: riderId,
        }),
      });
      const data = await response.json();
      if (data.success) {
        notification.success('Rider assigned', 'Local rider saved for this shipment');
        setRiderOpen(false);
        setRiderId('');
        await fetchShipment();
      } else {
        notification.error('Assignment Failed', data.error || 'Unable to assign rider');
      }
    } catch {
      notification.error('Error', 'Failed to assign rider');
    } finally {
      setDispatching(false);
    }
  };

  const copyTracking = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notification.success('Copied', text);
    } catch {
      notification.error('Copy failed', 'Could not copy to clipboard');
    }
  };

  const printWaybill = async () => {
    if (!id) return;
    try {
      await openWaybillPrint({ shipmentId: id });
    } catch (err) {
      notification.error('Waybill failed', err instanceof Error ? err.message : 'Could not open waybill');
    }
  };

  const printLabel = async () => {
    if (!id) return;
    try {
      await openLabelPrint({ shipmentId: id });
    } catch (err) {
      notification.error('Label failed', err instanceof Error ? err.message : 'Could not open label');
    }
  };

  const fetchLiveTracking = async () => {
    if (!id) return;
    setFetchingTracking(true);
    try {
      const response = await fetch(
        `${functionsBase}/fez-fetch-tracking?shipmentId=${encodeURIComponent(id)}`,
        { headers: await functionsAuthHeader() },
      );
      const data = await response.json();
      if (data.success) {
        notification.success('Tracking updated', data.data.fez_status || data.data.status || 'Updated');
        await fetchShipment();
      } else {
        notification.error('Tracking failed', data.error || data.message || 'Unable to fetch tracking');
      }
    } catch {
      notification.error('Error', 'Failed to fetch live tracking');
    } finally {
      setFetchingTracking(false);
    }
  };

  const deleteShipment = async () => {
    if (!id || !shipment) return;
    if (!window.confirm(`Delete ${shipment.shipment_code}? This cannot be undone.`)) return;

    setDeleting(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipments/${id}`, {
        method: 'DELETE',
        headers: await functionsAuthHeader(),
      });
      const data = await response.json();
      if (data.success) {
        notification.success('Deleted', `${shipment.shipment_code} removed`);
        navigate('/admin/manual-shipments');
      } else {
        notification.error('Delete failed', data.error || 'Unable to delete manual shipment');
      }
    } catch {
      notification.error('Error', 'Failed to delete manual shipment');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader className="h-6 w-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!shipment) {
    return <div className="p-4 text-sm text-gray-500">Manual shipment not found.</div>;
  }

  const dispatched = !!(shipment.tracking_number || shipment.delivery_person_name);
  const canDelete = !dispatched;
  const fezTracking = isRealFezTrackingNumber(shipment.tracking_number) ? shipment.tracking_number : null;
  const events = shipment.tracking_events || [];
  const laneLabel =
    shipment.metadata?.selected_lane === 'local_rider' || shipment.delivery_person_name ? 'Local rider' : 'Fez';

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2.5 border-b border-gray-100 bg-white px-3 py-2.5">
        <button type="button" onClick={() => navigate('/admin/manual-shipments')} className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-gray-900">{shipment.shipment_code}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusStyle(shipment.status)}`}>
              {statusLabel(shipment.status)}
            </span>
          </div>
          <p className="truncate text-[11px] text-gray-400">
            {laneLabel} · {new Date(shipment.created_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
          </p>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={deleteShipment}
            disabled={deleting}
            aria-label="Delete manual shipment"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-200 text-red-600 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex-1 pb-4" style={{ paddingBottom: dispatched ? `calc(88px + ${TABBAR_SPACE})` : TABBAR_SPACE }}>
        <div className="border-b border-gray-100 bg-white px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Deliver to</p>
          <p className="mt-0.5 text-xl font-bold text-gray-900">{shipment.recipient.name}</p>
          <p className="mt-1 text-sm text-gray-600">{shipment.recipient.address}</p>
          <p className="text-sm text-gray-500">
            {shipment.recipient.city}, {shipment.recipient.state}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-1 font-medium">{shipment.sender.city || 'Origin'}</span>
            <ArrowRight className="h-3 w-3 text-gray-300" />
            <span className="rounded-full bg-primary-50 px-2 py-1 font-medium text-primary-700">{shipment.recipient.city}</span>
          </div>
        </div>

        {dispatched ? (
          <>
            <SectionLabel>Tracking</SectionLabel>
            <div className="mx-4 divide-y divide-gray-100 overflow-hidden rounded-xl bg-white">
              <DetailRow label="Courier" value={laneLabel} />
              {shipment.tracking_number && (
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="text-sm text-gray-500">Tracking no.</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-gray-900">{shipment.tracking_number}</span>
                    <button type="button" aria-label="Copy tracking" className="text-gray-400" onClick={() => copyTracking(shipment.tracking_number!)}>
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
              {shipment.delivery_person_name && (
                <DetailRow label="Rider" value={`${shipment.delivery_person_name}${shipment.delivery_person_phone ? ` · ${shipment.delivery_person_phone}` : ''}`} />
              )}
              {shipment.waybill_number && <DetailRow label="Waybill" value={shipment.waybill_number} mono />}
              {shipment.courier_tracking_url && (
                <a href={shipment.courier_tracking_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3.5 active:bg-gray-50">
                  <ExternalLink className="h-4 w-4 shrink-0 text-primary-600" />
                  <span className="flex-1 text-sm font-medium text-primary-600">Track on Fez</span>
                  <ArrowRight className="h-4 w-4 text-gray-300" />
                </a>
              )}
              {fezTracking && (
                <button
                  type="button"
                  disabled={fetchingTracking}
                  onClick={fetchLiveTracking}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-gray-50 disabled:opacity-50"
                >
                  {fetchingTracking ? (
                    <Loader className="h-4 w-4 shrink-0 animate-spin text-primary-600" />
                  ) : (
                    <RefreshCw className="h-4 w-4 shrink-0 text-primary-600" />
                  )}
                  <span className="flex-1 text-sm font-medium text-primary-600">
                    {fetchingTracking ? 'Updating…' : 'Update tracking'}
                  </span>
                </button>
              )}
              {shipment.last_tracking_update && (
                <DetailRow
                  label="Last update"
                  value={new Date(shipment.last_tracking_update).toLocaleString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                />
              )}
            </div>

            <div className="mx-4 mt-3">
              <ShipmentTrackingEvents
                events={events}
                title="Tracking updates"
                emptyMessage="No events yet. Tap Update tracking or wait for courier updates."
              />
            </div>
          </>
        ) : (
          <>
            <SectionLabel>Dispatch</SectionLabel>
            <div className="mx-4 overflow-hidden rounded-xl bg-white p-4">
              <p className="text-sm text-gray-600">Ready to send — choose a lane.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={dispatching}
                  onClick={dispatchViaFez}
                  className="flex flex-col items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-4 disabled:opacity-50"
                >
                  <Send className="h-5 w-5 text-primary-600" />
                  <span className="text-xs font-semibold text-primary-700">{dispatching ? 'Sending…' : 'Send to Fez'}</span>
                </button>
                <button
                  type="button"
                  disabled={dispatching}
                  onClick={() => setRiderOpen(true)}
                  className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 disabled:opacity-50"
                >
                  <Truck className="h-5 w-5 text-gray-600" />
                  <span className="text-xs font-semibold text-gray-700">Local rider</span>
                </button>
              </div>
            </div>
          </>
        )}

        <SectionLabel>Package</SectionLabel>
        <div className="mx-4 overflow-hidden rounded-xl bg-white">
          <div className="flex gap-3 px-4 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50">
              <Package className="h-4 w-4 text-orange-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{shipment.item_description}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {shipment.item_weight} kg · {formatNaira(shipment.item_value)}
              </p>
            </div>
          </div>
        </div>

        <ContactSection
          title="Recipient"
          name={shipment.recipient.name}
          lines={[
            shipment.recipient.address,
            `${shipment.recipient.city}, ${shipment.recipient.state}`,
            ...(shipment.recipient.email ? [shipment.recipient.email] : []),
          ]}
          phone={shipment.recipient.phone}
        />

        <ContactSection
          title="Sender"
          name={shipment.sender.name}
          lines={[shipment.sender.address, `${shipment.sender.city}, ${shipment.sender.state}`]}
          phone={shipment.sender.phone}
        />
      </div>

      {dispatched && (
        <div className="fixed inset-x-0 z-20 border-t border-gray-100 bg-white px-4 py-3" style={{ bottom: TABBAR_SPACE }}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={printLabel}
              className="flex items-center justify-center gap-2 rounded-xl bg-gray-900 py-3.5 text-sm font-semibold text-white"
            >
              <Tag className="h-4 w-4" />
              Print label
            </button>
            <button
              type="button"
              onClick={printWaybill}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
            >
              <Download className="h-4 w-4" />
              Waybill
            </button>
          </div>
        </div>
      )}

      <Sheet open={riderOpen} onClose={() => setRiderOpen(false)} ariaLabel="Assign rider">
        <h3 className="text-lg font-bold text-gray-900">Assign local rider</h3>
        <div className="mt-4 space-y-3">
          <RiderPicker value={riderId} onChange={setRiderId} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setRiderOpen(false)} className="rounded-lg border border-gray-200 py-3 text-sm font-semibold text-gray-900">
            Cancel
          </button>
          <button
            type="button"
            onClick={assignRider}
            disabled={!riderId || dispatching}
            className="rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {dispatching ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
