import { useState, FormEvent, useRef } from 'react';
import { Settings as SettingsIcon, Store, CreditCard, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

async function uploadBrandingImage(file: File, vendorId: string, kind: 'logo' | 'banner'): Promise<string> {
  const raw = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(raw) ? raw : 'jpg';
  const path = `branding/${vendorId}/${kind}_${Date.now()}.${safeExt}`;
  const { data, error } = await supabase.storage
    .from('vendor-documents')
    .upload(path, file, {
      upsert: true,
      contentType: file.type || `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
    });
  if (error) throw new Error(error.message);
  const { data: pub } = supabase.storage.from('vendor-documents').getPublicUrl(data.path);
  return pub.publicUrl;
}

export default function Settings() {
  const { vendor, refreshVendor } = useAuth();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const [storeForm, setStoreForm] = useState({
    description: vendor?.description || '',
    logo_url:    vendor?.logo_url    || '',
    banner_url:  vendor?.banner_url  || '',
  });

  const [bankForm, setBankForm] = useState({
    bank_name:           vendor?.bank_name           || '',
    bank_account_number: vendor?.bank_account_number || '',
    bank_account_name:   vendor?.bank_account_name   || '',
  });

  const [saving, setSaving]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  const save = async (section: string, updates: object) => {
    setSaving(section); setSuccess(null); setError(null);
    try {
      await api.updateProfile(updates);
      await refreshVendor();
      setSuccess(section);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(null); }
  };

  async function onPickLogo(file: File | null) {
    if (!file || !vendor?.id) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image must be 4 MB or smaller.');
      return;
    }
    setError(null);
    setUploadingLogo(true);
    try {
      const url = await uploadBrandingImage(file, vendor.id, 'logo');
      setStoreForm((p) => ({ ...p, logo_url: url }));
    } catch (e: any) {
      setError(e?.message || 'Logo upload failed. Try again or use a URL below.');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function onPickBanner(file: File | null) {
    if (!file || !vendor?.id) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image must be 4 MB or smaller.');
      return;
    }
    setError(null);
    setUploadingBanner(true);
    try {
      const url = await uploadBrandingImage(file, vendor.id, 'banner');
      setStoreForm((p) => ({ ...p, banner_url: url }));
    } catch (e: any) {
      setError(e?.message || 'Banner upload failed. Try again or use a URL below.');
    } finally {
      setUploadingBanner(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>

      {error && (
        <div className="card flex items-center gap-3 text-red-600 bg-red-50 border-red-100">
          <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="lg:grid lg:grid-cols-5 lg:gap-6 lg:items-start space-y-4 lg:space-y-0">
        {/* Left col: store info (read-only) */}
        <div className="lg:col-span-2">
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <Store className="w-5 h-5 text-primary-600" />
              <h2 className="font-semibold text-gray-900">Store Information</h2>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Store Name',      value: vendor?.store_name },
                { label: 'Email',           value: vendor?.email },
                { label: 'Commission Rate', value: vendor?.commission_rate != null ? `${vendor.commission_rate}%` : undefined, color: 'text-primary-600' },
                { label: 'Phone',           value: (vendor as any)?.phone },
                { label: 'City',            value: vendor?.city },
                { label: 'State',           value: vendor?.state },
                { label: 'Address',         value: vendor?.address },
              ].map(f => (
                <div key={f.label} className="flex justify-between items-start py-3 border-b border-gray-50 last:border-0 gap-4">
                  <span className="text-sm text-gray-500 flex-shrink-0">{f.label}</span>
                  <span className={`text-sm font-semibold text-right break-all ${f.color || 'text-gray-900'}`}>{f.value || '—'}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Contact JulineMart support to update store name, email, or commission rate.</p>
          </div>
        </div>

        {/* Right col: editable forms */}
        <div className="lg:col-span-3 space-y-4">
          {/* Store profile — editable */}
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); save('store', storeForm); }} className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-gray-900">Store Profile</h2>
              </div>
              {success === 'store' && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Store Description</label>
                <textarea
                  className="input"
                  rows={3}
                  value={storeForm.description}
                  onChange={e => setStoreForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Tell customers about your store…"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Store logo</label>
                <p className="text-xs text-gray-500 mb-2">Upload a square image from your phone or computer (max 4 MB).</p>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => onPickLogo(e.target.files?.[0] ?? null)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={uploadingLogo || !vendor?.id}
                    onClick={() => logoInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    {uploadingLogo ? (
                      <span className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 text-primary-600" />
                    )}
                    {uploadingLogo ? 'Uploading…' : 'Upload from device'}
                  </button>
                </div>
                {storeForm.logo_url && (
                  <img
                    src={storeForm.logo_url}
                    alt=""
                    className="mt-2 w-16 h-16 rounded-full object-cover border"
                    onError={e => (e.currentTarget.style.display = 'none')}
                  />
                )}
                <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">Or paste image URL</label>
                <input
                  className="input text-sm"
                  value={storeForm.logo_url}
                  onChange={e => setStoreForm(p => ({ ...p, logo_url: e.target.value }))}
                  placeholder="https://…"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Store banner</label>
                <p className="text-xs text-gray-500 mb-2">Wide image for your store header (max 4 MB).</p>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => onPickBanner(e.target.files?.[0] ?? null)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={uploadingBanner || !vendor?.id}
                    onClick={() => bannerInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    {uploadingBanner ? (
                      <span className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 text-primary-600" />
                    )}
                    {uploadingBanner ? 'Uploading…' : 'Upload from device'}
                  </button>
                </div>
                {storeForm.banner_url && (
                  <img
                    src={storeForm.banner_url}
                    alt=""
                    className="mt-2 w-full h-24 object-cover rounded-xl border"
                    onError={e => (e.currentTarget.style.display = 'none')}
                  />
                )}
                <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">Or paste image URL</label>
                <input
                  className="input text-sm"
                  value={storeForm.banner_url}
                  onChange={e => setStoreForm(p => ({ ...p, banner_url: e.target.value }))}
                  placeholder="https://…"
                />
              </div>
            </div>
            <button type="submit" disabled={saving === 'store'} className="btn-primary w-full mt-5">
              {saving === 'store' ? 'Saving…' : 'Save Profile'}
            </button>
          </form>

          {/* Bank details — editable */}
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); save('bank', bankForm); }} className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-gray-900">Bank Details</h2>
              </div>
              {success === 'bank' && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Saved
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-4">Used for withdrawal payments. Ensure details are correct.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Bank Name</label>
                <input className="input" value={bankForm.bank_name} onChange={e => setBankForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="e.g. First Bank Nigeria" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Account Number</label>
                <input className="input" inputMode="numeric" value={bankForm.bank_account_number} onChange={e => setBankForm(p => ({ ...p, bank_account_number: e.target.value }))} placeholder="10-digit NUBAN" maxLength={10} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Account Name</label>
                <input className="input" value={bankForm.bank_account_name} onChange={e => setBankForm(p => ({ ...p, bank_account_name: e.target.value }))} placeholder="Full name as registered" />
              </div>
            </div>
            <button type="submit" disabled={saving === 'bank'} className="btn-primary w-full mt-5">
              {saving === 'bank' ? 'Saving…' : 'Save Bank Details'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
