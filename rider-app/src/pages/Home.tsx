import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Clock, MapPin, Package, Power, RefreshCw, Wallet, X, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useInstallPrompt } from '../hooks/useInstallPrompt';
import { api, Job } from '../lib/api';
import { uploadRiderDocument } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { BottomNav } from '../components/BottomNav';
import { InstallPrompt } from '../components/InstallPrompt';
import { NotificationPrompt } from '../components/NotificationPrompt';

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

export default function Home() {
  const { user, riderActive, signOut } = useAuth();

  if (riderActive === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center max-w-sm mx-auto">
        <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <Clock className="w-6 h-6 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Application under review</h1>
        <p className="mt-2 text-sm text-gray-500">
          We're verifying your documents and will call your guarantor. Approval usually takes 24–48 hours.
        </p>
        <p className="mt-4 text-xs text-gray-400">{user?.email}</p>
        <button onClick={signOut} className="btn-secondary mt-8 max-w-[160px]">
          Sign out
        </button>
      </div>
    );
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

  useEffect(() => {
    if (active) navigate('/delivery', { replace: true });
  }, [active, navigate]);

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
      await load();
    } catch (err) {
      // A 409 here just means another rider claimed it first — refresh so
      // it drops off this rider's list rather than treating it as a hard
      // failure.
      setError(err instanceof Error ? err.message : 'Could not claim this job');
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
    <div className="min-h-screen pb-24">
      <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500">Welcome back</p>
            <h1 className="text-lg font-bold text-gray-900 truncate max-w-[200px]">{riderName || user?.email}</h1>
          </div>
          <button
            type="button"
            onClick={toggleOnline}
            disabled={togglingOnline}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
              online ? 'bg-signal text-signal-ink' : 'bg-gray-100 text-gray-500'
            }`}
          >
            <Power className="w-4 h-4" />
            {online ? 'Online' : 'Offline'}
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate('/earnings')}
          className="mt-5 w-full rounded-2xl border border-gray-200 p-4 flex items-center gap-3 text-left active:bg-gray-50"
        >
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
            <Wallet className="w-5 h-5 text-primary-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-500">Today</p>
            <p className="text-base font-bold text-gray-900">
              {formatNaira(today.earnings)} <span className="font-normal text-gray-400">· {today.count} {today.count === 1 ? 'delivery' : 'deliveries'}</span>
            </p>
          </div>
          <span className="text-xs font-semibold text-primary-600">View earnings</span>
        </button>
      </div>

      <div className="px-6 pt-6 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

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

        {online && !loading && pending.length === 0 && available.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 p-6 text-center">
            <Package className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-gray-900">No deliveries yet</p>
            <p className="mt-1 text-xs text-gray-500">We'll notify you the moment one comes in.</p>
          </div>
        )}

        {online && available.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Available near you{riderArea ? ` · ${riderArea.city}` : ''}
            </p>
            <div className="space-y-3">
              {available.map((job) => (
                <div key={job.id} className="rounded-2xl border border-purple-200 bg-purple-50/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-purple-700 flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        First to claim wins
                      </p>
                      <p className="text-sm text-gray-900 mt-1">{job.tracking_number || `Order ${job.order_number ?? ''}`}</p>
                    </div>
                    <p className="text-base font-bold text-gray-900 shrink-0">{formatNaira(job.fee)}</p>
                  </div>

                  <div className="mt-3 space-y-2 text-xs text-gray-600">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                      <span>Pickup: {job.pickup.name ? `${job.pickup.name}, ` : ''}{job.pickup.city || job.pickup.address || '—'}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                      <span>Drop-off: {job.dropoff.city || job.dropoff.address || '—'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={claimingOn === job.id}
                    onClick={() => claim(job)}
                    className="mt-4 w-full rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {claimingOn === job.id ? 'Claiming…' : 'Claim this delivery'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {online &&
          pending.map((job) => (
            <div key={job.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">New delivery</p>
                  <p className="text-sm text-gray-900 mt-1">{job.tracking_number || `Order ${job.order_number ?? ''}`}</p>
                </div>
                <p className="text-base font-bold text-gray-900 shrink-0">{formatNaira(job.fee)}</p>
              </div>

              <div className="mt-3 space-y-2 text-xs text-gray-600">
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
                  <span>Pickup: {job.pickup.name ? `${job.pickup.name}, ` : ''}{job.pickup.city || job.pickup.address || '—'}</span>
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
                  Accept
                </button>
              </div>
            </div>
          ))}
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
