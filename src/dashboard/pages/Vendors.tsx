import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Mail, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Eye, Send, AlertTriangle, Pencil, X, Check, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string;
  store_name: string;
  email: string;
  phone: string;
  commission_rate: number;
  is_active: boolean;
  user_id: string | null;
  created_at: string;
}

interface Application {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  store_name: string;
  business_type: string | null;
  rc_number: string | null;
  business_address: string | null;
  state: string | null;
  city: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  id_document_url: string | null;
  cac_document_url: string | null;
  nin_bvn: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return (
    lower.includes('@wcfm.local') ||
    lower.includes('@placeholder') ||
    lower.includes('@localhost') ||
    lower.includes('@example.com')
  );
}

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

const API = import.meta.env.VITE_API_URL || '';

async function callApi(path: string, body: object) {
  const token = await getToken();
  const res = await fetch(`${API}/.netlify/functions/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Component ────────────────────────────────────────────────────────────────

type Tab = 'vendors' | 'applications';

export function VendorsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('vendors');

  // Vendors
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);

  // Inline email edit
  const [editingEmail, setEditingEmail] = useState<string | null>(null); // vendor id
  const [emailDraft, setEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [syncDetails, setSyncDetails] = useState<any[] | null>(null);
  const [showSyncDebug, setShowSyncDebug] = useState(false);

  // Applications
  const [apps, setApps] = useState<Application[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appFilter, setAppFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState<string | null>(null);

  const loadVendors = useCallback(async () => {
    setVendorsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('vendors')
      .select('id, store_name, email, phone, commission_rate, is_active, user_id, created_at')
      .order('store_name');
    setVendors((data as Vendor[]) || []);
    setVendorsLoading(false);
  }, []);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase as any)
      .from('vendor_applications')
      .select('*')
      .order('created_at', { ascending: false });
    if (appFilter !== 'all') q = q.eq('status', appFilter);
    const { data } = await q;
    setApps((data as Application[]) || []);
    setAppsLoading(false);
  }, [appFilter]);

  useEffect(() => { loadVendors(); }, [loadVendors]);
  useEffect(() => { loadApps(); }, [loadApps]);

  // ── Sync vendor profiles from WCFM ────────────────────────────────────────
  async function handleSyncProfiles() {
    setSyncing(true);
    setSyncResult(null);
    setSyncDetails(null);
    setShowSyncDebug(false);
    const res = await callApi('vendor-sync-profiles', {});
    if (res.success) {
      setSyncResult(`Done — ${res.updated} updated, ${res.skipped} skipped, ${res.errored} errors`);
      setSyncDetails(res.results || []);
      loadVendors();
    } else {
      setSyncResult('Error: ' + (res.error || 'Unknown'));
      setSyncDetails(res.debug ? [{ debug: res.debug }] : null);
      setShowSyncDebug(true);
    }
    setSyncing(false);
  }

  // ── Invite existing vendor ─────────────────────────────────────────────────
  async function handleInvite(vendorId: string) {
    setInviting(vendorId);
    setInviteMsg(null);
    const res = await callApi('vendor-invite', { vendor_id: vendorId });
    setInviteMsg({
      id: vendorId,
      msg: res.message || res.error || 'Unknown error',
      ok: !!res.success,
    });
    setInviting(null);
    if (res.success) loadVendors();
  }

  // ── Inline email update ────────────────────────────────────────────────────
  function startEditEmail(v: Vendor) {
    setEditingEmail(v.id);
    setEmailDraft(isPlaceholderEmail(v.email) ? '' : (v.email || ''));
    setEmailMsg(null);
    setInviteMsg(null);
  }

  function cancelEditEmail() {
    setEditingEmail(null);
    setEmailDraft('');
  }

  async function saveEmail(vendorId: string) {
    const trimmed = emailDraft.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailMsg({ id: vendorId, msg: 'Enter a valid email address', ok: false });
      return;
    }
    setSavingEmail(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('vendors')
      .update({ email: trimmed })
      .eq('id', vendorId);
    setSavingEmail(false);
    if (error) {
      setEmailMsg({ id: vendorId, msg: error.message, ok: false });
    } else {
      setVendors(prev => prev.map(v => v.id === vendorId ? { ...v, email: trimmed } : v));
      setEmailMsg({ id: vendorId, msg: 'Email updated', ok: true });
      setEditingEmail(null);
      setEmailDraft('');
    }
  }

  // ── Approve application ────────────────────────────────────────────────────
  async function handleApprove(appId: string) {
    setActioning(appId);
    const res = await callApi('vendor-approve', { application_id: appId, action: 'approve' });
    if (res.success) {
      setApps(prev => prev.map(a => a.id === appId ? { ...a, status: 'approved' } : a));
    } else {
      alert('Error: ' + res.error);
    }
    setActioning(null);
  }

  // ── Reject application ─────────────────────────────────────────────────────
  async function handleReject(appId: string) {
    setActioning(appId);
    const res = await callApi('vendor-approve', { application_id: appId, action: 'reject', reject_reason: rejectReason });
    if (res.success) {
      setApps(prev => prev.map(a => a.id === appId ? { ...a, status: 'rejected', reject_reason: rejectReason } : a));
      setShowRejectInput(null);
      setRejectReason('');
    } else {
      alert('Error: ' + res.error);
    }
    setActioning(null);
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const pendingCount = apps.filter(a => a.status === 'pending').length;
  const placeholderCount = vendors.filter(v => isPlaceholderEmail(v.email)).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Store className="w-6 h-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-3">
            {syncResult && (
              <span className="text-sm text-gray-500">{syncResult}</span>
            )}
            {syncDetails && syncDetails.length > 0 && (
              <button
                onClick={() => setShowSyncDebug(v => !v)}
                className="text-xs text-purple-600 underline"
              >
                {showSyncDebug ? 'Hide' : 'Details'}
              </button>
            )}
            <button
              onClick={handleSyncProfiles}
              disabled={syncing}
              className="inline-flex items-center gap-2 text-sm bg-white border border-gray-300 hover:border-purple-400 text-gray-700 hover:text-purple-700 px-4 py-2 rounded-lg disabled:opacity-50 transition"
              title="Pull phone, address, description and logo for all vendors from WCFM"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing profiles…' : 'Sync from WCFM'}
            </button>
          </div>
          {showSyncDebug && syncDetails && (
            <div className="w-full max-w-2xl bg-gray-900 text-green-300 text-xs rounded-lg p-3 font-mono overflow-auto max-h-64 mt-1">
              {syncDetails.map((r: any, i: number) => (
                <div key={i} className={`mb-1 ${r.status === 'error' ? 'text-red-400' : r.status === 'updated' ? 'text-green-400' : 'text-yellow-300'}`}>
                  [{r.status?.toUpperCase() || 'INFO'}] WP#{r.wpId} {r.store || ''}
                  {r.reason ? ` — ${r.reason}` : ''}
                  {r.fields ? ` ✓ ${r.fields.join(', ')}` : ''}
                  {r.error ? ` ✗ ${r.error}` : ''}
                  {r.debug ? ` | url: ${r.debug.url} | body: ${r.debug.body}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['vendors', 'applications'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'vendors' ? (
              <span className="flex items-center gap-2">
                Active Vendors
                {placeholderCount > 0 && (
                  <span className="bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none" title="Vendors with placeholder emails">
                    {placeholderCount}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Applications
                {pendingCount > 0 && (
                  <span className="bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                    {pendingCount}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── VENDORS TAB ── */}
      {tab === 'vendors' && (
        <div>
          {placeholderCount > 0 && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
              <span>
                <strong>{placeholderCount} vendor{placeholderCount > 1 ? 's' : ''}</strong> still have placeholder emails from the WooCommerce migration.
                Click the <Pencil className="w-3 h-3 inline" /> icon to update their real email before sending an invite.
              </span>
            </div>
          )}

          <p className="text-sm text-gray-500 mb-4">
            Click <strong>Send Invite</strong> to create a vendor portal account and send a setup email.
            Vendors with a linked account show a green badge.
          </p>

          {vendorsLoading ? (
            <div className="text-center py-16 text-gray-400">Loading vendors…</div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Store</th>
                    <th className="px-4 py-3 text-left">Email</th>
                    <th className="px-4 py-3 text-left">Phone</th>
                    <th className="px-4 py-3 text-center">Commission</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-center">Portal</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vendors.map(v => {
                    const placeholder = isPlaceholderEmail(v.email);
                    return (
                      <tr key={v.id} className={`hover:bg-gray-50 ${placeholder ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => navigate(`/admin/vendors/${v.id}`)}
                            className="font-medium text-gray-900 hover:text-purple-700 hover:underline text-left"
                          >
                            {v.store_name}
                          </button>
                        </td>

                        {/* Email cell with inline edit */}
                        <td className="px-4 py-3">
                          {editingEmail === v.id ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="email"
                                  value={emailDraft}
                                  onChange={e => setEmailDraft(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEmail(v.id); if (e.key === 'Escape') cancelEditEmail(); }}
                                  placeholder="Enter real email"
                                  autoFocus
                                  className="border border-purple-300 rounded px-2 py-1 text-xs w-44 focus:ring-2 focus:ring-purple-300 outline-none"
                                />
                                <button
                                  onClick={() => saveEmail(v.id)}
                                  disabled={savingEmail}
                                  className="p-1 bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
                                  title="Save"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={cancelEditEmail}
                                  className="p-1 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded"
                                  title="Cancel"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                              {emailMsg?.id === v.id && (
                                <p className={`text-xs ${emailMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                                  {emailMsg.msg}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              {placeholder ? (
                                <span className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                                  <AlertTriangle className="w-3 h-3" />
                                  Placeholder
                                </span>
                              ) : (
                                <span className="text-gray-600 text-xs">{v.email || '—'}</span>
                              )}
                              <button
                                onClick={() => startEditEmail(v)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-purple-600 transition-opacity"
                                title={placeholder ? 'Update real email' : 'Edit email'}
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              {emailMsg?.id === v.id && !editingEmail && (
                                <span className={`text-xs ml-1 ${emailMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                                  {emailMsg.msg}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3 text-gray-600 text-xs">{v.phone || '—'}</td>
                        <td className="px-4 py-3 text-center">{v.commission_rate}%</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                            v.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {v.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {v.user_id ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600">
                              <CheckCircle className="w-3.5 h-3.5" /> Linked
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                              <XCircle className="w-3.5 h-3.5" /> Not linked
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {inviteMsg?.id === v.id && (
                            <p className={`text-xs mb-1 ${inviteMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                              {inviteMsg.msg}
                            </p>
                          )}
                          {placeholder ? (
                            <button
                              onClick={() => startEditEmail(v)}
                              className="inline-flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition"
                            >
                              <Pencil className="w-3 h-3" />
                              Update Email
                            </button>
                          ) : v.email ? (
                            <button
                              onClick={() => handleInvite(v.id)}
                              disabled={inviting === v.id}
                              className="inline-flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition"
                            >
                              <Send className="w-3 h-3" />
                              {inviting === v.id ? 'Sending…' : v.user_id ? 'Resend Invite' : 'Send Invite'}
                            </button>
                          ) : (
                            <button
                              onClick={() => startEditEmail(v)}
                              className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-purple-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-purple-300 transition"
                            >
                              <Mail className="w-3 h-3" /> Add Email
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {vendors.length === 0 && (
                <div className="text-center py-12 text-gray-400">No vendors found</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── APPLICATIONS TAB ── */}
      {tab === 'applications' && (
        <div>
          {/* Filter */}
          <div className="flex gap-2 mb-4">
            {(['pending','approved','rejected','all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setAppFilter(f)}
                className={`px-4 py-1.5 text-sm rounded-full border transition ${
                  appFilter === f
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {appsLoading ? (
            <div className="text-center py-16 text-gray-400">Loading applications…</div>
          ) : apps.length === 0 ? (
            <div className="text-center py-16 text-gray-400">No {appFilter} applications</div>
          ) : (
            <div className="space-y-3">
              {apps.map(app => (
                <div key={app.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Header row */}
                  <div
                    className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50"
                    onClick={() => setExpandedApp(expandedApp === app.id ? null : app.id)}
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="font-semibold text-gray-900">{app.store_name}</p>
                        <p className="text-sm text-gray-500">{app.full_name} · {app.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={app.status} />
                      <span className="text-xs text-gray-400">
                        {new Date(app.created_at).toLocaleDateString()}
                      </span>
                      {expandedApp === app.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {expandedApp === app.id && (
                    <div className="border-t border-gray-100 px-5 py-4 bg-gray-50">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-4">
                        <Detail label="Full Name" value={app.full_name} />
                        <Detail label="Phone" value={app.phone} />
                        <Detail label="NIN/BVN" value={app.nin_bvn} />
                        <Detail label="Business Type" value={app.business_type} />
                        <Detail label="RC Number" value={app.rc_number} />
                        <Detail label="Address" value={[app.business_address, app.city, app.state].filter(Boolean).join(', ')} />
                        <Detail label="Bank Name" value={app.bank_name} />
                        <Detail label="Account Number" value={app.bank_account_number} />
                        <Detail label="Account Name" value={app.bank_account_name} />
                      </div>

                      {/* Documents */}
                      <div className="flex gap-3 mb-4">
                        {app.id_document_url && (
                          <a href={app.id_document_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-blue-600 underline">
                            <Eye className="w-3.5 h-3.5" /> View ID Document
                          </a>
                        )}
                        {app.cac_document_url && (
                          <a href={app.cac_document_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-blue-600 underline">
                            <Eye className="w-3.5 h-3.5" /> View CAC Certificate
                          </a>
                        )}
                      </div>

                      {/* Actions — only for pending */}
                      {app.status === 'pending' && (
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => handleApprove(app.id)}
                            disabled={actioning === app.id}
                            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50 transition"
                          >
                            <CheckCircle className="w-4 h-4" />
                            {actioning === app.id ? 'Processing…' : 'Approve & Send Invite'}
                          </button>

                          {showRejectInput !== app.id ? (
                            <button
                              onClick={() => setShowRejectInput(app.id)}
                              className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm px-4 py-2 rounded-lg border border-red-200 transition"
                            >
                              <XCircle className="w-4 h-4" /> Reject
                            </button>
                          ) : (
                            <div className="flex-1 flex gap-2">
                              <input
                                type="text"
                                placeholder="Reason for rejection (optional)"
                                value={rejectReason}
                                onChange={e => setRejectReason(e.target.value)}
                                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-300 outline-none"
                              />
                              <button
                                onClick={() => handleReject(app.id)}
                                disabled={actioning === app.id}
                                className="bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50 transition"
                              >
                                {actioning === app.id ? 'Rejecting…' : 'Confirm Reject'}
                              </button>
                              <button onClick={() => setShowRejectInput(null)} className="text-gray-400 hover:text-gray-600 text-sm px-2">Cancel</button>
                            </div>
                          )}
                        </div>
                      )}

                      {app.status === 'rejected' && app.reject_reason && (
                        <p className="text-sm text-red-600 mt-1"><strong>Reason:</strong> {app.reject_reason}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    pending:  { color: 'bg-orange-100 text-orange-700', icon: <Clock className="w-3 h-3" /> },
    approved: { color: 'bg-green-100 text-green-700',  icon: <CheckCircle className="w-3 h-3" /> },
    rejected: { color: 'bg-red-100 text-red-600',      icon: <XCircle className="w-3 h-3" /> },
  };
  const s = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>
      {s.icon} {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
      <p className="text-gray-800 font-medium">{value || '—'}</p>
    </div>
  );
}
