import { useEffect, useState } from 'react';
import { LogOut, Phone, RefreshCw, Shield, Truck, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api, RiderProfile } from '../lib/api';
import { BottomNav } from '../components/BottomNav';

const VEHICLE_LABEL: Record<string, string> = {
  okada: 'Okada (motorbike)',
  keke: 'Keke (tricycle)',
  car: 'Car',
  foot: 'On foot',
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right">{value || '—'}</span>
    </div>
  );
}

export default function Profile() {
  const { signOut } = useAuth();
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setProfile(await api.getProfile());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen pb-24">
      <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100">
        <h1 className="text-lg font-bold text-gray-900">Profile</h1>
        <p className="text-xs text-gray-500 mt-0.5">Your details and account settings</p>
      </div>

      <div className="px-6 pt-6 space-y-5">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
          </div>
        ) : profile ? (
          <>
            <div className="rounded-2xl border border-gray-200 p-5 flex items-center gap-4">
              {profile.selfie_url ? (
                <img src={profile.selfie_url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center shrink-0">
                  <User className="w-6 h-6 text-primary-600" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-base font-bold text-gray-900 truncate">{profile.full_name}</p>
                <p className="text-xs text-gray-500 truncate">{profile.email}</p>
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-signal px-2 py-0.5 text-[10px] font-semibold text-signal-ink capitalize">
                  {profile.status}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 px-4 divide-y divide-gray-100">
              <Row label="Phone" value={profile.phone} />
              <Row label="Service area" value={profile.town} />
              <Row label="Member since" value={formatDate(profile.member_since)} />
            </div>

            <div>
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5" /> Vehicle
              </p>
              <div className="rounded-2xl border border-gray-200 px-4 divide-y divide-gray-100">
                <Row label="Type" value={VEHICLE_LABEL[profile.vehicle_type] || profile.vehicle_type} />
                <Row label="Plate number" value={profile.vehicle_plate} />
              </div>
            </div>

            <div>
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Guarantor
              </p>
              <div className="rounded-2xl border border-gray-200 px-4 divide-y divide-gray-100">
                <Row label="Name" value={profile.guarantor_name} />
                <Row label="Phone" value={profile.guarantor_phone} />
              </div>
            </div>

            <div>
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" /> Settings
              </p>
              <button
                onClick={signOut}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3.5 flex items-center gap-3 text-sm font-semibold text-red-600"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </>
        ) : null}
      </div>

      <BottomNav />
    </div>
  );
}
