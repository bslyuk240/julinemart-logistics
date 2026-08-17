import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Check, MapPin, Package, Phone, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, Job } from '../lib/api';
import { uploadRiderDocument } from '../lib/storage';
import { Scanner } from '../components/Scanner';

const STEPS: { status: Job['status']; label: string }[] = [
  { status: 'assigned', label: 'Accepted' },
  { status: 'picked_up', label: 'Picked up' },
  { status: 'out_for_delivery', label: 'En route' },
  { status: 'delivered', label: 'Delivered' },
];

const NEXT_STATUS: Record<string, Job['status']> = {
  assigned: 'picked_up',
  picked_up: 'out_for_delivery',
  out_for_delivery: 'delivered',
};

const ACTION_LABEL: Record<string, string> = {
  assigned: 'Mark picked up',
  picked_up: 'Start delivery',
  out_for_delivery: 'Confirm delivered',
};

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
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

  const currentStepIndex = job ? STEPS.findIndex((s) => s.status === job.status) : 0;

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
        <RefreshCw className="w-6 h-6 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="min-h-screen pb-32">
      <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100">
        <p className="text-xs text-gray-500">{user?.email}</p>
        <h1 className="text-lg font-bold text-gray-900 mt-1">{job.tracking_number || `Order ${job.order_number ?? ''}`}</h1>
        <p className="text-sm text-primary-600 font-semibold mt-1">{formatNaira(job.fee)}</p>

        <div className="mt-6 flex items-center">
          {STEPS.slice(1).map((step, i) => {
            const idx = i + 1;
            const reached = idx <= Math.max(currentStepIndex, 0);
            return (
              <div key={step.status} className="flex-1 flex items-center">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      reached ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {reached ? <Check className="w-3.5 h-3.5" /> : idx}
                  </div>
                  <span className={`text-[10px] font-medium ${reached ? 'text-gray-900' : 'text-gray-400'}`}>{step.label}</span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 -mt-4 ${idx < currentStepIndex ? 'bg-primary-600' : 'bg-gray-100'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="px-6 pt-6 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="rounded-2xl border border-gray-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Pickup</p>
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 mt-0.5 text-primary-600 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-gray-900">{job.pickup.name || 'JulineMart'}</p>
              <p className="text-gray-600 mt-0.5">{job.pickup.address || '—'}</p>
              <p className="text-gray-400">{[job.pickup.city, job.pickup.state].filter(Boolean).join(', ')}</p>
            </div>
          </div>
          {job.pickup.phone && (
            <a href={`tel:${job.pickup.phone}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600">
              <Phone className="w-3.5 h-3.5" /> {job.pickup.phone}
            </a>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Drop-off</p>
          <div className="flex items-start gap-2">
            <Package className="w-4 h-4 mt-0.5 text-primary-600 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-gray-900">{job.dropoff.customer_name || 'Customer'}</p>
              <p className="text-gray-600 mt-0.5">{job.dropoff.address || '—'}</p>
              <p className="text-gray-400">
                {[job.dropoff.landmark, job.dropoff.city, job.dropoff.state].filter(Boolean).join(', ')}
              </p>
            </div>
          </div>
          {job.dropoff.customer_phone && (
            <a href={`tel:${job.dropoff.customer_phone}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600">
              <Phone className="w-3.5 h-3.5" /> {job.dropoff.customer_phone}
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
