import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, Lock, MapPin, Package, Power, RefreshCw, Users, Wallet, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { api, Job } from '../lib/api';
import { uploadRiderDocument } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { BottomNav } from '../components/BottomNav';
import { InstallPrompt } from '../components/InstallPrompt';
import { NotificationPrompt } from '../components/NotificationPrompt';
import ApplicationStatus from './ApplicationStatus';

// Mirrors netlify/functions/services/riderRealtime.js's channel naming —
// must stay in sync so the client subscribes to the same channel names
// the backend broadcasts to.
function normalizeChannelPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function riderAreaChannelName(city: string, state: string) {
  return `rider-area-${normalizeChannelPart(state)}-${normalizeChannelPart(city)}`;
}
function riderChannelName(riderId: string) {
  return `rider-${riderId}`;
}

const NOTIFICATION_DISMISS_KEY = 'jlr_notification_dismissed_session';

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const ACTIVE_STATUS_LABEL: Record<Job['status'], string> = {
  assigned: 'Heading to pickup',
  picked_up: 'Pickup complete',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
};

export default function Home() {
  const { riderStatus, riderRejectReason } = useAuth();

  if (riderStatus === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (riderStatus !== 'active') {
    return <ApplicationStatus status={riderStatus} reason={riderRejectReason} />;
  }

  return <RiderHome />;
}

function RiderHome() {
  const { user, riderId } = useAuth();
  const navigate = useNavigate();

  const [online, setOnlineState] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [pending, setPending] = useState<Job[]>([]);
  const [available, setAvailable] = useState<Job[]>([]);
  const [active, setActive] = useState<Job | null>(null);
  const [today, setToday] = useState({ count: 0, earnings: 0 });
  const [riderName, setRiderName] = useState('');
  const [riderArea, setRiderArea] = useState<{ city: string; state: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [claimingOn, setClaimingOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSelfiePrompt, setShowSelfiePrompt] = useState(false);
  const [checkingInSelfie, setCheckingInSelfie] = useState(false);
  const selfieInputRef = useRef<HTMLInputElement>(null);
  // Broadcast jobs aren't assigned to any one rider, so there's nothing on
  // the server to "decline" — this just hides the offer from this rider's
  // own list until the next refresh brings it back (or someone else claims
  // it first).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visibleAvailable = available.filter((job) => !dismissed.has(job.id));

  const install = useInstallPrompt();
  const { permission: notificationPermission, requestPermission: requestNotificationPermission } =
    usePushNotifications(riderId);
  const [notificationDismissedThisSession, setNotificationDismissedThisSession] = useState(
    () => sessionStorage.getItem(NOTIFICATION_DISMISS_KEY) === '1'
  );
  const showInstallPrompt = install.eligible && !showSelfiePrompt;
  const showNotificationPrompt =
    !showInstallPrompt &&
    !showSelfiePrompt &&
    notificationPermission === 'default' &&
    !notificationDismissedThisSession;

  const dismissNotificationPrompt = () => {
    sessionStorage.setItem(NOTIFICATION_DISMISS_KEY, '1');
    setNotificationDismissedThisSession(true);
  };

  const load = useCallback(async () => {
    try {
      const data = await api.getJobs();
      setPending(data.pending);
      setAvailable(data.available);
      setActive(data.active);
      setToday(data.today);
      setOnlineState(data.online);
      setRiderName(data.rider_name);
      setRiderArea(data.rider_area);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Realtime carries the load; this is just a safety net in case a
    // broadcast signal is missed (dropped socket, backgrounded tab).
    const interval = setInterval(load, 45000);
    return () => clearInterval(interval);
  }, [load]);

  // Personal channel: direct assignments land here immediately instead of
  // waiting for the next poll.
  useEffect(() => {
    if (!riderId) return;
    const channel = supabase
      .channel(riderChannelName(riderId))
      .on('broadcast', { event: 'job_assigned' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [riderId, load]);

  // Area channel: only relevant once we know the rider's own service town
  // (from the first successful load) and while online — a broadcast job
  // posted elsewhere shouldn't wake up a rider who can't reach it anyway.
  useEffect(() => {
    if (!online || !riderArea?.city || !riderArea?.state) return;
    const channel = supabase
      .channel(riderAreaChannelName(riderArea.city, riderArea.state))
      .on('broadcast', { event: 'new_job' }, () => load())
      .on('broadcast', { event: 'job_removed' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [online, riderArea?.city, riderArea?.state, load]);

  const toggleOnline = async () => {
    const goingOnline = !online;
    setTogglingOnline(true);
    setError(null);
    try {
      const result = await api.setOnline(goingOnline);
      setOnlineState(result.online);
    } catch (err) {
      if (goingOnline && err instanceof Error && err.message === 'selfie_stale') {
        setShowSelfiePrompt(true);
      } else {
        setError(err instanceof Error ? err.message : 'Could not update status');
      }
    } finally {
      setTogglingOnline(false);
    }
  };

  const handleSelfieCapture = async (file: File) => {
    if (!user) return;
    setCheckingInSelfie(true);
    setError(null);
    try {
      const selfieUrl = await uploadRiderDocument(user.id, file, 'selfie_checkin');
      await api.checkinSelfie(selfieUrl);
      setShowSelfiePrompt(false);
      const result = await api.setOnline(true);
      setOnlineState(result.online);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify selfie');
    } finally {
      setCheckingInSelfie(false);
    }
  };

  const claim = async (job: Job) => {
    setClaimingOn(job.id);
    try {
      await api.claimJob(job.id);
      navigate('/delivery', { replace: true });
    } catch (err) {
      // A 409 here just means another rider claimed it first — refresh so
      // it drops off this rider's list rather than treating it as a hard
      // failure. The server reports these as short codes, not sentences,
      // so translate the ones a rider can actually hit here.
      const code = err instanceof Error ? err.message : '';
      const friendly: Record<string, string> = {
        already_claimed: 'Another rider accepted this delivery.',
        out_of_area: "This job isn't in your service area anymore.",
        go_online_required: 'Go online to claim deliveries.',
      };
      setError(friendly[code] || 'Could not claim this job');
      await load();
    } finally {
      setClaimingOn(null);
    }
  };

  const respond = async (job: Job, accept: boolean) => {
    setActingOn(job.id);
    try {
      if (accept) {
        await api.acceptJob(job.id);
        navigate('/delivery', { replace: true });
      } else {
        await api.declineJob(job.id);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActingOn(null);
    }
  };

  return (
    <div className="min-h-screen pb-24 bg-gray-50">
      <div className="px-6 pt-4 pb-3 bg-white border-b border-gray-100">
        <p className="text-lg font-bold text-gray-900">
          {greeting()}, {(riderName || user?.email || '').split(' ')[0]} 👋
        </p>
        {riderArea && (
          <p className="mt-0.5 text-xs text-gray-500 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            {riderArea.city}, {riderArea.state}
          </p>
        )}
      </div>

      <div className="px-6 pt-4 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Online status */}
        <div className="rounded-2xl border border-gray-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-gray-300'}`} />
              <div>
                <p className="text-sm font-bold text-gray-900">{online ? 'Online' : 'Offline'}</p>
                <p className="text-xs text-gray-500">
                  {online ? "You're ready to receive jobs" : 'Go online to start receiving offers'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleOnline}
              disabled={togglingOnline}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                online ? 'bg-emerald-600 text-white' : 'bg-primary-600 text-white'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              {online ? 'Go Offline' : 'Go Online'}
            </button>
          </div>
          {online && (
            <p className="mt-3 text-xs font-medium text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Identity verified today
            </p>
          )}
        </div>

        {/* Active delivery, always prioritized */}
        {active && (
          <div className="rounded-2xl border border-primary-200 overflow-hidden">
            <div className="bg-primary-600 px-4 py-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white">Delivery in progress</span>
              <span className="text-[11px] font-semibold text-primary-100">{active.tracking_number}</span>
            </div>
            <div className="p-4">
              <p className="text-xs font-semibold text-emerald-600">{ACTIVE_STATUS_LABEL[active.status]}</p>
              <p className="mt-1 text-sm text-gray-900">
                Next: Deliver to <span className="font-semibold">{active.dropoff.customer_name || 'customer'}</span>
              </p>
              <p className="mt-0.5 text-xs text-gray-500">{active.dropoff.address || active.dropoff.city || '—'}</p>
              <button
                type="button"
                onClick={() => navigate('/delivery')}
                className="mt-4 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white"
              >
                Continue Delivery
              </button>
            </div>
          </div>
        )}

        {/* Today summary */}
        <button type="button" onClick={() => navigate('/earnings')} className="w-full grid grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl border border-gray-200 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
              <Package className="w-4 h-4 text-primary-600" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">{today.count}</p>
              <p className="text-[11px] text-gray-500">Deliveries Today</p>
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 text-primary-600" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">{formatNaira(today.earnings)}</p>
              <p className="text-[11px] text-gray-500">Earned Today</p>
            </div>
          </div>
        </button>

        {!online && (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <p className="text-sm font-semibold text-gray-900">You're offline</p>
            <p className="mt-1 text-xs text-gray-500">Go online to start receiving delivery offers.</p>
          </div>
        )}

        {online && loading && (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        )}

        {online && !loading && !active && pending.length === 0 && visibleAvailable.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <Package className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-900">No deliveries yet</p>
            <p className="mt-1 text-xs text-gray-500">We'll notify you the moment one comes in.</p>
          </div>
        )}

        {online && (pending.length > 0 || visibleAvailable.length > 0) && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Available Job Offers</p>
            <div className="space-y-3">
              {pending.map((job) => (
                <div key={job.id} className="rounded-2xl border border-gray-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <Lock className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{job.tracking_number || `Order ${job.order_number ?? ''}`}</p>
                        <p className="text-xs text-gray-500">Vendor: {job.pickup.name || '—'}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-bold text-gray-900">{formatNaira(job.fee)}</p>
                      <p className="text-[10px] text-gray-400">Earning</p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                      <span>Pickup: {job.pickup.city || job.pickup.address || '—'}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                      <span>Drop-off: {job.dropoff.city || job.dropoff.address || '—'}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      disabled={actingOn === job.id}
                      onClick={() => respond(job, false)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Decline
                    </button>
                    <button
                      type="button"
                      disabled={actingOn === job.id}
                      onClick={() => respond(job, true)}
                      className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {actingOn === job.id ? 'Accepting…' : 'Accept Delivery'}
                    </button>
                  </div>
                </div>
              ))}

              {visibleAvailable.map((job) => (
                  <div key={job.id} className="rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          <Users className="w-3 h-3" />
                          Available to nearby riders
                        </span>
                        <p className="text-sm font-semibold text-gray-900 mt-1.5">{job.tracking_number || `Order ${job.order_number ?? ''}`}</p>
                        <p className="text-xs text-gray-500">Vendor: {job.pickup.name || '—'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-base font-bold text-gray-900">{formatNaira(job.fee)}</p>
                        <p className="text-[10px] text-gray-400">Earning</p>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1.5 text-xs text-gray-600">
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                        <span>Pickup: {job.pickup.city || job.pickup.address || '—'}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                        <span>Drop-off: {job.dropoff.city || job.dropoff.address || '—'}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDismissed((prev) => new Set(prev).add(job.id))}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600"
                      >
                        <X className="w-4 h-4" />
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={claimingOn === job.id}
                        onClick={() => claim(job)}
                        className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {claimingOn === job.id ? 'Accepting…' : 'Accept Delivery'}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {showSelfiePrompt && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 px-6 pb-6 sm:pb-0">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-4">
              <Camera className="w-6 h-6 text-primary-600" />
            </div>
            <h3 className="text-base font-bold text-gray-900">Take a fresh selfie</h3>
            <p className="mt-1 text-sm text-gray-500">
              For your safety and your customers', we check it's really you before you go online each day.
            </p>

            <input
              ref={selfieInputRef}
              type="file"
              accept="image/*"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleSelfieCapture(file);
              }}
            />

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setShowSelfiePrompt(false)}
                disabled={checkingInSelfie}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={() => selfieInputRef.current?.click()}
                disabled={checkingInSelfie}
                className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {checkingInSelfie ? 'Verifying…' : 'Take selfie'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInstallPrompt && install.platform && (
        <InstallPrompt platform={install.platform} onInstall={install.promptInstall} onDismiss={install.dismiss} />
      )}

      {showNotificationPrompt && (
        <NotificationPrompt onEnable={requestNotificationPermission} onDismiss={dismissNotificationPrompt} />
      )}

      <BottomNav />
    </div>
  );
}
