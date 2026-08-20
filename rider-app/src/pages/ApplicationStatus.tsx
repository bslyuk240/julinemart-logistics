import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardList, RefreshCw, ShieldOff, UserPlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { ApplicationState } from '../contexts/AuthContext';

function formatDate(value: string | null | undefined) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Shell({
  icon,
  iconClass,
  title,
  children,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  children: React.ReactNode;
}) {
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center max-w-sm mx-auto">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${iconClass}`}>{icon}</div>
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      {children}
      <p className="mt-4 text-xs text-gray-400">{user?.email}</p>
      <button onClick={signOut} className="btn-secondary mt-8 max-w-[160px]">
        Sign out
      </button>
    </div>
  );
}

type StepState = 'done' | 'active' | 'upcoming';

function Step({ n, state, title, sub }: { n: number; state: StepState; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
          state === 'done'
            ? 'bg-emerald-100 text-emerald-600'
            : state === 'active'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-400'
        }`}
      >
        {state === 'done' ? <CheckCircle2 className="w-4 h-4" /> : n}
      </div>
      <div className="text-left">
        <p className={`text-sm font-semibold ${state === 'upcoming' ? 'text-gray-400' : 'text-gray-900'}`}>{title}</p>
        <p className="text-xs text-gray-500">{sub}</p>
      </div>
    </div>
  );
}

export default function ApplicationStatus({ status, reason }: { status: ApplicationState; reason: string | null }) {
  const navigate = useNavigate();
  const { user, riderId, riderCreatedAt, refreshRiderStatus } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await refreshRiderStatus();
    } finally {
      setRetrying(false);
    }
  };

  if (status === 'no_application') {
    return (
      <Shell icon={<UserPlus className="w-6 h-6 text-primary-600" />} iconClass="bg-primary-50" title="Become a rider">
        <p className="mt-2 text-sm text-gray-500">You haven't submitted a rider application yet. It only takes a few minutes.</p>
        <button onClick={() => navigate('/apply')} className="btn-primary mt-8 max-w-[220px]">
          Start application
        </button>
      </Shell>
    );
  }

  if (status === 'pending_review') {
    const firstName = (user?.email || '').split('@')[0];
    const caseId = riderId ? `APP-${riderId.replace(/-/g, '').slice(0, 8).toUpperCase()}` : null;

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center px-6 py-10">
        <div className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-6">
          <div className="w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center mb-4">
            <ClipboardList className="w-6 h-6 text-primary-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">Application received</h1>
          <p className="mt-1.5 text-sm text-gray-500">
            Thanks{firstName ? `, ${firstName}` : ''}. We're reviewing your documents. You'll be notified once your account is
            activated.
          </p>
          {caseId && <p className="mt-2 text-xs text-gray-400">Case ID: {caseId}</p>}

          <div className="mt-6 space-y-4">
            <Step n={1} state="done" title="Account created" sub={user?.created_at ? `Completed on ${formatDate(user.created_at)}` : 'Completed'} />
            <Step
              n={2}
              state="done"
              title="KYC submitted"
              sub={riderCreatedAt ? `Completed on ${formatDate(riderCreatedAt)}` : 'Completed'}
            />
            <Step n={3} state="active" title="Verification in progress" sub="Our team is reviewing your documents" />
            <Step n={4} state="upcoming" title="Rider activation" sub="You'll be notified when activated" />
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-400">{user?.email}</p>
        <RetrySignOut />
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <Shell icon={<AlertTriangle className="w-6 h-6 text-red-600" />} iconClass="bg-red-100" title="Application not approved">
        <p className="mt-2 text-sm text-gray-500">
          {reason || 'Your application did not meet our requirements this time.'}
        </p>
        <button onClick={() => navigate('/apply')} className="btn-primary mt-8 max-w-[220px]">
          Resubmit application
        </button>
      </Shell>
    );
  }

  if (status === 'suspended') {
    return (
      <Shell icon={<ShieldOff className="w-6 h-6 text-red-600" />} iconClass="bg-red-100" title="Account suspended">
        <p className="mt-2 text-sm text-gray-500">
          {reason || 'Your rider account has been suspended.'} If you believe this is a mistake, reach out to the JulineMart team
          through the channel you used to apply.
        </p>
      </Shell>
    );
  }

  return (
    <Shell icon={<AlertTriangle className="w-6 h-6 text-gray-500" />} iconClass="bg-gray-100" title="Couldn't load your status">
      <p className="mt-2 text-sm text-gray-500">Check your connection and try again.</p>
      <button onClick={retry} disabled={retrying} className="btn-primary mt-8 max-w-[220px] inline-flex items-center justify-center gap-2 disabled:opacity-60">
        <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </Shell>
  );
}

function RetrySignOut() {
  const { signOut } = useAuth();
  return (
    <button onClick={signOut} className="btn-secondary max-w-[160px]">
      Sign out
    </button>
  );
}
