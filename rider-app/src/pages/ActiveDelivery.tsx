import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Building2, Camera, Check, Navigation, PenLine, Phone, ScanLine, User, X, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, Job, pickupLabel, PROBLEM_REASON_LABEL, ProblemReason, ScanVerification } from '../lib/api';
import { uploadRiderDocument } from '../lib/storage';
import { Scanner } from '../components/Scanner';
import { SignaturePad } from '../components/SignaturePad';

// verify_scan reports short codes (see rider-jobs.js), not sentences — the
// server's own `message` for these is already rider-friendly, but the
// shared request() helper only surfaces `error`, so translate here to keep
// that helper's contract (used by other screens that key off the raw code).
const SCAN_ERROR_MESSAGE: Record<string, string> = {
  wrong_package: "This isn't your assigned shipment.",
  already_collected: 'This package has already been collected.',
  not_accepted: 'Accept the job before scanning for pickup.',
  empty_scan: 'Scan the label on this package to confirm pickup.',
  not_your_job: "This shipment isn't assigned to you.",
};

const ADVANCE_ERROR_MESSAGE: Record<string, string> = {
  signature_required: 'A customer signature is required to confirm delivery for this order.',
};

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
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [showSignaturePad, setShowSignaturePad] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [scanResult, setScanResult] = useState<ScanVerification | null>(null);
  const [scanFailure, setScanFailure] = useState<string | null>(null);
  const [confirmingPickup, setConfirmingPickup] = useState(false);
  const [manualCodeOpen, setManualCodeOpen] = useState(false);
  const [manualCodeValue, setManualCodeValue] = useState('');
  const lastScannedCode = useRef('');
  const [showProblemSheet, setShowProblemSheet] = useState(false);
  const [problemReason, setProblemReason] = useState<ProblemReason | ''>('');
  const [problemNote, setProblemNote] = useState('');
  const [reportingProblem, setReportingProblem] = useState(false);
  const [problemReported, setProblemReported] = useState(false);
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

    // High-value orders (job.pod_level from services/shipmentSummary.js's
    // POD_VERIFIED_THRESHOLD_NGN) need a customer signature in addition to
    // the photo — the server enforces this independently, this is just the
    // client-side prompt so the rider isn't surprised by a rejected submit.
    if (targetStatus === 'delivered' && job.pod_level === 'verified' && !signatureFile) {
      setShowSignaturePad(true);
      return;
    }

    setAdvancing(true);
    setError(null);
    try {
      let proofUrl: string | undefined;
      let signatureUrl: string | undefined;
      if (targetStatus === 'delivered' && proofFile && user) {
        setUploadingProof(true);
        proofUrl = await uploadRiderDocument(user.id, proofFile, 'delivery_proof');
        if (signatureFile) signatureUrl = await uploadRiderDocument(user.id, signatureFile, 'delivery_signature');
        setUploadingProof(false);
      }
      await api.advanceJob(job.id, targetStatus, { delivery_proof_url: proofUrl, signature_url: signatureUrl });
      if (targetStatus === 'delivered') {
        navigate('/', { replace: true });
      } else {
        await load();
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(ADVANCE_ERROR_MESSAGE[code] || (err instanceof Error ? err.message : 'Could not update status'));
    } finally {
      setAdvancing(false);
      setUploadingProof(false);
    }
  };

  const handleReportProblem = async () => {
    if (!job || !problemReason) return;
    setReportingProblem(true);
    setError(null);
    try {
      await api.reportProblem(job.id, problemReason, problemNote.trim() || undefined);
      setShowProblemSheet(false);
      setProblemReason('');
      setProblemNote('');
      setProblemReported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not report the problem');
    } finally {
      setReportingProblem(false);
    }
  };

  const verifyCode = async (code: string) => {
    if (!job) return;
    lastScannedCode.current = code;
    setShowScanner(false);
    setManualCodeOpen(false);
    setScanResult(null);
    setScanFailure(null);
    setVerifying(true);
    try {
      const result = await api.verifyScan(job.id, code);
      setScanResult(result);
    } catch (err) {
      const code2 = err instanceof Error ? err.message : '';
      setScanFailure(SCAN_ERROR_MESSAGE[code2] || 'Could not verify this package.');
    } finally {
      setVerifying(false);
    }
  };

  const handleConfirmPickup = async () => {
    if (!job || !lastScannedCode.current) return;
    setConfirmingPickup(true);
    setError(null);
    try {
      await api.advanceJob(job.id, 'picked_up', { scanned_code: lastScannedCode.current });
      setScanResult(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm pickup');
    } finally {
      setConfirmingPickup(false);
    }
  };

  const closeScanFlow = () => {
    setScanResult(null);
    setScanFailure(null);
    setManualCodeOpen(false);
    setManualCodeValue('');
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
        {problemReported && <p className="text-sm text-emerald-600">Problem reported — dispatch has been notified.</p>}

        {/* Deliver to (dropoff) */}
        <div className="rounded-2xl border border-gray-200 p-4">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-primary-600" />
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Deliver to</p>
              <p className="text-sm font-semibold text-gray-900 mt-0.5">{job.dropoff.customer_name || 'Customer'}</p>
              <p className="text-sm text-gray-600 mt-0.5">{job.dropoff.address || '—'}</p>
              <p className="text-xs text-gray-400">{[job.dropoff.landmark, job.dropoff.city, job.dropoff.state].filter(Boolean).join(', ')}</p>
            </div>
            {job.dropoff.customer_phone && (
              <a
                href={`tel:${job.dropoff.customer_phone}`}
                className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center shrink-0 text-primary-600"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* From (pickup) */}
        <div className="rounded-2xl border border-gray-200 p-4">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-primary-600" />
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">From</p>
              <p className="text-sm font-semibold text-gray-900 mt-0.5">{job.pickup.name || 'JulineMart'}</p>
              <p className="text-sm text-gray-600 mt-0.5">{job.pickup.address || '—'}</p>
              <p className="text-xs text-gray-400">{[job.pickup.city, job.pickup.state].filter(Boolean).join(', ')}</p>
            </div>
            {job.pickup.phone && (
              <a
                href={`tel:${job.pickup.phone}`}
                className="w-9 h-9 rounded-full border border-gray-200 flex items-center justify-center shrink-0 text-primary-600"
              >
                <Phone className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>

        {/* Waybill status */}
        {job.tracking_number && (
          <div className="rounded-2xl border border-gray-200 p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Waybill {job.tracking_number}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {currentStepIndex >= 1 ? '1 of 1 package' : 'Not yet collected'}
              </p>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                currentStepIndex >= 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {currentStepIndex >= 1 ? 'Verified' : 'Pending scan'}
            </span>
          </div>
        )}

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
                <div className="flex-1 flex items-center justify-between pb-4 -mt-0.5">
                  <p className={`text-sm ${reached ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{step.label}</p>
                  {time && <p className="text-[11px] text-gray-400">{time}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Navigate / Call / Report action row */}
        <div className="flex gap-2">
          <a
            href={navTarget}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl border border-gray-200 py-2.5 text-[11px] font-semibold text-gray-700 bg-white"
          >
            <Navigation className="w-4 h-4" />
            Navigate
          </a>
          {(headingToPickup ? job.pickup.phone : job.dropoff.customer_phone) && (
            <a
              href={`tel:${headingToPickup ? job.pickup.phone : job.dropoff.customer_phone}`}
              className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl border border-gray-200 py-2.5 text-[11px] font-semibold text-gray-700 bg-white"
            >
              <Phone className="w-4 h-4" />
              Call {headingToPickup ? pickupLabel(job.pickup.kind) : 'Customer'}
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowProblemSheet(true)}
            className="flex-1 flex flex-col items-center justify-center gap-1 rounded-xl border border-gray-200 py-2.5 text-[11px] font-semibold text-red-600 bg-white"
          >
            <AlertTriangle className="w-4 h-4" />
            Report Problem
          </button>
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

        {job.status === 'out_for_delivery' && job.pod_level === 'verified' && (
          <div className="rounded-2xl border border-dashed border-gray-300 p-4 text-center">
            {signatureFile ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-900">
                <Check className="w-4 h-4 text-primary-600" />
                Customer signature captured
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSignaturePad(true)}
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600"
              >
                <PenLine className="w-4 h-4" />
                Get customer signature
              </button>
            )}
            <p className="mt-1 text-[11px] text-gray-400">Required for this order's value</p>
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

      {showSignaturePad && (
        <SignaturePad
          title="Customer signature"
          hint="Hand your phone to the customer to sign below"
          onCapture={(file) => {
            setSignatureFile(file);
            setShowSignaturePad(false);
          }}
          onClose={() => setShowSignaturePad(false)}
        />
      )}

      {showScanner && (
        <Scanner
          title="Scan to confirm pickup"
          hint="Point the camera at the QR code on this package's label"
          onDetect={verifyCode}
          onClose={() => setShowScanner(false)}
        />
      )}

      {verifying && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-medium text-gray-700">Verifying package…</span>
          </div>
        </div>
      )}

      {scanResult && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-6 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <Check className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Package verified</p>
                {scanResult.tracking_number && <p className="text-xs text-gray-500">{scanResult.tracking_number}</p>}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 divide-y divide-gray-100">
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-gray-500">Assigned to</span>
                <span className="text-xs font-semibold text-gray-900">{scanResult.rider_name}</span>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-gray-500">Custody transfer</span>
                <span className="text-xs font-semibold text-gray-900">
                  {scanResult.from_custodian} → {scanResult.to_custodian}
                </span>
              </div>
              {scanResult.pickup_name && (
                <div className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-xs text-gray-500">From</span>
                  <span className="text-xs font-semibold text-gray-900">{scanResult.pickup_name}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleConfirmPickup}
              disabled={confirmingPickup}
              className="mt-4 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {confirmingPickup ? 'Confirming…' : 'Confirm Pickup'}
            </button>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  closeScanFlow();
                  setShowScanner(true);
                }}
                disabled={confirmingPickup}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 disabled:opacity-50"
              >
                <ScanLine className="w-3.5 h-3.5" />
                Scan Again
              </button>
              <button
                type="button"
                onClick={() => {
                  setScanResult(null);
                  setManualCodeOpen(true);
                }}
                disabled={confirmingPickup}
                className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 disabled:opacity-50"
              >
                Manual Code
              </button>
            </div>
          </div>
        </div>
      )}

      {scanFailure && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-6 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <p className="text-sm font-semibold text-gray-900">{scanFailure}</p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={closeScanFlow}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  closeScanFlow();
                  setShowScanner(true);
                }}
                className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white"
              >
                Scan Again
              </button>
            </div>
          </div>
        </div>
      )}

      {manualCodeOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-6 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-900">Enter waybill code</h3>
              <button type="button" onClick={closeScanFlow} className="text-gray-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              className="field-input"
              value={manualCodeValue}
              onChange={(e) => setManualCodeValue(e.target.value)}
              placeholder="Tracking number"
              autoFocus
            />
            <button
              type="button"
              onClick={() => manualCodeValue.trim() && verifyCode(manualCodeValue.trim())}
              disabled={!manualCodeValue.trim()}
              className="mt-3 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              Verify
            </button>
          </div>
        </div>
      )}

      {showProblemSheet && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-6 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-bold text-gray-900">Report a problem</h3>
            <p className="mt-1 text-sm text-gray-500">This lets dispatch know right away — it doesn't change your delivery status.</p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {(Object.keys(PROBLEM_REASON_LABEL) as ProblemReason[]).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setProblemReason(reason)}
                  className={`rounded-xl border py-2.5 px-2 text-xs font-semibold ${
                    problemReason === reason ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {PROBLEM_REASON_LABEL[reason]}
                </button>
              ))}
            </div>

            <textarea
              value={problemNote}
              onChange={(e) => setProblemNote(e.target.value)}
              placeholder="Add a note (optional)"
              rows={2}
              className="mt-3 w-full rounded-xl border border-gray-200 p-3 text-sm"
            />

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowProblemSheet(false)}
                disabled={reportingProblem}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReportProblem}
                disabled={!problemReason || reportingProblem}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {reportingProblem ? 'Reporting…' : 'Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
