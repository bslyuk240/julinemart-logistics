import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { JulineMartLogo } from '../components/JulineMartLogo';

const JLO_API = import.meta.env.VITE_JLO_API_URL || 'https://jlo.julinemart.com';

type Step = 1 | 2 | 3 | 4;

interface FormData {
  // Step 1 — Personal
  full_name: string;
  email: string;
  phone: string;
  nin_bvn: string;
  // Step 2 — Business
  store_name: string;
  business_type: 'individual' | 'registered_business' | '';
  rc_number: string;
  business_address: string;
  state: string;
  city: string;
  // Step 3 — Bank
  bank_name: string;
  account_number: string;
  account_name: string;
  // Step 4 — Documents
  id_document: File | null;
  cac_document: File | null;
}

const NIGERIAN_STATES = [
  'Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno',
  'Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo',
  'Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa',
  'Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba',
  'Yobe','Zamfara',
];

/** Nigerian banks / MFBs for payout details (align with common Paystack/NIBSS names). */
const BANKS = [
  '9 Payment Service Bank (9PSB)',
  'Access Bank',
  'Carbon Microfinance Bank',
  'Citibank',
  'EcoBank',
  'Fairmoney Microfinance Bank',
  'Fidelity Bank',
  'First Bank of Nigeria',
  'First City Monument Bank (FCMB)',
  'Globus Bank',
  'GT Bank',
  'Heritage Bank',
  'Jaiz Bank',
  'Keystone Bank',
  'Kuda Microfinance Bank',
  'Lotus Bank',
  'Moniepoint Microfinance Bank',
  'Opay',
  'Palmpay',
  'Parallex Bank',
  'Polaris Bank',
  'Providus Bank',
  'Stanbic IBTC Bank',
  'Standard Chartered Bank',
  'Sterling Bank',
  'SunTrust Bank',
  'Titan Trust Bank',
  'UBA',
  'Union Bank',
  'Unity Bank',
  'VFD Microfinance Bank',
  'Wema Bank',
  'Zenith Bank',
];

export default function Register() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>({
    full_name: '', email: '', phone: '', nin_bvn: '',
    store_name: '', business_type: '', rc_number: '', business_address: '', state: '', city: '',
    bank_name: '', account_number: '', account_name: '',
    id_document: null, cac_document: null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const set = (field: keyof FormData, value: string | File | null) =>
    setForm(f => ({ ...f, [field]: value }));

  // ── Validation ──────────────────────────────────────────────────────────────
  function validateStep(s: Step): boolean {
    const e: Partial<Record<keyof FormData, string>> = {};
    if (s === 1) {
      if (!form.full_name.trim()) e.full_name = 'Required';
      if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) e.email = 'Valid email required';
      if (!form.phone.trim() || form.phone.length < 10) e.phone = 'Valid phone required';
    }
    if (s === 2) {
      if (!form.store_name.trim()) e.store_name = 'Required';
      if (!form.business_type) e.business_type = 'Select a type';
      if (form.business_type === 'registered_business' && !form.rc_number.trim())
        e.rc_number = 'RC number required for registered businesses';
    }
    if (s === 3) {
      if (!form.bank_name) e.bank_name = 'Select a bank';
      if (!form.account_number.trim() || form.account_number.length < 10) e.account_number = '10-digit account number required';
      if (!form.account_name.trim()) e.account_name = 'Required';
    }
    // Step 4: documents are optional (KYC may be completed later).
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    if (validateStep(step)) setStep(s => (s + 1) as Step);
  }
  function back() { setStep(s => (s - 1) as Step); }

  // ── Upload document to Supabase Storage ─────────────────────────────────────
  async function uploadDoc(file: File, path: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from('vendor-documents')
      .upload(path, file, { upsert: true });
    if (error) { console.error(error); return null; }
    const { data: { publicUrl } } = supabase.storage.from('vendor-documents').getPublicUrl(data.path);
    return publicUrl;
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validateStep(4)) return;
    setSubmitting(true);
    setSubmitError('');

    try {
      // Upload documents
      setUploading(true);
      const ts = Date.now();
      const slug = form.email.replace(/[^a-z0-9]/gi, '_');
      let idUrl: string | null = null;
      let cacUrl: string | null = null;

      if (form.id_document) {
        idUrl = await uploadDoc(form.id_document, `${slug}/${ts}_id.${form.id_document.name.split('.').pop()}`);
      }
      if (form.cac_document) {
        cacUrl = await uploadDoc(form.cac_document, `${slug}/${ts}_cac.${form.cac_document.name.split('.').pop()}`);
      }
      setUploading(false);

      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personal: {
            full_name: form.full_name,
            email:     form.email,
            phone:     form.phone,
            nin_bvn:   form.nin_bvn || undefined,
          },
          business: {
            store_name:       form.store_name,
            business_type:    form.business_type || undefined,
            rc_number:        form.rc_number || undefined,
            business_address: form.business_address || undefined,
            state:            form.state || undefined,
            city:             form.city || undefined,
          },
          bank: {
            bank_name:      form.bank_name || undefined,
            account_number: form.account_number || undefined,
            account_name:   form.account_name || undefined,
          },
          documents: {
            id_url:  idUrl  || undefined,
            cac_url: cacUrl || undefined,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setSubmitError(data.error || 'Submission failed. Please try again.');
      } else {
        setSubmitted(true);
      }
    } catch {
      setSubmitError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  }

  // ─── Success screen ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-10 max-w-md w-full text-center">
          <JulineMartLogo className="h-12 w-12 object-contain mx-auto mb-6" />
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Submitted!</h2>
          <p className="text-gray-500 mb-6 text-sm leading-relaxed">
            Thank you, <strong>{form.full_name}</strong>! Your application for <strong>{form.store_name}</strong> has been received.
            Our team will review your details and reach out to <strong>{form.email}</strong> within 2–3 business days.
          </p>
          <Link to="/login" className="btn-primary inline-block px-8 py-2.5 text-sm">
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  // ─── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 w-full max-w-xl">
        {/* Header */}
        <div className="brand-gradient px-8 pt-7 pb-6 rounded-t-2xl">
          <JulineMartLogo className="h-16 w-16 object-contain mb-4 drop-shadow-md rounded-full" />
          <h1 className="text-xl font-bold text-white">Become a JulineMart Vendor</h1>
          <p className="text-primary-200 text-xs mt-0.5 mb-5">Sell to thousands of customers across Nigeria</p>
          {/* Progress bar */}
          <div className="flex gap-2 mb-1">
            {([1,2,3,4] as Step[]).map(s => (
              <div key={s} className={`flex-1 h-1.5 rounded-full transition-colors ${s <= step ? 'bg-white' : 'bg-white/30'}`} />
            ))}
          </div>
          <div className="flex justify-between text-xs text-primary-200 mt-1">
            <span>Personal</span><span>Business</span><span>Bank</span><span>Documents</span>
          </div>
        </div>

        <div className="px-8 pb-8">

          {/* ── Step 1: Personal Info ── */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Personal Information</h2>
              <Field label="Full Name *" error={errors.full_name}>
                <input type="text" placeholder="John Doe" value={form.full_name}
                  onChange={e => set('full_name', e.target.value)}
                  className={input(errors.full_name)} />
              </Field>
              <Field label="Email Address *" error={errors.email}>
                <input type="email" placeholder="you@example.com" value={form.email}
                  onChange={e => set('email', e.target.value)}
                  className={input(errors.email)} />
              </Field>
              <Field label="Phone Number *" error={errors.phone}>
                <input type="tel" placeholder="08012345678" value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  className={input(errors.phone)} />
              </Field>
              <Field label="NIN or BVN" error={errors.nin_bvn}>
                <input type="text" placeholder="National ID or BVN number" value={form.nin_bvn}
                  onChange={e => set('nin_bvn', e.target.value)}
                  className={input(errors.nin_bvn)} />
              </Field>
            </div>
          )}

          {/* ── Step 2: Business Info ── */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Business Information</h2>
              <Field label="Store / Brand Name *" error={errors.store_name}>
                <input type="text" placeholder="Your Store Name" value={form.store_name}
                  onChange={e => set('store_name', e.target.value)}
                  className={input(errors.store_name)} />
              </Field>
              <Field label="Business Type *" error={errors.business_type}>
                <select value={form.business_type} onChange={e => set('business_type', e.target.value)}
                  className={input(errors.business_type)}>
                  <option value="">Select…</option>
                  <option value="individual">Individual / Sole Trader</option>
                  <option value="registered_business">Registered Business (CAC)</option>
                </select>
              </Field>
              {form.business_type === 'registered_business' && (
                <Field label="CAC RC Number *" error={errors.rc_number}>
                  <input type="text" placeholder="RC123456" value={form.rc_number}
                    onChange={e => set('rc_number', e.target.value)}
                    className={input(errors.rc_number)} />
                </Field>
              )}
              <Field label="Business Address">
                <input type="text" placeholder="No. 1, Commerce Street" value={form.business_address}
                  onChange={e => set('business_address', e.target.value)}
                  className={input()} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="State">
                  <select value={form.state} onChange={e => set('state', e.target.value)} className={input()}>
                    <option value="">Select…</option>
                    {NIGERIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="City">
                  <input type="text" placeholder="Lagos" value={form.city}
                    onChange={e => set('city', e.target.value)} className={input()} />
                </Field>
              </div>
            </div>
          )}

          {/* ── Step 3: Bank Details ── */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Bank Details</h2>
              <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
                Your earnings will be paid to this account. Ensure the details are correct.
              </p>
              <Field label="Bank Name *" error={errors.bank_name}>
                <select value={form.bank_name} onChange={e => set('bank_name', e.target.value)}
                  className={input(errors.bank_name)}>
                  <option value="">Select bank…</option>
                  {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Account Number *" error={errors.account_number}>
                <input type="text" placeholder="0123456789" maxLength={10} value={form.account_number}
                  onChange={e => set('account_number', e.target.value.replace(/\D/g, ''))}
                  className={input(errors.account_number)} />
              </Field>
              <Field label="Account Name *" error={errors.account_name}>
                <input type="text" placeholder="John Doe" value={form.account_name}
                  onChange={e => set('account_name', e.target.value)}
                  className={input(errors.account_name)} />
              </Field>
            </div>
          )}

          {/* ── Step 4: Documents ── */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">KYC Documents</h2>
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
                Upload clear copies if you have them. Accepted formats: JPG, PNG, PDF. Max 5MB each. You can submit without documents and complete KYC later if needed.
              </p>

              <Field label="Government-issued ID (optional)" error={errors.id_document}>
                <p className="text-xs text-gray-400 mb-1.5">NIN slip, voter&apos;s card, driver&apos;s licence, or international passport</p>
                <FileInput
                  value={form.id_document}
                  onChange={f => set('id_document', f)}
                  hasError={!!errors.id_document}
                />
              </Field>

              <Field label="CAC Certificate (if registered business)">
                <p className="text-xs text-gray-400 mb-1.5">Business registration certificate from CAC</p>
                <FileInput
                  value={form.cac_document}
                  onChange={f => set('cac_document', f)}
                />
              </Field>

              {submitError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {submitError}
                </div>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            {step > 1 ? (
              <button onClick={back} className="px-5 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition">
                ← Back
              </button>
            ) : (
              <Link to="/login" className="px-5 py-2.5 text-sm text-gray-500 hover:text-gray-700">
                Already a vendor? Sign in
              </Link>
            )}

            {step < 4 ? (
              <button onClick={next} className="btn-primary px-6 py-2.5 text-sm">
                Next →
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary px-6 py-2.5 text-sm flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {uploading ? 'Uploading…' : 'Submitting…'}
                  </>
                ) : 'Submit Application'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function input(error?: string) {
  return `w-full border rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none transition ${
    error ? 'border-red-400 bg-red-50' : 'border-gray-300 focus:border-purple-400'
  }`;
}

function FileInput({
  value,
  onChange,
  hasError,
}: {
  value: File | null;
  onChange: (f: File | null) => void;
  hasError?: boolean;
}) {
  return (
    <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition ${
      hasError ? 'border-red-400 bg-red-50' : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
    }`}>
      <input
        type="file"
        accept=".jpg,.jpeg,.png,.pdf"
        className="hidden"
        onChange={e => onChange(e.target.files?.[0] || null)}
      />
      <svg className="w-6 h-6 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
      <span className="text-sm text-gray-600">
        {value ? value.name : 'Click to upload or drag & drop'}
      </span>
    </label>
  );
}
