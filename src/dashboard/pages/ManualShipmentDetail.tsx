import { ArrowLeft, Download, ExternalLink, Loader, RefreshCw, Send, Tag, Trash2, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../contexts/AuthContext';
import { openLabelPrint, openWaybillPrint } from '../lib/waybillPrint';
import { ShipmentTrackingEvents } from '../../shared/ShipmentTrackingEvents';
import RiderPicker from '../components/RiderPicker';
import BroadcastToRidersButton from '../components/BroadcastToRidersButton';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

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
  delivery_proof_url?: string | null;
  signature_url?: string | null;
  last_tracking_update: string | null;
  metadata: { selected_lane?: 'fez' | 'local_rider'; rider_leg?: 'to_hub' | null } | null;
  destination_hub_id: string | null;
  sender_hub_id: string | null;
  created_at: string;
  tracking_events?: TrackingEvent[];
}

interface Hub {
  id: string;
  name: string;
  city?: string | null;
}

function isRealFezTrackingNumber(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  if (['error', 'cannot', 'failed', 'invalid'].some((w) => lower.includes(w))) return false;
  if (/^(FEZ|JLO|CR)(-\d+-[A-Z0-9]+|-[A-Z0-9]{6,10})$/i.test(value)) return false;
  return value.length > 5 && value.length < 30 && /^[A-Za-z0-9]+$/.test(value.trim());
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    assigned: 'bg-blue-100 text-blue-800',
    pending_pickup: 'bg-indigo-100 text-indigo-800',
    picked_up: 'bg-indigo-100 text-indigo-800',
    in_transit: 'bg-purple-100 text-purple-800',
    out_for_delivery: 'bg-orange-100 text-orange-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    returned: 'bg-gray-100 text-gray-800',
  };
  return map[status] ?? 'bg-gray-100 text-gray-700';
}

export function ManualShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const notification = useNotification();

  const [shipment, setShipment] = useState<ManualShipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fetchingTracking, setFetchingTracking] = useState(false);
  const [showRiderModal, setShowRiderModal] = useState(false);
  const [riderId, setRiderId] = useState('');
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [destinationHubId, setDestinationHubId] = useState('');
  const [savingHub, setSavingHub] = useState(false);

  const fetchShipment = async () => {
    try {
      const response = await fetch(`${functionsBase}/manual-shipments/${id}`, { headers: await authHeader() });
      const data = await response.json();
      if (data.success) setShipment(data.data);
      else notification.error('Not found', data.error || 'Manual shipment not found');
    } catch (error) {
      console.error('Fetch manual shipment error:', error);
      notification.error('Error', 'Failed to load shipment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShipment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${functionsBase}/hubs`);
        const data = await res.json();
        if (data.success) setHubs(((data.data || []) as Hub[]).filter((h: any) => h?.is_active !== false));
      } catch {
        /* non-fatal — destination-hub picker just stays empty */
      }
    })();
  }, []);

  useEffect(() => {
    setDestinationHubId(shipment?.destination_hub_id || '');
  }, [shipment?.destination_hub_id]);

  const saveDestinationHub = async () => {
    setSavingHub(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ destination_hub_id: destinationHubId || null }),
      });
      const data = await response.json();
      if (data.success) {
        notification.success('Saved', destinationHubId ? 'Destination hub set' : 'Destination hub cleared');
        fetchShipment();
      } else {
        notification.error('Save Failed', data.error || 'Unable to save destination hub');
      }
    } catch (error) {
      console.error('Save destination hub error:', error);
      notification.error('Error', 'Failed to save destination hub');
    } finally {
      setSavingHub(false);
    }
  };

  // Live refresh when a rider claims, accepts, declines, or the broadcast
  // otherwise changes state — so the dispatcher isn't stuck manually
  // refreshing to see if anyone took the job yet.
  useEffect(() => {
    if (!id) return;
    const channel = supabase.channel(`dispatch-manual-shipment-${id}`).on('broadcast', { event: 'updated' }, () => {
      fetchShipment();
    }).subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dispatchViaFez = async () => {
    setDispatching(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipment-fez-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ shipment_id: id }),
      });
      const data = await response.json();
      if (data.success) {
        notification.success('Dispatched via Fez', `Tracking: ${data.data.tracking_number}`);
        fetchShipment();
      } else {
        notification.error('Dispatch Failed', data.message || data.error || 'Unable to dispatch via Fez');
      }
    } catch (error) {
      console.error('Fez dispatch error:', error);
      notification.error('Error', 'Failed to dispatch via Fez');
    } finally {
      setDispatching(false);
    }
  };

  const assignRider = async () => {
    setDispatching(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipment-assign-rider`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          shipment_id: id,
          rider_id: riderId,
          ...(hubMode ? { destination: 'hub' } : {}),
        }),
      });
      const data = await response.json();
      if (data.success) {
        notification.success(
          'Rider Assigned',
          hubMode ? 'Rider will collect from the sender and drop at the destination hub' : 'Local rider saved for this shipment',
        );
        setShowRiderModal(false);
        setRiderId('');
        fetchShipment();
      } else {
        notification.error('Assignment Failed', data.error || 'Unable to assign rider');
      }
    } catch (error) {
      console.error('Assign rider error:', error);
      notification.error('Error', 'Failed to assign rider');
    } finally {
      setDispatching(false);
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
        { headers: await authHeader() },
      );
      const data = await response.json();
      if (data.success) {
        notification.success(
          'Tracking Updated',
          `Status: ${data.data.fez_status || data.data.status || 'Updated'}`,
        );
        await fetchShipment();
      } else {
        notification.error('Tracking Failed', data.error || data.message || 'Unable to fetch tracking');
      }
    } catch (error) {
      console.error('Manual shipment tracking error:', error);
      notification.error('Error', 'Failed to fetch live tracking');
    } finally {
      setFetchingTracking(false);
    }
  };

  const deleteShipment = async () => {
    if (!id || !shipment) return;
    if (
      !window.confirm(
        `Delete ${shipment.shipment_code}? This cannot be undone.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipments/${id}`, {
        method: 'DELETE',
        headers: await authHeader(),
      });
      const data = await response.json();
      if (data.success) {
        notification.success('Deleted', `${shipment.shipment_code} removed`);
        navigate('/admin/manual-shipments');
      } else {
        notification.error('Delete failed', data.error || 'Unable to delete manual shipment');
      }
    } catch (error) {
      console.error('Delete manual shipment error:', error);
      notification.error('Error', 'Failed to delete manual shipment');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (!shipment) return <div className="text-gray-500">Manual shipment not found.</div>;

  const dispatched = !!(shipment.tracking_number || shipment.delivery_person_name);
  // A destination hub being set always means "route this rider leg to the
  // hub" — no separate toggle to forget to check (that was the bug: staff
  // set a hub, broadcast/assign without also ticking a checkbox, and the
  // rider still saw the recipient as dropoff).
  const hubMode = Boolean(shipment.destination_hub_id);
  const canDelete = !dispatched;
  const fezTracking = isRealFezTrackingNumber(shipment.tracking_number) ? shipment.tracking_number : null;
  const events = shipment.tracking_events || [];

  return (
    <div>
      <button onClick={() => navigate('/admin/manual-shipments')} className="flex items-center text-sm text-gray-600 mb-4 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Manual Shipments
      </button>

      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{shipment.shipment_code}</h1>
          <p className="text-gray-600 text-sm mt-1">Created {new Date(shipment.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2">
          {canDelete && (
            <button
              type="button"
              onClick={deleteShipment}
              disabled={deleting}
              className="btn-secondary flex items-center text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${statusBadgeClass(shipment.status)}`}>
            {shipment.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">Sender</h2>
          <p className="font-medium text-gray-900">{shipment.sender?.name}</p>
          <p className="text-sm text-gray-600">{shipment.sender?.address}</p>
          <p className="text-sm text-gray-600">{shipment.sender?.city}{shipment.sender?.city ? ', ' : ''}{shipment.sender?.state}</p>
          <p className="text-sm text-gray-600 mt-1">{shipment.sender?.phone || 'N/A'}</p>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">Recipient</h2>
          <p className="font-medium text-gray-900">{shipment.recipient?.name}</p>
          <p className="text-sm text-gray-600">{shipment.recipient?.address}</p>
          <p className="text-sm text-gray-600">{shipment.recipient?.city}{shipment.recipient?.city ? ', ' : ''}{shipment.recipient?.state}</p>
          <p className="text-sm text-gray-600 mt-1">{shipment.recipient?.phone}</p>
          {shipment.recipient?.email && (
            <p className="text-sm text-gray-600 mt-1">{shipment.recipient.email}</p>
          )}
        </div>
      </div>

      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">Item</h2>
        <p className="text-gray-900">{shipment.item_description}</p>
        <p className="text-sm text-gray-600 mt-1">{shipment.item_weight}kg &middot; ₦{Number(shipment.item_value || 0).toLocaleString()}</p>
      </div>

      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase mb-2">Destination Hub</h2>
        <p className="text-xs text-gray-500 mb-2">
          Set this if a local rider should collect from the sender and drop off at a hub instead of
          delivering straight to the recipient — the item then continues via Fez (or another leg)
          from there.
          {shipment.sender_hub_id && ' The sender’s own hub is already the pickup point, so it’s not offered here as a destination.'}
        </p>
        <div className="flex gap-2">
          <select
            value={destinationHubId}
            onChange={(e) => setDestinationHubId(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">No destination hub</option>
            {hubs.filter((h) => h.id !== shipment.sender_hub_id).map((h) => (
              <option key={h.id} value={h.id}>{h.name}{h.city ? ` (${h.city})` : ''}</option>
            ))}
          </select>
          <button
            onClick={saveDestinationHub}
            disabled={savingHub || destinationHubId === (shipment.destination_hub_id || '')}
            className="btn-secondary text-sm px-3 disabled:opacity-50"
          >
            {savingHub ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {!dispatched ? (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Dispatch</h2>
          <div className="flex gap-3 items-center flex-wrap">
            <button onClick={dispatchViaFez} disabled={dispatching} className="btn-primary flex items-center disabled:opacity-50">
              <Send className="w-4 h-4 mr-2" />
              {dispatching ? 'Sending…' : 'Send to Fez'}
            </button>
            <button onClick={() => setShowRiderModal(true)} disabled={dispatching || shipment.status === 'broadcasting'} className="btn-secondary flex items-center disabled:opacity-50">
              <Truck className="w-4 h-4 mr-2" />
              Assign Local Rider
            </button>
            <BroadcastToRidersButton
              manualShipmentId={id}
              status={shipment.status}
              disabled={dispatching}
              destination={hubMode ? 'hub' : undefined}
              onChanged={fetchShipment}
            />
            {hubMode && (
              <span className="text-xs font-medium text-purple-700 bg-purple-50 rounded px-2 py-1">
                Hub collection mode — rider drops at the destination hub, not the recipient
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="card space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Tracking</h2>
            {shipment.last_tracking_update && (
              <span className="text-xs text-gray-500">
                Updated {new Date(shipment.last_tracking_update).toLocaleString()}
              </span>
            )}
          </div>
          {shipment.tracking_number && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Tracking Number</span>
              <span className="font-mono font-semibold">{shipment.tracking_number}</span>
            </div>
          )}
          {shipment.metadata?.selected_lane === 'local_rider' && shipment.delivery_person_name && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Local Rider</span>
              <span className="font-medium">{shipment.delivery_person_name} ({shipment.delivery_person_phone})</span>
            </div>
          )}
          {shipment.courier_tracking_url && (
            <a href={shipment.courier_tracking_url} target="_blank" rel="noreferrer" className="text-sm text-primary-600 hover:underline flex items-center">
              Track on Fez <ExternalLink className="w-3.5 h-3.5 ml-1" />
            </a>
          )}
          {shipment.waybill_number && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Waybill No</span>
              <span className="font-mono font-semibold">{shipment.waybill_number}</span>
            </div>
          )}

          {(shipment.delivery_proof_url || shipment.signature_url) && (
            <div className="grid grid-cols-2 gap-3">
              {shipment.delivery_proof_url && (
                <a href={shipment.delivery_proof_url} target="_blank" rel="noopener noreferrer" className="block">
                  <p className="text-xs font-semibold text-gray-500 mb-1">Proof of delivery</p>
                  <img
                    src={shipment.delivery_proof_url}
                    alt="Delivery proof"
                    className="w-full h-32 object-cover rounded-lg border border-gray-200 hover:opacity-90"
                  />
                </a>
              )}
              {shipment.signature_url && (
                <a href={shipment.signature_url} target="_blank" rel="noopener noreferrer" className="block">
                  <p className="text-xs font-semibold text-gray-500 mb-1">Customer signature</p>
                  <img
                    src={shipment.signature_url}
                    alt="Customer signature"
                    className="w-full h-32 object-contain rounded-lg border border-gray-200 bg-white hover:opacity-90"
                  />
                </a>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-2">
            {fezTracking && (
              <button
                type="button"
                onClick={fetchLiveTracking}
                disabled={fetchingTracking}
                className="btn-secondary flex items-center disabled:opacity-50"
              >
                {fetchingTracking ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Fetching…
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Update Tracking
                  </>
                )}
              </button>
            )}
            <button onClick={printLabel} className="btn-primary flex items-center">
              <Tag className="w-4 h-4 mr-2" />
              Print Label
            </button>
            <button onClick={printWaybill} className="btn-secondary flex items-center">
              <Download className="w-4 h-4 mr-2" />
              Download Waybill
            </button>
          </div>

          <ShipmentTrackingEvents
            events={events}
            title="Status history"
            emptyMessage="No tracking events yet. Use Update Tracking after dispatch, or wait for Fez webhook updates."
            className="border border-gray-100"
          />
        </div>
      )}

      {showRiderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-1">Assign Local Rider</h3>
            {hubMode && (
              <p className="text-xs text-purple-700 bg-purple-50 rounded px-2 py-1 mb-3">
                Hub collection mode — rider drops at the destination hub, not the recipient.
              </p>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Rider <span className="text-red-500">*</span></label>
                <RiderPicker value={riderId} onChange={setRiderId} />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => {
                  setShowRiderModal(false);
                  setRiderId('');
                }}
                className="flex-1 px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={assignRider}
                disabled={!riderId || dispatching}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {dispatching ? 'Assigning…' : 'Assign Rider'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
