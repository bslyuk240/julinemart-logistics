import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, Check, Navigation, Phone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, Job } from '../lib/api';
import { uploadRiderDocument } from '../lib/storage';
import { Scanner } from '../components/Scanner';

const TIMELINE: { status: Job['status']; label: string; at: (job: Job) => string | null }[] = [
  { status: 'assigned', label: 'Assigned', at: (job) => job.assigned_at },
  { status: 'picked_up', label: 'Package collected', at: (job) => job.picked_up_at },
  { status: 'out_for_delivery', label: 'Out for delivery', at: (job) => job.out_for_delivery_at },
  { status: 'delivered', label: 'Delivered', at: (job) => job.delivered_at },
];

const NEXT_STATUS: Record<string, Job['status']> = {
  assigned: 'picked_up',
  picked_up: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

const ACTION_LABEL: Record<string, string> = {
  assigned: 'Scan Waybill',
  picked_up: 'Start Delivery',
  out_for_delivery: "I've Reached the Customer",
};

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function formatTime(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
}

// External handoff, not an in-app map — the rider's own maps app already
// knows how to route them, and building turn-by-turn here would just be a
// worse version of something their phone already does well.
function mapsUrl(address: string | null, city: string | null, state: string | null) {
  const query = [address, city, state].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

export default function ActiveDelivery() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getJobs();
      setJob(data.active);
      if (!data.active) navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load delivery');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  // Location is only ever tracked while this screen is mounted, i.e. while
  // the rider has an accepted, in-progress delivery — never while idle on
  // Home. The server independently enforces the same rule (rider-location-
  // ping.js rejects pings with no active assignment), so a stray watcher
  // here can't leak location data even if this effect misbehaves.
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !('geolocation' in navigator)) return;

    let lastPingAt = 0;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastPingAt < 20000) return;
        lastPingAt = now;
        api.pingLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy).catch(() => {});
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [jobId]);

  const currentStepIndex = job ? TIMELINE.findIndex((s) => s.status === job.status) : 0;
  const headingToPickup = job?.status === 'assigned';

  const handleAdvance = async () => {
    if (!job) return;
    const targetStatus = NEXT_STATUS[job.status];
    if (!targetStatus) return;

    // Pickup is confirmed by scanning the package's label, not a plain tap —
    // see handleScanDetect for the actual advance call.
    if (targetStatus === 'picked_up') {
      setError(null);
      setShowScanner(true);
      return;
    }

    if (targetStatus === 'delivered' && !proofFile) {
      fileInputRef.current?.click();
      return;
    }

    setAdvancing(true);
    setError(null);
    try {
      let proofUrl: string | undefined;
      if (targetStatus === 'delivered' && proofFile && user) {
        setUploadingProof(true);
        proofUrl = await uploadRiderDocument(user.id, proofFile, 'delivery_proof');
        setUploadingProof(false);
      }
      await api.advanceJob(job.id, targetStatus, { delivery_proof_url: proofUrl });
      if (targetStatus === 'delivered') {
        navigate('/', { replace: true });
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status');
    } finally {
      setAdvancing(false);
      setUploadingProof(false);
    }
  };

  const handleScanDetect = async (code: string) => {
    if (!job) return;
    setShowScanner(false);
    setAdvancing(true);
    setError(null);
    try {
      await api.advanceJob(job.id, 'picked_up', { scanned_code: code });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm pickup');
    } finally {
      setAdvancing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!job) return null;

  const navTarget = headingToPickup
    ? mapsUrl(job.pickup.address, job.pickup.city, job.pickup.state)
    : mapsUrl(job.dropoff.address, job.dropoff.city, job.dropoff.state);

  return (
    <div className="min-h-screen pb-32 bg-gray-50">
      <div className="px-6 pt-4 pb-4 bg-white border-b border-gray-100 flex items-center gap-3">
        <button type="button" onClick={() => navigate('/')} className="text-gray-400">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-bold text-gray-900">{job.tracking_number || `Order ${job.order_number ?? ''}`}</h1>
          <p className="text-xs font-semibold text-primary-600">{formatNaira(job.fee)}</p>
        </div>
      </div>

      <div className="px-6 pt-5 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Timeline */}
        <div className="rounded-2xl border border-gray-200 p-4">
          {TIMELINE.map((step, i) => {
            const reached = i <= Math.max(currentStepIndex, 0);
            const isCurrent = i === currentStepIndex;
            const time = formatTime(step.at(job));
            return (
              <div key={step.status} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                      reached ? (isCurrent ? 'bg-primary-600' : 'bg-emerald-500') : 'bg-gray-200'
                    }`}
                  >
                    {reached && !isCurrent && <Check className="w-3 h-3 text-white" />}
                  </div>
                  {i < TIMELINE.length - 1 && <div className={`w-0.5 flex-1 min-h-[20px] ${reached ? 'bg-emerald-500' : 'bg-gray-200'}`} />}
                </div>
                <div className="pb-4 -mt-0.5">
                  <p className={`text-sm ${reached ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{step.label}</p>
                  {time && <p className="text-[11px] text-gray-400">{time}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* From (pickup) */}
        <div className="rounded-2xl border border-gray-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">From</p>
          <p className="text-sm font-semibold text-gray-900">{job.pickup.name || 'JulineMart'}</p>
          <p className="text-sm text-gray-600 mt-0.5">{job.pickup.address || '—'}</p>
          <p className="text-xs text-gray-400">{[job.pickup.city, job.pickup.state].filter(Boolean).join(', ')}</p>
          {job.pickup.phone && (
            <a href={`tel:${job.pickup.phone}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600">
              <Phone className="w-3.5 h-3.5" /> {job.pickup.phone}
            </a>
          )}
        </div>

        {/* Deliver to (dropoff) */}
        <div className="rounded-2xl border border-gray-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Deliver to</p>
          <p className="text-sm font-semibold text-gray-900">{job.dropoff.customer_name || 'Customer'}</p>
          <p className="text-sm text-gray-600 mt-0.5">{job.dropoff.address || '—'}</p>
          <p className="text-xs text-gray-400">{[job.dropoff.landmark, job.dropoff.city, job.dropoff.state].filter(Boolean).join(', ')}</p>
          {job.dropoff.customer_phone && (
            <a href={`tel:${job.dropoff.customer_phone}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600">
              <Phone className="w-3.5 h-3.5" /> {job.dropoff.customer_phone}
            </a>
          )}
        </div>

        {/* Navigate / Call action row */}
        <div className="flex gap-2">
          <a
            href={navTarget}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 bg-white"
          >
            <Navigation className="w-4 h-4" />
            Navigate to {headingToPickup ? 'Pickup' : 'Customer'}
          </a>
          {(headingToPickup ? job.pickup.phone : job.dropoff.customer_phone) && (
            <a
              href={`tel:${headingToPickup ? job.pickup.phone : job.dropoff.customer_phone}`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-700 bg-white"
            >
              <Phone className="w-4 h-4" />
              Call {headingToPickup ? 'Vendor' : 'Customer'}
            </a>
          )}
        </div>

        {job.status === 'out_for_delivery' && (
          <div className="rounded-2xl border border-dashed border-gray-300 p-4 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setProofFile(e.target.files?.[0] || null)}
            />
            {proofFile ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-900">
                <Check className="w-4 h-4 text-primary-600" />
                Delivery photo ready
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600"
              >
                <Camera className="w-4 h-4" />
                Take delivery photo
              </button>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-6 py-4 bg-white border-t border-gray-100">
        <button
          type="button"
          onClick={handleAdvance}
          disabled={advancing || (job.status === 'out_for_delivery' && uploadingProof)}
          className="btn-primary"
        >
          {advancing ? (uploadingProof ? 'Uploading photo…' : 'Saving…') : ACTION_LABEL[job.status] || 'Done'}
        </button>
      </div>

      {showScanner && (
        <Scanner
          title="Scan to confirm pickup"
          hint="Point the camera at the QR code on this package's label"
          onDetect={handleScanDetect}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  );
}
