import { useState, useEffect, useCallback } from 'react';
import { Store, Mail, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp, Eye, Send } from 'lucide-react';
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
  const [tab, setTab] = useState<Tab>('vendors');

  // Vendors
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [inviting, setInviting] = useState<string | null>(null);
  const [inviteMsg, setInviteMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);

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

  // ── Invite existing vendor ─────────────────────────────────────────────────
  async function handleInvite(vendorId: string) {
    setInviting(vendorId);
    setInviteMsg(null);
    const res = await callApi('vendor-invite', { vendor_id: vendorId });
    setInviteMsg({ id: vendorId, msg: res.message || res.error, ok: !!res.success });
    setInviting(null);
    if (res.success) loadVendors();
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Store className="w-6 h-6 text-purple-600" />
        <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
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
            {t === 'vendors' ? 'Active Vendors' : (
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
                  {vendors.map(v => (
                    <tr key={v.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{v.store_name}</td>
                      <td className="px-4 py-3 text-gray-600">{v.email || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{v.phone || '—'}</td>
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
                        {v.email ? (
                          <button
                            onClick={() => handleInvite(v.id)}
                            disabled={inviting === v.id}
                            className="inline-flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition"
                          >
                            <Send className="w-3 h-3" />
                            {inviting === v.id ? 'Sending…' : v.user_id ? 'Resend Invite' : 'Send Invite'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">No email</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
