import { ArrowLeft, Download, ExternalLink, Loader, RefreshCw, Send, Tag, Trash2, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../contexts/AuthContext';
import { openLabelPrint, openWaybillPrint } from '../lib/waybillPrint';

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
  const [riderInfo, setRiderInfo] = useState({ name: '', phone: '', vehicle: '' });

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
          rider_name: riderInfo.name.trim(),
          rider_phone: riderInfo.phone.trim(),
          rider_vehicle: riderInfo.vehicle || null,
        }),
      });
      const data = await response.json();
      if (data.success) {
        notification.success('Rider Assigned', riderInfo.name);
        setShowRiderModal(false);
        setRiderInfo({ name: '', phone: '', vehicle: '' });
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

      {!dispatched ? (
        <div className="card">
          <h2 className="text-lg font-semibold mb-4">Dispatch</h2>
          <div className="flex gap-3">
            <button onClick={dispatchViaFez} disabled={dispatching} className="btn-primary flex items-center disabled:opacity-50">
              <Send className="w-4 h-4 mr-2" />
              {dispatching ? 'Sending…' : 'Send to Fez'}
            </button>
            <button onClick={() => setShowRiderModal(true)} disabled={dispatching} className="btn-secondary flex items-center disabled:opacity-50">
              <Truck className="w-4 h-4 mr-2" />
              Assign Local Rider
            </button>
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

          {events.length > 0 && (
            <div className="pt-4 border-t mt-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Status History</h3>
              <div className="space-y-3">
                {[...events].reverse().map((event, idx) => (
                  <div key={`${event.timestamp}-${idx}`} className="flex gap-3 text-sm">
                    <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${idx === 0 ? 'bg-primary-600' : 'bg-gray-300'}`} />
                    <div>
                      <p className="font-medium text-gray-900">{event.status.replace(/_/g, ' ')}</p>
                      {event.description && <p className="text-gray-600">{event.description}</p>}
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showRiderModal && (
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
                onClick={() => {
                  setShowRiderModal(false);
                  setRiderInfo({ name: '', phone: '', vehicle: '' });
                }}
                className="flex-1 px-4 py-2 border rounded hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={assignRider}
                disabled={!riderInfo.name || !riderInfo.phone || dispatching}
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
