import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { JulineMartLogo } from '../components/JulineMartLogo';

const JLO_API = import.meta.env.VITE_JLO_API_URL || 'https://jlo.julinemart.com';

type Step = 1 | 2 | 3 | 4;
type FezCollectionMethod = 'fez_pickup' | 'hub_dropoff';

interface ApprovedLGA {
  id: string;
  lga: string;
  supports_vendor_direct_fez: boolean;
  supports_vendor_to_hub: boolean;
  supports_local_delivery: boolean;
  fez_hub_name: string | null;
  fez_hub_address: string | null;
  vendor_pickup_surcharge: number;
}

interface GroupedLocations {
  [state: string]: {
    [city: string]: ApprovedLGA[];
  };
}

interface FormData {
  // Step 1
  full_name: string;
  email: string;
  phone: string;
  nin_bvn: string;
  // Step 2
  store_name: string;
  business_type: 'individual' | 'registered_business' | '';
  rc_number: string;
  business_address: string;
  state: string;
  city: string;
  lga: string;
  approved_location_id: string;
  fez_collection_method: FezCollectionMethod | '';
  // Step 3
  bank_name: string;
  account_number: string;
  account_name: string;
  // Step 4
  id_document: File | null;
  cac_document: File | null;
}

const BANKS = [
  '9 Payment Service Bank (9PSB)', 'Access Bank', 'Carbon Microfinance Bank',
  'Citibank', 'EcoBank', 'Fairmoney Microfinance Bank', 'Fidelity Bank',
  'First Bank of Nigeria', 'First City Monument Bank (FCMB)', 'Globus Bank',
  'GT Bank', 'Heritage Bank', 'Jaiz Bank', 'Keystone Bank', 'Kuda Microfinance Bank',
  'Lotus Bank', 'Moniepoint Microfinance Bank', 'Opay', 'Palmpay', 'Parallex Bank',
  'Polaris Bank', 'Providus Bank', 'Stanbic IBTC Bank', 'Standard Chartered Bank',
  'Sterling Bank', 'SunTrust Bank', 'Titan Trust Bank', 'UBA', 'Union Bank',
  'Unity Bank', 'VFD Microfinance Bank', 'Wema Bank', 'Zenith Bank',
];

export default function Register() {
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>({
    full_name: '', email: '', phone: '', nin_bvn: '',
    store_name: '', business_type: '', rc_number: '', business_address: '',
    state: '', city: '', lga: '', approved_location_id: '', fez_collection_method: '',
    bank_name: '', account_number: '', account_name: '',
    id_document: null, cac_document: null,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Approved locations
  const [grouped, setGrouped] = useState<GroupedLocations>({});
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [selectedLocation, setSelectedLocation] = useState<ApprovedLGA | null>(null);

  // Waitlist
  const [showWaitlist, setShowWaitlist] = useState(false);
  const [waitlistState, setWaitlistState] = useState('');
  const [waitlistCity, setWaitlistCity] = useState('');
  const [waitlistLga, setWaitlistLga] = useState('');
  const [waitlistCategory, setWaitlistCategory] = useState('');
  const [waitlistVolume, setWaitlistVolume] = useState('');
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [waitlistError, setWaitlistError] = useState('');

  const set = (field: keyof FormData, value: string | File | null) =>
    setForm(f => ({ ...f, [field]: value }));

  // ── Load approved locations once ────────────────────────────────────────────
  useEffect(() => {
    (supabase as any)
      .from('approved_vendor_locations')
      .select('id,state,city,lga,supports_vendor_direct_fez,supports_vendor_to_hub,supports_local_delivery,fez_hub_name,fez_hub_address,vendor_pickup_surcharge')
      .eq('status', 'active')
      .order('state').order('city').order('lga')
      .then(({ data, error }: { data: any[] | null; error: any }) => {
        if (error || !data) return;
        const g: GroupedLocations = {};
        for (const loc of data) {
          if (!g[loc.state]) g[loc.state] = {};
          if (!g[loc.state][loc.city]) g[loc.state][loc.city] = [];
          g[loc.state][loc.city].push({
            id: loc.id, lga: loc.lga,
            supports_vendor_direct_fez: loc.supports_vendor_direct_fez,
            supports_vendor_to_hub: loc.supports_vendor_to_hub,
            supports_local_delivery: loc.supports_local_delivery,
            fez_hub_name: loc.fez_hub_name,
            fez_hub_address: loc.fez_hub_address,
            vendor_pickup_surcharge: loc.vendor_pickup_surcharge,
          });
        }
        setGrouped(g);
      })
      .finally(() => setLocationsLoading(false));
  }, []);

  const approvedStates = Object.keys(grouped).sort();
  const approvedCities = form.state ? Object.keys(grouped[form.state] || {}).sort() : [];
  const approvedLGAs   = (form.state && form.city) ? (grouped[form.state]?.[form.city] || []) : [];

  function handleStateChange(newState: string) {
    setForm(f => ({ ...f, state: newState, city: '', lga: '', approved_location_id: '', fez_collection_method: '' }));
    setSelectedLocation(null);
    setShowWaitlist(false);
  }

  function handleCityChange(newCity: string) {
    setForm(f => ({ ...f, city: newCity, lga: '', approved_location_id: '', fez_collection_method: '' }));
    setSelectedLocation(null);
    setShowWaitlist(false);
  }

  function handleLGAChange(lgaId: string) {
    const loc = approvedLGAs.find(l => l.id === lgaId) || null;
    setSelectedLocation(loc);
    if (loc) {
      const defaultMethod: FezCollectionMethod =
        loc.supports_vendor_direct_fez ? 'fez_pickup' : 'hub_dropoff';
      setForm(f => ({
        ...f,
        lga: loc.lga,
        approved_location_id: loc.id,
        fez_collection_method: defaultMethod,
      }));
    } else {
      setForm(f => ({ ...f, lga: '', approved_location_id: '', fez_collection_method: '' }));
    }
    setShowWaitlist(false);
  }

  // ── Waitlist submit ──────────────────────────────────────────────────────────
  async function handleWaitlistSubmit() {
    if (!waitlistState || !waitlistCity || !form.full_name || !form.email) {
      setWaitlistError('Please fill your name, email, state, and city above before joining the waitlist.');
      return;
    }
    setWaitlistSubmitting(true);
    setWaitlistError('');
    try {
      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name:          form.full_name,
          email:              form.email,
          phone:              form.phone,
          state:              waitlistState,
          city:               waitlistCity,
          lga:                waitlistLga || undefined,
          vendor_category:    waitlistCategory || undefined,
          est_monthly_orders: waitlistVolume ? parseInt(waitlistVolume, 10) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok && !data.success) {
        setWaitlistError(data.error || 'Failed to join waitlist. Please try again.');
      } else {
        setWaitlistSubmitted(true);
      }
    } catch {
      setWaitlistError('Network error. Please try again.');
    } finally {
      setWaitlistSubmitting(false);
    }
  }

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
      if (!form.approved_location_id) e.lga = 'Select your city and area from the approved locations list';
      if (!form.fez_collection_method) e.fez_collection_method = 'Select how Fez will collect your orders';
    }
    if (s === 3) {
      if (!form.bank_name) e.bank_name = 'Select a bank';
      if (!form.account_number.trim() || form.account_number.length < 10) e.account_number = '10-digit account number required';
      if (!form.account_name.trim()) e.account_name = 'Required';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() { if (validateStep(step)) setStep(s => (s + 1) as Step); }
  function back() { setStep(s => (s - 1) as Step); }

  // ── Upload doc ───────────────────────────────────────────────────────────────
  async function uploadDoc(file: File, path: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from('vendor-documents')
      .upload(path, file, { upsert: true });
    if (error) { console.error(error); return null; }
    const { data: { publicUrl } } = supabase.storage.from('vendor-documents').getPublicUrl(data.path);
    return publicUrl;
  }

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!validateStep(4)) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      setUploading(true);
      const ts = Date.now();
      const slug = form.email.replace(/[^a-z0-9]/gi, '_');
      let idUrl: string | null = null;
      let cacUrl: string | null = null;
      if (form.id_document) idUrl = await uploadDoc(form.id_document, `${slug}/${ts}_id.${form.id_document.name.split('.').pop()}`);
      if (form.cac_document) cacUrl = await uploadDoc(form.cac_document, `${slug}/${ts}_cac.${form.cac_document.name.split('.').pop()}`);
      setUploading(false);

      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personal: { full_name: form.full_name, email: form.email, phone: form.phone, nin_bvn: form.nin_bvn || undefined },
          business: {
            store_name:           form.store_name,
            business_type:        form.business_type || undefined,
            rc_number:            form.rc_number || undefined,
            business_address:     form.business_address || undefined,
            state:                form.state || undefined,
            city:                 form.city || undefined,
            lga:                  form.lga || undefined,
            approved_location_id: form.approved_location_id,
            fez_collection_method: form.fez_collection_method,
          },
          bank: { bank_name: form.bank_name || undefined, account_number: form.account_number || undefined, account_name: form.account_name || undefined },
          documents: { id_url: idUrl || undefined, cac_url: cacUrl || undefined },
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

  // ─── Success screen ──────────────────────────────────────────────────────────
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
          <Link to="/login" className="btn-primary inline-block px-8 py-2.5 text-sm">Back to Login</Link>
        </div>
      </div>
    );
  }

  // ─── Form ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-card border border-gray-100 w-full max-w-xl">
        <div className="brand-gradient px-8 pt-7 pb-6 rounded-t-2xl">
          <JulineMartLogo className="h-16 w-16 object-contain mb-4 drop-shadow-md rounded-full" />
          <h1 className="text-xl font-bold text-white">Become a JulineMart Vendor</h1>
          <p className="text-primary-200 text-xs mt-0.5 mb-5">Sell to thousands of customers across Nigeria</p>
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

          {/* ── Step 1 ── */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Personal Information</h2>
              <Field label="Full Name *" error={errors.full_name}>
                <input type="text" placeholder="John Doe" value={form.full_name}
                  onChange={e => set('full_name', e.target.value)} className={input(errors.full_name)} />
              </Field>
              <Field label="Email Address *" error={errors.email}>
                <input type="email" placeholder="you@example.com" value={form.email}
                  onChange={e => set('email', e.target.value)} className={input(errors.email)} />
              </Field>
              <Field label="Phone Number *" error={errors.phone}>
                <input type="tel" placeholder="08012345678" value={form.phone}
                  onChange={e => set('phone', e.target.value)} className={input(errors.phone)} />
              </Field>
              <Field label="NIN or BVN" error={errors.nin_bvn}>
                <input type="text" placeholder="National ID or BVN number" value={form.nin_bvn}
                  onChange={e => set('nin_bvn', e.target.value)} className={input(errors.nin_bvn)} />
              </Field>
            </div>
          )}

          {/* ── Step 2 ── */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Business Information</h2>

              <Field label="Store / Brand Name *" error={errors.store_name}>
                <input type="text" placeholder="Your Store Name" value={form.store_name}
                  onChange={e => set('store_name', e.target.value)} className={input(errors.store_name)} />
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
                    onChange={e => set('rc_number', e.target.value)} className={input(errors.rc_number)} />
                </Field>
              )}
              <Field label="Business Address">
                <input type="text" placeholder="No. 1, Commerce Street" value={form.business_address}
                  onChange={e => set('business_address', e.target.value)} className={input()} />
              </Field>

              {/* ── Location cascade ── */}
              <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Your Location</p>
                <p className="text-xs text-gray-500">JulineMart only onboards vendors from approved service areas. Select your exact location below.</p>

                {locationsLoading ? (
                  <div className="text-sm text-gray-400 py-2">Loading available locations…</div>
                ) : (
                  <>
                    <Field label="State *" error={undefined}>
                      <select value={form.state} onChange={e => handleStateChange(e.target.value)} className={input()}>
                        <option value="">Select state…</option>
                        {approvedStates.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </Field>

                    {form.state && (
                      <Field label="City *" error={undefined}>
                        <select value={form.city} onChange={e => handleCityChange(e.target.value)} className={input()}>
                          <option value="">Select city…</option>
                          {approvedCities.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </Field>
                    )}

                    {form.state && form.city && (
                      <Field label="Area / LGA *" error={errors.lga}>
                        <select
                          value={form.approved_location_id}
                          onChange={e => handleLGAChange(e.target.value)}
                          className={input(errors.lga)}
                        >
                          <option value="">Select area…</option>
                          {approvedLGAs.map(l => <option key={l.id} value={l.id}>{l.lga}</option>)}
                        </select>
                      </Field>
                    )}

                    {/* City not in approved list — waitlist prompt */}
                    {form.state && !approvedStates.includes(form.state) && (
                      <UnapprovedLocation
                        state={waitlistState} city={waitlistCity} lga={waitlistLga}
                        category={waitlistCategory} volume={waitlistVolume}
                        onStateChange={setWaitlistState} onCityChange={setWaitlistCity}
                        onLgaChange={setWaitlistLga} onCategoryChange={setWaitlistCategory}
                        onVolumeChange={setWaitlistVolume}
                        onSubmit={handleWaitlistSubmit}
                        submitting={waitlistSubmitting} submitted={waitlistSubmitted} error={waitlistError}
                      />
                    )}

                    {/* Fez collection method — shown after LGA is selected */}
                    {selectedLocation && (
                      <div className="mt-2 space-y-2">
                        <p className="text-xs font-medium text-gray-700">How will Fez collect your orders?</p>

                        {selectedLocation.supports_vendor_direct_fez && (
                          <label className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition ${
                            form.fez_collection_method === 'fez_pickup'
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}>
                            <input type="radio" name="fez_method" value="fez_pickup"
                              checked={form.fez_collection_method === 'fez_pickup'}
                              onChange={() => set('fez_collection_method', 'fez_pickup')}
                              className="mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-gray-800">Fez picks up from my shop</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                A Fez rider comes to your business address to collect parcels.
                                {selectedLocation.vendor_pickup_surcharge > 0 &&
                                  ` A pickup fee of ₦${selectedLocation.vendor_pickup_surcharge.toLocaleString()} applies per collection.`}
                              </p>
                            </div>
                          </label>
                        )}

                        {(selectedLocation.supports_vendor_to_hub || selectedLocation.supports_local_delivery) && (
                          <label className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition ${
                            form.fez_collection_method === 'hub_dropoff'
                              ? 'border-purple-500 bg-purple-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}>
                            <input type="radio" name="fez_method" value="hub_dropoff"
                              checked={form.fez_collection_method === 'hub_dropoff'}
                              onChange={() => set('fez_collection_method', 'hub_dropoff')}
                              className="mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-gray-800">I drop off at Fez hub</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                You bring your parcel to the nearest Fez collection point.
                                {selectedLocation.fez_hub_name &&
                                  ` Nearest hub: ${selectedLocation.fez_hub_name}${selectedLocation.fez_hub_address ? ` — ${selectedLocation.fez_hub_address}` : ''}.`}
                              </p>
                            </div>
                          </label>
                        )}

                        {errors.fez_collection_method && (
                          <p className="text-xs text-red-500">{errors.fez_collection_method}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Waitlist entry point for users who type a city not in the list */}
              {!showWaitlist && approvedStates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowWaitlist(true)}
                  className="text-xs text-purple-600 underline hover:text-purple-800 mt-1"
                >
                  My city isn't listed — join the waitlist
                </button>
              )}

              {showWaitlist && (
                <UnapprovedLocation
                  state={waitlistState} city={waitlistCity} lga={waitlistLga}
                  category={waitlistCategory} volume={waitlistVolume}
                  onStateChange={setWaitlistState} onCityChange={setWaitlistCity}
                  onLgaChange={setWaitlistLga} onCategoryChange={setWaitlistCategory}
                  onVolumeChange={setWaitlistVolume}
                  onSubmit={handleWaitlistSubmit}
                  submitting={waitlistSubmitting} submitted={waitlistSubmitted} error={waitlistError}
                />
              )}
            </div>
          )}

          {/* ── Step 3 ── */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Bank Details</h2>
              <p className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg p-3">
                Your earnings will be paid to this account. Ensure the details are correct.
              </p>
              <Field label="Bank Name *" error={errors.bank_name}>
                <select value={form.bank_name} onChange={e => set('bank_name', e.target.value)} className={input(errors.bank_name)}>
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
                  onChange={e => set('account_name', e.target.value)} className={input(errors.account_name)} />
              </Field>
            </div>
          )}

          {/* ── Step 4 ── */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">KYC Documents</h2>
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
                Upload clear copies if you have them. Accepted: JPG, PNG, PDF. Max 5MB each. You can complete KYC later if needed.
              </p>
              <Field label="Government-issued ID (optional)" error={errors.id_document}>
                <p className="text-xs text-gray-400 mb-1.5">NIN slip, voter's card, driver's licence, or international passport</p>
                <FileInput value={form.id_document} onChange={f => set('id_document', f)} hasError={!!errors.id_document} />
              </Field>
              <Field label="CAC Certificate (if registered business)">
                <p className="text-xs text-gray-400 mb-1.5">Business registration certificate from CAC</p>
                <FileInput value={form.cac_document} onChange={f => set('cac_document', f)} />
              </Field>
              {submitError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{submitError}</div>
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
              <button onClick={next} className="btn-primary px-6 py-2.5 text-sm">Next →</button>
            ) : (
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary px-6 py-2.5 text-sm flex items-center gap-2">
                {submitting ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {uploading ? 'Uploading…' : 'Submitting…'}</>
                ) : 'Submit Application'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Waitlist inline form ──────────────────────────────────────────────────────
function UnapprovedLocation({
  state, city, lga, category, volume,
  onStateChange, onCityChange, onLgaChange, onCategoryChange, onVolumeChange,
  onSubmit, submitting, submitted, error,
}: {
  state: string; city: string; lga: string; category: string; volume: string;
  onStateChange: (v: string) => void; onCityChange: (v: string) => void;
  onLgaChange: (v: string) => void; onCategoryChange: (v: string) => void;
  onVolumeChange: (v: string) => void;
  onSubmit: () => void; submitting: boolean; submitted: boolean; error: string;
}) {
  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
        <p className="text-sm font-medium text-green-800">You're on the waitlist!</p>
        <p className="text-xs text-green-600 mt-1">We'll email you as soon as JulineMart is ready in your area.</p>
      </div>
    );
  }
  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
      <p className="text-sm font-semibold text-amber-800">JulineMart is not yet onboarding vendors from this location</p>
      <p className="text-xs text-amber-700">Join the waitlist and we'll notify you when your city becomes active.</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-600 mb-1 block">State</label>
          <input type="text" placeholder="e.g. Ogun" value={state} onChange={e => onStateChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">City</label>
          <input type="text" placeholder="e.g. Sagamu" value={city} onChange={e => onCityChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-600 mb-1 block">LGA / Area (optional)</label>
        <input type="text" placeholder="e.g. Sagamu" value={lga} onChange={e => onLgaChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-600 mb-1 block">What do you sell?</label>
          <input type="text" placeholder="e.g. Fashion" value={category} onChange={e => onCategoryChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">Est. monthly orders</label>
          <input type="number" placeholder="e.g. 50" value={volume} onChange={e => onVolumeChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={onSubmit} disabled={submitting}
        className="w-full bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition">
        {submitting ? 'Joining…' : 'Join Waitlist'}
      </button>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
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

function FileInput({ value, onChange, hasError }: { value: File | null; onChange: (f: File | null) => void; hasError?: boolean }) {
  return (
    <label className={`flex items-center gap-3 border-2 border-dashed rounded-lg p-4 cursor-pointer transition ${
      hasError ? 'border-red-400 bg-red-50' : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
    }`}>
      <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={e => onChange(e.target.files?.[0] || null)} />
      <svg className="w-6 h-6 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
      <span className="text-sm text-gray-600">{value ? value.name : 'Click to upload or drag & drop'}</span>
    </label>
  );
}
