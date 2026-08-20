import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, ChevronRight, FileText, LogOut, Pencil, Phone, RefreshCw, Shield, Truck, User } from 'lucide-react';
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
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingBank, setEditingBank] = useState(false);
  const [bankForm, setBankForm] = useState({ bank_name: '', bank_account_number: '', bank_account_name: '' });
  const [bankError, setBankError] = useState<string | null>(null);
  const [submittingBank, setSubmittingBank] = useState(false);

  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneForm, setPhoneForm] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [submittingPhone, setSubmittingPhone] = useState(false);

  const [editingVehicle, setEditingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ vehicle_type: 'okada', vehicle_plate: '' });
  const [vehicleError, setVehicleError] = useState<string | null>(null);
  const [submittingVehicle, setSubmittingVehicle] = useState(false);

  const loadProfile = async () => {
    try {
      setProfile(await api.getProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const startEditingBank = () => {
    setBankForm({
      bank_name: profile?.bank_name || '',
      bank_account_number: profile?.bank_account_number || '',
      bank_account_name: profile?.bank_account_name || '',
    });
    setBankError(null);
    setEditingBank(true);
  };

  const submitBankChange = async () => {
    setBankError(null);
    if (!bankForm.bank_name.trim()) return setBankError('Enter your bank name');
    if (!/^\d{10}$/.test(bankForm.bank_account_number.trim())) return setBankError('Account number must be 10 digits');
    if (!bankForm.bank_account_name.trim()) return setBankError('Enter the account name');

    setSubmittingBank(true);
    try {
      await api.requestBankChange(bankForm.bank_name.trim(), bankForm.bank_account_number.trim(), bankForm.bank_account_name.trim());
      setEditingBank(false);
      await loadProfile();
    } catch (err) {
      setBankError(err instanceof Error ? err.message : 'Could not submit change request');
    } finally {
      setSubmittingBank(false);
    }
  };

  const startEditingPhone = () => {
    setPhoneForm(profile?.phone || '');
    setPhoneError(null);
    setEditingPhone(true);
  };

  const submitPhoneChange = async () => {
    setPhoneError(null);
    const phone = phoneForm.trim();
    if (!/^(0\d{10}|\+234\d{10})$/.test(phone)) {
      return setPhoneError('Enter a valid Nigerian phone number');
    }
    setSubmittingPhone(true);
    try {
      await api.updatePhone(phone);
      setEditingPhone(false);
      await loadProfile();
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : 'Could not update phone number');
    } finally {
      setSubmittingPhone(false);
    }
  };

  const startEditingVehicle = () => {
    setVehicleForm({
      vehicle_type: profile?.vehicle_type || 'okada',
      vehicle_plate: profile?.vehicle_plate || '',
    });
    setVehicleError(null);
    setEditingVehicle(true);
  };

  const submitVehicleChange = async () => {
    setVehicleError(null);
    if (!vehicleForm.vehicle_plate.trim()) return setVehicleError('Enter your vehicle plate number');

    setSubmittingVehicle(true);
    try {
      await api.requestVehicleChange(vehicleForm.vehicle_type, vehicleForm.vehicle_plate.trim());
      setEditingVehicle(false);
      await loadProfile();
    } catch (err) {
      setVehicleError(err instanceof Error ? err.message : 'Could not submit change request');
    } finally {
      setSubmittingVehicle(false);
    }
  };

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
              {editingPhone ? (
                <div className="py-3 space-y-2.5">
                  <label className="field-label">Phone number</label>
                  <input
                    className="field-input"
                    value={phoneForm}
                    onChange={(e) => setPhoneForm(e.target.value)}
                    inputMode="tel"
                    placeholder="0801 234 5678"
                  />
                  {phoneError && <p className="text-xs text-red-600">{phoneError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingPhone(false)}
                      disabled={submittingPhone}
                      className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-semibold text-gray-600 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitPhoneChange}
                      disabled={submittingPhone}
                      className="flex-1 rounded-xl bg-primary-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {submittingPhone ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-sm text-gray-500">Phone</span>
                  <button type="button" onClick={startEditingPhone} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-900">
                    {profile.phone || '—'}
                    <Pencil className="w-3.5 h-3.5 text-primary-600" />
                  </button>
                </div>
              )}
              <Row label="Service area" value={profile.town} />
              <Row label="Member since" value={formatDate(profile.member_since)} />
            </div>

            <div>
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5" /> Vehicle
              </p>

              {profile.pending_vehicle_change && (
                <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-900">Change pending review</p>
                  <p className="mt-0.5 text-xs text-amber-800">
                    {VEHICLE_LABEL[profile.pending_vehicle_change.vehicle_type] || profile.pending_vehicle_change.vehicle_type} · {profile.pending_vehicle_change.vehicle_plate}
                  </p>
                  <p className="mt-1 text-[11px] text-amber-700">Your current vehicle below stays on file until this is approved.</p>
                </div>
              )}

              {editingVehicle ? (
                <div className="rounded-2xl border border-gray-200 p-4 space-y-3">
                  <div>
                    <label className="field-label">Vehicle type</label>
                    <select
                      className="field-input"
                      value={vehicleForm.vehicle_type}
                      onChange={(e) => setVehicleForm((f) => ({ ...f, vehicle_type: e.target.value }))}
                    >
                      <option value="okada">Okada (motorbike)</option>
                      <option value="keke">Keke (tricycle)</option>
                      <option value="car">Car</option>
                      <option value="foot">On foot</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Plate number</label>
                    <input
                      className="field-input"
                      value={vehicleForm.vehicle_plate}
                      onChange={(e) => setVehicleForm((f) => ({ ...f, vehicle_plate: e.target.value.toUpperCase() }))}
                    />
                  </div>
                  {vehicleError && <p className="text-xs text-red-600">{vehicleError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingVehicle(false)}
                      disabled={submittingVehicle}
                      className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitVehicleChange}
                      disabled={submittingVehicle}
                      className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {submittingVehicle ? 'Submitting…' : 'Submit for review'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-200 px-4 divide-y divide-gray-100">
                  <Row label="Type" value={VEHICLE_LABEL[profile.vehicle_type] || profile.vehicle_type} />
                  <Row label="Plate number" value={profile.vehicle_plate} />
                  <button
                    type="button"
                    onClick={startEditingVehicle}
                    disabled={Boolean(profile.pending_vehicle_change)}
                    className="w-full py-3 text-sm font-semibold text-primary-600 disabled:opacity-40"
                  >
                    {profile.pending_vehicle_change ? 'Change already pending' : 'Request a change'}
                  </button>
                </div>
              )}
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
                <Banknote className="w-3.5 h-3.5" /> Payout account
              </p>

              {profile.pending_bank_change && (
                <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-900">Change pending review</p>
                  <p className="mt-0.5 text-xs text-amber-800">
                    {profile.pending_bank_change.bank_name} · {profile.pending_bank_change.bank_account_number} · {profile.pending_bank_change.bank_account_name}
                  </p>
                  <p className="mt-1 text-[11px] text-amber-700">Your current account below stays active until this is approved.</p>
                </div>
              )}

              {editingBank ? (
                <div className="rounded-2xl border border-gray-200 p-4 space-y-3">
                  <div>
                    <label className="field-label">Bank name</label>
                    <input className="field-input" value={bankForm.bank_name} onChange={(e) => setBankForm((f) => ({ ...f, bank_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="field-label">Account number (10 digits)</label>
                    <input
                      className="field-input"
                      value={bankForm.bank_account_number}
                      onChange={(e) => setBankForm((f) => ({ ...f, bank_account_number: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="field-label">Account name</label>
                    <input className="field-input" value={bankForm.bank_account_name} onChange={(e) => setBankForm((f) => ({ ...f, bank_account_name: e.target.value }))} />
                  </div>
                  {bankError && <p className="text-xs text-red-600">{bankError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingBank(false)}
                      disabled={submittingBank}
                      className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitBankChange}
                      disabled={submittingBank}
                      className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {submittingBank ? 'Submitting…' : 'Submit for review'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-gray-200 px-4 divide-y divide-gray-100">
                  <Row label="Bank" value={profile.bank_name} />
                  <Row label="Account number" value={profile.bank_account_number} />
                  <Row label="Account name" value={profile.bank_account_name} />
                  <button
                    type="button"
                    onClick={startEditingBank}
                    disabled={Boolean(profile.pending_bank_change)}
                    className="w-full py-3 text-sm font-semibold text-primary-600 disabled:opacity-40"
                  >
                    {profile.pending_bank_change ? 'Change already pending' : 'Request a change'}
                  </button>
                </div>
              )}
            </div>

            <div>
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Documents
              </p>
              <button
                type="button"
                onClick={() => navigate('/documents')}
                className="w-full rounded-2xl border border-gray-200 px-4 py-3.5 flex items-center justify-between gap-3 text-sm font-semibold text-gray-900"
              >
                View document status
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
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
