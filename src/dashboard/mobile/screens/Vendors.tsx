import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Loader,
  Mail,
  Search,
  Send,
  Store,
  Trash2,
  XCircle,
} from 'lucide-react';
import { supabase } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { isPlaceholderEmail, vendorPost } from '../lib/vendorApi';

type Tab = 'vendors' | 'applications';
type AppFilter = 'pending' | 'approved' | 'rejected' | 'all';

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
  business_description: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reject_reason: string | null;
  created_at: string;
}

const APP_FILTERS: { key: AppFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export default function MobileVendors() {
  const navigate = useNavigate();
  const notification = useNotification();
  const [tab, setTab] = useState<Tab>('vendors');
  const [search, setSearch] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [apps, setApps] = useState<Application[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appFilter, setAppFilter] = useState<AppFilter>('pending');
  const [inviting, setInviting] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [emailSheet, setEmailSheet] = useState<Vendor | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const loadVendors = useCallback(async () => {
    setVendorsLoading(true);
    const { data } = await (supabase as any)
      .from('vendors')
      .select('id, store_name, email, phone, commission_rate, is_active, user_id, created_at')
      .order('store_name');
    setVendors((data as Vendor[]) || []);
    setVendorsLoading(false);
  }, []);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    const res = await vendorPost<{ success?: boolean; applications?: Application[] }>('vendor-applications-list', {
      status: appFilter,
    });
    setApps(res.success && Array.isArray(res.applications) ? res.applications : []);
    setAppsLoading(false);
  }, [appFilter]);

  const load = useCallback(async () => {
    await Promise.all([loadVendors(), loadApps()]);
  }, [loadApps, loadVendors]);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  useEffect(() => {
    if (tab === 'applications') loadApps();
  }, [tab, loadApps]);

  const filteredVendors = useMemo(() => {
    if (!search.trim()) return vendors;
    const q = search.toLowerCase();
    return vendors.filter(
      (v) =>
        v.store_name.toLowerCase().includes(q) ||
        v.email?.toLowerCase().includes(q) ||
        (v.phone || '').includes(q),
    );
  }, [vendors, search]);

  const placeholderCount = vendors.filter((v) => isPlaceholderEmail(v.email)).length;
  const pendingApps = apps.filter((a) => a.status === 'pending').length;

  const handleInvite = async (vendorId: string) => {
    setInviting(vendorId);
    const res = await vendorPost<{ success?: boolean; message?: string; error?: string }>('vendor-invite', {
      vendor_id: vendorId,
    });
    setInviting(null);
    if (res.success) {
      notification.success('Invite sent', res.message || 'Vendor invite sent');
      loadVendors();
    } else {
      notification.error('Invite failed', res.message || res.error || 'Unable to send invite');
    }
  };

  const saveEmail = async () => {
    if (!emailSheet) return;
    const trimmed = emailDraft.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      notification.error('Invalid email', 'Enter a valid email address');
      return;
    }
    setSavingEmail(true);
    const { error } = await (supabase as any).from('vendors').update({ email: trimmed }).eq('id', emailSheet.id);
    setSavingEmail(false);
    if (error) {
      notification.error('Save failed', error.message);
    } else {
      setVendors((prev) => prev.map((v) => (v.id === emailSheet.id ? { ...v, email: trimmed } : v)));
      setEmailSheet(null);
      notification.success('Saved', 'Email updated');
    }
  };

  const approveApp = async (appId: string) => {
    setActioning(appId);
    const res = await vendorPost<{ success?: boolean; error?: string }>('vendor-approve', {
      application_id: appId,
      action: 'approve',
    });
    setActioning(null);
    if (res.success) {
      notification.success('Approved', 'Application approved and invite sent');
      setSelectedApp(null);
      loadApps();
    } else {
      notification.error('Approve failed', res.error || 'Unable to approve');
    }
  };

  const rejectApp = async (appId: string) => {
    setActioning(appId);
    const res = await vendorPost<{ success?: boolean; error?: string }>('vendor-approve', {
      application_id: appId,
      action: 'reject',
      reject_reason: rejectReason,
    });
    setActioning(null);
    if (res.success) {
      notification.success('Rejected', 'Application rejected');
      setSelectedApp(null);
      setShowReject(false);
      setRejectReason('');
      loadApps();
    } else {
      notification.error('Reject failed', res.error || 'Unable to reject');
    }
  };

  const deleteApp = async (appId: string) => {
    if (!window.confirm('Delete this application permanently?')) return;
    setActioning(appId);
    const res = await vendorPost<{ success?: boolean; error?: string }>('vendor-application-delete', {
      application_id: appId,
    });
    setActioning(null);
    if (res.success) {
      setSelectedApp(null);
      loadApps();
    } else {
      notification.error('Delete failed', res.error || 'Unable to delete');
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Vendors</h1>
              <p className="text-xs text-gray-500">Manage stores and applications</p>
            </div>
          </div>

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
            {(['vendors', 'applications'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium ${
                  tab === t ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {t === 'vendors' ? 'Active' : 'Applications'}
                {t === 'vendors' && placeholderCount > 0 ? ` (${placeholderCount})` : ''}
                {t === 'applications' && appFilter === 'pending' && pendingApps > 0 ? ` (${pendingApps})` : ''}
              </button>
            ))}
          </div>

          {tab === 'vendors' && (
            <>
              {placeholderCount > 0 && (
                <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{placeholderCount} vendor(s) still have placeholder emails.</span>
                </div>
              )}
              <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-gray-100">
                <Search className="h-4 w-4 shrink-0 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search vendors…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  style={{ fontSize: '16px' }}
                />
              </div>
              {vendorsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredVendors.map((v) => (
                    <div key={v.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/vendors/${v.id}`)}
                        className="flex w-full items-center gap-3 text-left"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                          <Store className="h-5 w-5 text-purple-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">{v.store_name}</p>
                          <p className="truncate text-xs text-gray-500">{v.email || 'No email'}</p>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                v.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {v.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {v.user_id ? (
                              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
                                Portal linked
                              </span>
                            ) : (
                              <span className="rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                No portal
                              </span>
                            )}
                            {isPlaceholderEmail(v.email) && (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                Placeholder email
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                      </button>
                      <div className="mt-2 flex gap-2 border-t border-gray-100 pt-2">
                        {isPlaceholderEmail(v.email) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEmailSheet(v);
                              setEmailDraft('');
                            }}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-2 text-xs font-semibold text-gray-700"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            Fix email
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={inviting === v.id || isPlaceholderEmail(v.email)}
                          onClick={() => void handleInvite(v.id)}
                          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary-600 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {inviting === v.id ? (
                            <Loader className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          {v.user_id ? 'Resend' : 'Invite'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'applications' && (
            <>
              <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
                {APP_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAppFilter(key)}
                    className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-medium ${
                      appFilter === key ? 'border-gray-800 bg-gray-800 text-white' : 'border-gray-200 bg-white text-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {appsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : apps.length === 0 ? (
                <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No applications found.</div>
              ) : (
                <div className="space-y-2">
                  {apps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => {
                        setSelectedApp(app);
                        setShowReject(false);
                        setRejectReason('');
                      }}
                      className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-gray-100"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900">{app.store_name}</p>
                        <p className="text-xs text-gray-500">{app.full_name} · {app.email}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              app.status === 'pending'
                                ? 'bg-yellow-100 text-yellow-700'
                                : app.status === 'approved'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {app.status}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(app.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={!!emailSheet} onClose={() => setEmailSheet(null)} ariaLabel="Edit vendor email">
        {emailSheet && (
          <>
            <h3 className="text-base font-bold">{emailSheet.store_name}</h3>
            <p className="text-xs text-gray-500">Replace placeholder email before sending invite.</p>
            <input
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder="vendor@example.com"
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            />
            <button
              type="button"
              disabled={savingEmail}
              onClick={() => void saveEmail()}
              className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {savingEmail ? 'Saving…' : 'Save email'}
            </button>
          </>
        )}
      </Sheet>

      <Sheet open={!!selectedApp} onClose={() => setSelectedApp(null)} ariaLabel="Application details">
        {selectedApp && (
          <>
            <h3 className="text-base font-bold">{selectedApp.store_name}</h3>
            <p className="text-xs text-gray-500">
              {selectedApp.full_name} · {selectedApp.phone}
            </p>
            <div className="space-y-2 text-sm text-gray-700">
              <p>
                <span className="text-gray-400">Email:</span> {selectedApp.email}
              </p>
              {selectedApp.business_type && (
                <p>
                  <span className="text-gray-400">Type:</span> {selectedApp.business_type}
                </p>
              )}
              {[selectedApp.business_address, selectedApp.city, selectedApp.state].filter(Boolean).length > 0 && (
                <p>
                  <span className="text-gray-400">Address:</span>{' '}
                  {[selectedApp.business_address, selectedApp.city, selectedApp.state].filter(Boolean).join(', ')}
                </p>
              )}
              {selectedApp.bank_name && (
                <p>
                  <span className="text-gray-400">Bank:</span> {selectedApp.bank_name} · {selectedApp.bank_account_number}
                </p>
              )}
              {selectedApp.business_description && (
                <p className="rounded-lg bg-gray-50 p-2 text-xs">{selectedApp.business_description}</p>
              )}
            </div>
            {selectedApp.status === 'pending' && (
              <div className="space-y-2">
                {!showReject ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={actioning === selectedApp.id}
                      onClick={() => void approveApp(selectedApp.id)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-green-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowReject(true)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-red-200 py-3 text-sm font-semibold text-red-600"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Rejection reason (optional)"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                      style={{ fontSize: '16px' }}
                    />
                    <button
                      type="button"
                      disabled={actioning === selectedApp.id}
                      onClick={() => void rejectApp(selectedApp.id)}
                      className="w-full rounded-xl bg-red-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Confirm reject
                    </button>
                  </>
                )}
              </div>
            )}
            {selectedApp.status === 'rejected' && selectedApp.reject_reason && (
              <p className="text-xs text-red-600">Reason: {selectedApp.reject_reason}</p>
            )}
            <button
              type="button"
              disabled={actioning === selectedApp.id}
              onClick={() => void deleteApp(selectedApp.id)}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-red-200 py-2.5 text-sm font-semibold text-red-600"
            >
              <Trash2 className="h-4 w-4" />
              Delete application
            </button>
          </>
        )}
      </Sheet>
    </>
  );
}
