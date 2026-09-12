import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

export default function Profile() {
  const { influencer, refreshInfluencer, signOut } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    phone: influencer?.phone || '',
    platform: influencer?.platform || 'instagram',
    handle: influencer?.handle || '',
    bank_name: influencer?.bank_name || '',
    account_number: influencer?.account_number || '',
    account_name: influencer?.account_name || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  if (!influencer) return null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await api.updateProfile(form);
      await refreshInfluencer();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="text-gray-500 mt-1">Update your contact info and payout bank details.</p>
      </div>

      {/* Read-only coupon terms */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-3">Coupon Terms</h3>
        <p className="text-xs text-gray-400 mb-3">Set by JulineMart — contact support to change these.</p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Coupon Code</p>
            <p className="font-mono font-semibold">{influencer.coupon_code}</p>
          </div>
          <div>
            <p className="text-gray-500">Commission Rate</p>
            <p className="font-semibold">{influencer.commission_rate}%</p>
          </div>
          <div>
            <p className="text-gray-500">Tier</p>
            <p className="font-semibold">{influencer.tier}</p>
          </div>
          <div>
            <p className="text-gray-500">Status</p>
            <p className="font-semibold capitalize">{influencer.status}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>
        )}
        {saved && (
          <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-3 text-sm">Saved.</div>
        )}

        <div>
          <h3 className="font-semibold text-gray-900 mb-3">Contact & Social</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
              <input
                type="tel"
                className="input"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Platform</label>
              <select
                className="input"
                value={form.platform}
                onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
              >
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="facebook">Facebook</option>
                <option value="youtube">YouTube</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Handle</label>
              <input
                type="text"
                className="input"
                value={form.handle}
                onChange={e => setForm(f => ({ ...f, handle: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-100">
          <h3 className="font-semibold text-gray-900 mb-1">Payout Bank Details</h3>
          <p className="text-xs text-gray-400 mb-3">Where JulineMart sends your commission payments.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Bank Name</label>
              <input
                type="text"
                className="input"
                value={form.bank_name}
                onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
                placeholder="e.g. GTBank"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Account Number</label>
              <input
                type="text"
                className="input"
                value={form.account_number}
                onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Account Name</label>
              <input
                type="text"
                className="input"
                value={form.account_name}
                onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary w-full sm:w-auto">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      <button
        onClick={handleSignOut}
        className="lg:hidden flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors border border-gray-200"
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>
    </div>
  );
}
