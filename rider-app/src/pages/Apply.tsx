import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { uploadRiderDocument } from '../lib/storage';
import { api } from '../lib/api';

type Step = 1 | 2 | 3 | 4 | 5;

type LocationOption = { id: string; lga: string };
type GroupedLocations = Record<string, Record<string, LocationOption[]>>;

const emptyForm = {
  full_name: '',
  phone: '',
  nin: '',
  id_document: null as File | null,
  selfie: null as File | null,
  vehicle_type: 'okada' as 'okada' | 'keke' | 'car' | 'foot',
  vehicle_plate: '',
  vehicle_document: null as File | null,
  guarantor_name: '',
  guarantor_phone: '',
  state: '',
  city: '',
  lga: '',
  approved_location_id: '',
  bank_name: '',
  bank_account_number: '',
  bank_account_name: '',
};

function StepDots({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <div
          key={n}
          className={`h-1 flex-1 rounded-full ${n <= step ? 'bg-primary-600' : 'bg-gray-200'} ${n === step ? 'opacity-60' : ''}`}
        />
      ))}
    </div>
  );
}

function FileTile({
  label,
  sub,
  file,
  onSelect,
  accept,
  capture,
}: {
  label: string;
  sub: string;
  file: File | null;
  onSelect: (file: File | null) => void;
  accept?: string;
  capture?: 'user' | 'environment';
}) {
  return (
    <label
      className={`flex items-center gap-3 rounded-xl border-2 border-dashed p-3.5 cursor-pointer ${
        file ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-gray-50'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          file ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
        }`}
      >
        {file ? <CheckCircle2 className="w-5 h-5" /> : capture ? <Camera className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{file ? `${label} uploaded` : label}</p>
        <p className="text-xs text-gray-500 truncate">{file ? file.name : sub}</p>
      </div>
      <input
        type="file"
        accept={accept || 'image/*'}
        capture={capture}
        className="hidden"
        onChange={(e) => onSelect(e.target.files?.[0] || null)}
      />
    </label>
  );
}

export default function Apply() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [grouped, setGrouped] = useState<GroupedLocations>({});
  const [locationsLoading, setLocationsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data, error: locErr } = await supabase
          .from('approved_vendor_locations')
          .select('id,state,city,lga')
          .eq('status', 'active')
          .order('state')
          .order('city')
          .order('lga');
        if (locErr || !data) return;
        const g: GroupedLocations = {};
        for (const loc of data as { id: string; state: string; city: string; lga: string }[]) {
          if (!g[loc.state]) g[loc.state] = {};
          if (!g[loc.state][loc.city]) g[loc.state][loc.city] = [];
          g[loc.state][loc.city].push({ id: loc.id, lga: loc.lga });
        }
        setGrouped(g);
      } finally {
        setLocationsLoading(false);
      }
    })();
  }, []);

  const states = Object.keys(grouped).sort();
  const cities = form.state ? Object.keys(grouped[form.state] || {}).sort() : [];
  const lgas = form.state && form.city ? grouped[form.state]?.[form.city] || [] : [];

  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function validateStep(s: Step): string | null {
    if (s === 1) {
      if (!form.full_name.trim()) return 'Enter your full name';
      if (!form.phone.trim()) return 'Enter your phone number';
      if (!/^\d{11}$/.test(form.nin.trim())) return 'NIN must be 11 digits';
      if (!form.id_document) return 'Upload a photo of your government ID';
    }
    if (s === 2) {
      if (!form.selfie) return 'Take a selfie to continue';
    }
    if (s === 3) {
      if (!form.vehicle_plate.trim()) return 'Enter your vehicle plate number';
      if (!form.guarantor_name.trim() || !form.guarantor_phone.trim()) return "Enter your guarantor's name and phone";
      if (!form.approved_location_id) return 'Select your state, city, and area';
    }
    if (s === 4) {
      if (!form.bank_name.trim()) return 'Select your bank';
      if (!/^\d{10}$/.test(form.bank_account_number.trim())) return 'Account number must be 10 digits';
      if (!form.bank_account_name.trim()) return 'Enter the account name';
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep((s) => (s + 1) as Step);
  }

  function back() {
    setError(null);
    setStep((s) => (s - 1) as Step);
  }

  async function handleSubmit() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      const idUrl = await uploadRiderDocument(user.id, form.id_document!, 'id');
      const selfieUrl = await uploadRiderDocument(user.id, form.selfie!, 'selfie');
      const vehicleUrl = form.vehicle_document
        ? await uploadRiderDocument(user.id, form.vehicle_document, 'vehicle')
        : undefined;

      await api.register({
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        nin: form.nin.trim(),
        id_document_url: idUrl,
        selfie_url: selfieUrl,
        vehicle_type: form.vehicle_type,
        vehicle_plate: form.vehicle_plate.trim(),
        vehicle_document_url: vehicleUrl,
        guarantor_name: form.guarantor_name.trim(),
        guarantor_phone: form.guarantor_phone.trim(),
        approved_location_id: form.approved_location_id,
        bank_name: form.bank_name.trim(),
        bank_account_number: form.bank_account_number.trim(),
        bank_account_name: form.bank_account_name.trim(),
      });

      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your application');
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels: Record<Step, string> = {
    1: 'Identity',
    2: 'Selfie',
    3: 'Vehicle & guarantor',
    4: 'Payout details',
    5: 'Review',
  };

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-8 max-w-sm mx-auto">
      <StepDots step={step} />
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
        Step {step} of 5 — {stepLabels[step]}
      </p>

      {step === 1 && (
        <StepShell title="Let's confirm it's really you" subtitle="This is what we check before any rider goes live.">
          <div>
            <label className="field-label">Full name</label>
            <input className="field-input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </div>
          <div>
            <label className="field-label">Phone number</label>
            <input className="field-input" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="0803 000 0000" />
          </div>
          <div>
            <label className="field-label">NIN (11 digits)</label>
            <input
              className="field-input"
              value={form.nin}
              onChange={(e) => set('nin', e.target.value.replace(/\D/g, '').slice(0, 11))}
              inputMode="numeric"
            />
          </div>
          <FileTile
            label="Government ID photo"
            sub="Driver's license or National ID card"
            file={form.id_document}
            onSelect={(f) => set('id_document', f)}
          />
        </StepShell>
      )}

      {step === 2 && (
        <StepShell
          title="Take a photo of yourself now"
          subtitle="Camera only — we'll ask again before you go online each day, so no one else can use your account."
        >
          <FileTile
            label="Live selfie"
            sub="Hold your face in frame, good lighting"
            file={form.selfie}
            onSelect={(f) => set('selfie', f)}
            capture="user"
          />
        </StepShell>
      )}

      {step === 3 && (
        <StepShell title="Your ride, and someone who vouches for you" subtitle="">
          <div>
            <label className="field-label">Vehicle type</label>
            <select className="field-input" value={form.vehicle_type} onChange={(e) => set('vehicle_type', e.target.value as typeof form.vehicle_type)}>
              <option value="okada">Okada (motorbike)</option>
              <option value="keke">Keke</option>
              <option value="car">Car</option>
              <option value="foot">On foot</option>
            </select>
          </div>
          <div>
            <label className="field-label">Plate number</label>
            <input className="field-input" value={form.vehicle_plate} onChange={(e) => set('vehicle_plate', e.target.value.toUpperCase())} />
          </div>
          <FileTile
            label="Vehicle particulars (optional)"
            sub="Registration document"
            file={form.vehicle_document}
            onSelect={(f) => set('vehicle_document', f)}
          />
          <div>
            <label className="field-label">Guarantor name</label>
            <input className="field-input" value={form.guarantor_name} onChange={(e) => set('guarantor_name', e.target.value)} />
          </div>
          <div>
            <label className="field-label">Guarantor phone</label>
            <input className="field-input" value={form.guarantor_phone} onChange={(e) => set('guarantor_phone', e.target.value)} />
          </div>

          <div>
            <label className="field-label">State</label>
            <select
              className="field-input"
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, city: '', lga: '', approved_location_id: '' }))}
              disabled={locationsLoading}
            >
              <option value="">{locationsLoading ? 'Loading…' : 'Select state'}</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          {form.state && (
            <div>
              <label className="field-label">City</label>
              <select
                className="field-input"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value, lga: '', approved_location_id: '' }))}
              >
                <option value="">Select city</option>
                {cities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}
          {form.city && (
            <div>
              <label className="field-label">Area / LGA</label>
              <select
                className="field-input"
                value={form.approved_location_id}
                onChange={(e) => {
                  const loc = lgas.find((l) => l.id === e.target.value);
                  setForm((f) => ({ ...f, approved_location_id: e.target.value, lga: loc?.lga || '' }));
                }}
              >
                <option value="">Select area</option>
                {lgas.map((l) => (
                  <option key={l.id} value={l.id}>{l.lga}</option>
                ))}
              </select>
            </div>
          )}
        </StepShell>
      )}

      {step === 4 && (
        <StepShell
          title="Where should we pay you?"
          subtitle="Delivery earnings get paid out here — double-check the account name matches yours exactly."
        >
          <div>
            <label className="field-label">Bank name</label>
            <input className="field-input" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} placeholder="e.g. GTBank" />
          </div>
          <div>
            <label className="field-label">Account number (10 digits)</label>
            <input
              className="field-input"
              value={form.bank_account_number}
              onChange={(e) => set('bank_account_number', e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="field-label">Account name</label>
            <input className="field-input" value={form.bank_account_name} onChange={(e) => set('bank_account_name', e.target.value)} placeholder="As it appears on your bank account" />
          </div>
        </StepShell>
      )}

      {step === 5 && (
        <StepShell title="Review your application" subtitle="Make sure this all looks right before you submit.">
          <SummaryRow label="Name" value={form.full_name} />
          <SummaryRow label="Phone" value={form.phone} />
          <SummaryRow label="NIN" value={form.nin} />
          <SummaryRow label="Vehicle" value={`${form.vehicle_type} · ${form.vehicle_plate}`} />
          <SummaryRow label="Guarantor" value={`${form.guarantor_name} · ${form.guarantor_phone}`} />
          <SummaryRow label="Area" value={`${form.lga}, ${form.city}, ${form.state}`} />
          <SummaryRow label="Payout account" value={`${form.bank_name} · ${form.bank_account_number}`} />
          <SummaryRow label="Account name" value={form.bank_account_name} />
        </StepShell>
      )}

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

      <div className="flex gap-3 mt-6">
        {step > 1 && (
          <button type="button" className="btn-secondary" onClick={back} disabled={submitting}>
            Back
          </button>
        )}
        {step < 5 ? (
          <button type="button" className="btn-primary" onClick={next}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn-primary bg-gradient-to-r from-primary-600 to-primary-700" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        )}
      </div>
    </div>
  );
}

function StepShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-2 border-b border-gray-100 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value || '—'}</span>
    </div>
  );
}
