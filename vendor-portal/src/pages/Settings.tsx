import { useState, FormEvent } from 'react';
import { Settings as SettingsIcon, Store, CreditCard, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

export default function Settings() {
  const { vendor, refreshVendor } = useAuth();

  const [storeForm, setStoreForm] = useState({
    description: vendor?.description || '',
    logo_url:    vendor?.logo_url    || '',
    banner_url:  vendor?.banner_url  || '',
  });

  const [bankForm, setBankForm] = useState({
    bank_name:            vendor?.bank_name            || '',
    bank_account_number:  vendor?.bank_account_number  || '',
    bank_account_name:    vendor?.bank_account_name    || '',
  });

  const [saving, setSaving]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

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

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {error && (
        <div className="card flex items-center gap-3 text-red-600 bg-red-50 border-red-100">
          <AlertCircle className="w-5 h-5 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Store info (read-only) */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Store className="w-5 h-5 text-primary-600" />
          <h2 className="font-semibold text-gray-900">Store Information</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div><p className="text-gray-500 mb-0.5">Store Name</p><p className="font-medium">{vendor?.store_name}</p></div>
          <div><p className="text-gray-500 mb-0.5">Store Slug</p><p className="font-medium">{vendor?.store_slug}</p></div>
          <div><p className="text-gray-500 mb-0.5">Email</p><p className="font-medium">{vendor?.email}</p></div>
          <div><p className="text-gray-500 mb-0.5">Commission Rate</p><p className="font-medium text-primary-600">{vendor?.commission_rate}%</p></div>
          <div><p className="text-gray-500 mb-0.5">City</p><p className="font-medium">{vendor?.city || '—'}</p></div>
          <div><p className="text-gray-500 mb-0.5">State</p><p className="font-medium">{vendor?.state || '—'}</p></div>
        </div>
        <p className="text-xs text-gray-400">Contact JulineMart support to update store name, email, or commission rate.</p>
      </div>

      {/* Store profile (editable) */}
      <form onSubmit={e => { e.preventDefault(); save('store', storeForm); }} className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Store Profile</h2>
          </div>
          {success === 'store' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Saved</span>}
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Store Description</label>
            <textarea className="input" rows={3} value={storeForm.description} onChange={e => setStoreForm(p => ({ ...p, description: e.target.value }))} placeholder="Tell customers about your store..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
            <input className="input" value={storeForm.logo_url} onChange={e => setStoreForm(p => ({ ...p, logo_url: e.target.value }))} placeholder="https://..." />
            {storeForm.logo_url && <img src={storeForm.logo_url} alt="" className="mt-2 w-16 h-16 rounded-full object-cover border" onError={e => (e.currentTarget.style.display = 'none')} />}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Banner URL</label>
            <input className="input" value={storeForm.banner_url} onChange={e => setStoreForm(p => ({ ...p, banner_url: e.target.value }))} placeholder="https://..." />
            {storeForm.banner_url && <img src={storeForm.banner_url} alt="" className="mt-2 w-full h-24 object-cover rounded-lg border" onError={e => (e.currentTarget.style.display = 'none')} />}
          </div>
        </div>
        <button type="submit" disabled={saving === 'store'} className="btn-primary mt-4 text-sm">
          {saving === 'store' ? 'Saving...' : 'Save Profile'}
        </button>
      </form>

      {/* Bank details (editable) */}
      <form onSubmit={e => { e.preventDefault(); save('bank', bankForm); }} className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary-600" />
            <h2 className="font-semibold text-gray-900">Bank Details</h2>
          </div>
          {success === 'bank' && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle className="w-4 h-4" />Saved</span>}
        </div>
        <p className="text-xs text-gray-500 mb-4">Used for withdrawal requests. Make sure details are correct.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
            <input className="input" value={bankForm.bank_name} onChange={e => setBankForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="e.g. First Bank Nigeria" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
            <input className="input" value={bankForm.bank_account_number} onChange={e => setBankForm(p => ({ ...p, bank_account_number: e.target.value }))} placeholder="10-digit NUBAN" maxLength={10} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
            <input className="input" value={bankForm.bank_account_name} onChange={e => setBankForm(p => ({ ...p, bank_account_name: e.target.value }))} placeholder="Full name as registered" />
          </div>
        </div>
        <button type="submit" disabled={saving === 'bank'} className="btn-primary mt-4 text-sm">
          {saving === 'bank' ? 'Saving...' : 'Save Bank Details'}
        </button>
      </form>
    </div>
  );
}
