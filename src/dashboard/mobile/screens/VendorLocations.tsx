import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Edit, Loader, Pause, Play, Plus, Trash2, Users } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE, functionsAuthHeader, functionsBase } from '../lib/functionsAuth';

const JLO_API = import.meta.env.VITE_JLO_API_URL || '';
const locBase = () => (JLO_API ? `${JLO_API}/.netlify/functions` : functionsBase);

interface ApprovedLocation {
  id: string;
  country: string;
  state: string;
  city: string;
  lgas: string[];
  status: 'active' | 'paused' | 'waitlist_only' | 'coming_soon';
  supports_vendor_direct_fez: boolean;
  supports_vendor_to_hub: boolean;
  supports_local_delivery: boolean;
  hub_id: string | null;
  fez_hub_name: string | null;
  vendor_pickup_surcharge: number;
  hubs?: { name: string } | null;
}

interface HubOption {
  id: string;
  name: string;
  city: string;
  state: string;
  is_active: boolean;
}

interface WaitlistEntry {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  state: string;
  city: string;
  vendor_category: string | null;
  est_monthly_orders: number | null;
  notified_at: string | null;
}

type FormStatus = ApprovedLocation['status'];

type FormState = {
  state: string;
  city: string;
  lgas: string[];
  country: string;
  hub_id: string;
  fez_hub_name: string;
  fez_hub_address: string;
  notes: string;
  supports_vendor_direct_fez: boolean;
  supports_vendor_to_hub: boolean;
  supports_local_delivery: boolean;
  vendor_pickup_surcharge: number;
  status: FormStatus;
};

const emptyForm: FormState = {
  state: '',
  city: '',
  lgas: [''],
  country: 'Nigeria',
  hub_id: '',
  fez_hub_name: '',
  fez_hub_address: '',
  notes: '',
  supports_vendor_direct_fez: true,
  supports_vendor_to_hub: false,
  supports_local_delivery: false,
  vendor_pickup_surcharge: 0,
  status: 'active',
};

const STATUS_CLS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused: 'bg-yellow-100 text-yellow-700',
  waitlist_only: 'bg-blue-100 text-blue-700',
  coming_soon: 'bg-gray-100 text-gray-500',
};

export default function MobileVendorLocations() {
  const notification = useNotification();
  const [tab, setTab] = useState<'locations' | 'waitlist'>('locations');
  const [locations, setLocations] = useState<ApprovedLocation[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovedLocation | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const authFetch = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${locBase()}/${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(await functionsAuthHeader()),
        ...(init.headers || {}),
      },
    });
    return res.json();
  };

  const loadLocations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await authFetch('vendor-locations-admin');
      setLocations(data.locations || []);
    } catch {
      notification.error('Load failed', 'Unable to load locations');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  const loadWaitlist = useCallback(async () => {
    try {
      const data = await authFetch('vendor-locations-admin?view=waitlist');
      setWaitlist(data.waitlist || []);
    } catch {
      notification.error('Load failed', 'Unable to load waitlist');
    }
  }, [notification]);

  const loadHubs = useCallback(async () => {
    try {
      const data = await authFetch('hubs');
      const all: HubOption[] = Array.isArray(data.data) ? data.data : [];
      setHubs(all.filter((h) => h.is_active));
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    loadLocations();
    loadHubs();
  }, [loadHubs, loadLocations]);

  useEffect(() => {
    if (tab === 'waitlist') loadWaitlist();
  }, [tab, loadWaitlist]);

  const byState = useMemo(() => {
    const map: Record<string, ApprovedLocation[]> = {};
    for (const loc of locations) {
      if (!map[loc.state]) map[loc.state] = [];
      map[loc.state].push(loc);
    }
    return map;
  }, [locations]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (loc: ApprovedLocation) => {
    setEditing(loc);
    setForm({
      state: loc.state,
      city: loc.city,
      lgas: loc.lgas?.length ? loc.lgas : [''],
      country: loc.country || 'Nigeria',
      hub_id: loc.hub_id || '',
      fez_hub_name: loc.fez_hub_name || '',
      fez_hub_address: '',
      notes: '',
      supports_vendor_direct_fez: loc.supports_vendor_direct_fez,
      supports_vendor_to_hub: loc.supports_vendor_to_hub,
      supports_local_delivery: loc.supports_local_delivery,
      vendor_pickup_surcharge: loc.vendor_pickup_surcharge,
      status: loc.status,
    });
    setFormOpen(true);
  };

  const save = async () => {
    const lgas = form.lgas.map((l) => l.trim()).filter(Boolean);
    if (!form.state.trim() || !form.city.trim() || lgas.length === 0) {
      notification.error('Validation', 'State, city, and at least one LGA are required');
      return;
    }
    setSaving(true);
    try {
      const body = editing ? { id: editing.id, ...form, lgas } : { ...form, lgas };
      const data = await authFetch('vendor-locations-admin', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      if (data.error) throw new Error(data.error);
      notification.success('Saved', `${form.city} ${editing ? 'updated' : 'added'}`);
      setFormOpen(false);
      loadLocations();
    } catch (e) {
      notification.error('Save failed', e instanceof Error ? e.message : 'Unable to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (loc: ApprovedLocation) => {
    const newStatus = loc.status === 'active' ? 'paused' : 'active';
    try {
      await authFetch('vendor-locations-admin', {
        method: 'PUT',
        body: JSON.stringify({ id: loc.id, status: newStatus }),
      });
      notification.success('Updated', `${loc.city} is now ${newStatus}`);
      loadLocations();
    } catch {
      notification.error('Update failed', 'Unable to change status');
    }
  };

  const notifyWaitlist = async (loc: ApprovedLocation) => {
    if (loc.status !== 'active') {
      notification.error('Cannot notify', 'Set location to Active first');
      return;
    }
    setActivatingId(loc.id);
    try {
      const data = await authFetch('vendor-waitlist-activate', {
        method: 'POST',
        body: JSON.stringify({ location_id: loc.id }),
      });
      if (data.error) throw new Error(data.error);
      notification.success('Notified', data.message || 'Waitlist vendors notified');
    } catch (e) {
      notification.error('Notify failed', e instanceof Error ? e.message : 'Unable to notify');
    } finally {
      setActivatingId(null);
    }
  };

  const remove = async (loc: ApprovedLocation) => {
    if (!window.confirm(`Delete ${loc.city} (${loc.state})?`)) return;
    try {
      const data = await authFetch('vendor-locations-admin', {
        method: 'DELETE',
        body: JSON.stringify({ id: loc.id }),
      });
      if (data.error) throw new Error(data.error);
      notification.success('Deleted', `${loc.city} removed`);
      loadLocations();
    } catch (e) {
      notification.error('Delete failed', e instanceof Error ? e.message : 'Unable to delete');
    }
  };

  const refresh = async () => {
    await loadLocations();
    if (tab === 'waitlist') await loadWaitlist();
  };

  return (
    <>
      <PullToRefresh onRefresh={refresh}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Vendor Locations</h1>
              <p className="text-xs text-gray-500">Approved cities and LGAs</p>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>

          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
            {(['locations', 'waitlist'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium ${
                  tab === t ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {t === 'locations' ? `Locations (${locations.length})` : `Waitlist (${waitlist.length})`}
              </button>
            ))}
          </div>

          {tab === 'locations' && (
            loading ? (
              <div className="flex justify-center py-12">
                <Loader className="h-6 w-6 animate-spin text-primary-600" />
              </div>
            ) : locations.length === 0 ? (
              <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 ring-1 ring-gray-100">
                No approved locations yet.
              </div>
            ) : (
              Object.entries(byState)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([state, locs]) => (
                  <div key={state}>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">{state}</p>
                    <div className="space-y-2">
                      {locs.map((loc) => (
                        <div key={loc.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-gray-900">{loc.city}</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {(loc.lgas || []).map((lga) => (
                                  <span key={lga} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                                    {lga}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[loc.status] || 'bg-gray-100'}`}>
                              {loc.status.replace('_', ' ')}
                            </span>
                          </div>
                          {loc.hubs?.name && <p className="mt-1 text-xs text-primary-700">Hub: {loc.hubs.name}</p>}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {loc.supports_vendor_direct_fez && (
                              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] text-purple-700">Pickup</span>
                            )}
                            {loc.supports_vendor_to_hub && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">Hub drop</span>
                            )}
                            {loc.supports_local_delivery && (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700">Local</span>
                            )}
                          </div>
                          <div className="mt-2 flex gap-1 border-t border-gray-100 pt-2">
                            <button type="button" onClick={() => openEdit(loc)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-1.5 text-[11px] font-semibold">
                              <Edit className="h-3 w-3" /> Edit
                            </button>
                            <button type="button" onClick={() => void toggleStatus(loc)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-1.5 text-[11px] font-semibold">
                              {loc.status === 'active' ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                              {loc.status === 'active' ? 'Pause' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              disabled={activatingId === loc.id}
                              onClick={() => void notifyWaitlist(loc)}
                              className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                            >
                              {activatingId === loc.id ? <Loader className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />}
                              Notify
                            </button>
                            <button type="button" onClick={() => void remove(loc)} className="rounded-lg border border-red-200 p-1.5 text-red-500">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
            )
          )}

          {tab === 'waitlist' && (
            waitlist.length === 0 ? (
              <div className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 ring-1 ring-gray-100">
                <Users className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                No waitlist entries yet.
              </div>
            ) : (
              <div className="space-y-2">
                {waitlist.map((e) => (
                  <div key={e.id} className="rounded-xl bg-white p-3 ring-1 ring-gray-100">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{e.full_name}</p>
                        <p className="text-xs text-gray-500">{e.email}</p>
                        <p className="text-xs text-gray-400">
                          {e.state} · {e.city}
                        </p>
                      </div>
                      {e.notified_at ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-green-600">
                          <Check className="h-3 w-3" /> Notified
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">Pending</span>
                      )}
                    </div>
                    {(e.vendor_category || e.est_monthly_orders != null) && (
                      <p className="mt-1 text-xs text-gray-500">
                        {[e.vendor_category, e.est_monthly_orders != null ? `~${e.est_monthly_orders} orders/mo` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </PullToRefresh>

      <Sheet open={formOpen} onClose={() => setFormOpen(false)} ariaLabel={editing ? 'Edit location' : 'Add location'}>
        <h3 className="text-base font-bold">{editing ? 'Edit location' : 'Add location'}</h3>
        <div className="space-y-3">
          <input
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
            placeholder="State *"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <input
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            placeholder="City *"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          {form.lgas.map((lga, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={lga}
                onChange={(e) =>
                  setForm((f) => {
                    const next = [...f.lgas];
                    next[i] = e.target.value;
                    return { ...f, lgas: next };
                  })
                }
                placeholder={`LGA ${i + 1} *`}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
              {form.lgas.length > 1 && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, lgas: f.lgas.filter((_, j) => j !== i) }))}
                  className="rounded-lg border border-gray-200 px-2 text-gray-500"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, lgas: [...f.lgas, ''] }))}
            className="text-xs font-semibold text-primary-600"
          >
            + Add LGA
          </button>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FormStatus }))}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="waitlist_only">Waitlist only</option>
            <option value="coming_soon">Coming soon</option>
          </select>
          {hubs.length > 0 && (
            <select
              value={form.hub_id}
              onChange={(e) => setForm((f) => ({ ...f, hub_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              <option value="">No hub linked</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} · {h.city}
                </option>
              ))}
            </select>
          )}
          {[
            { key: 'supports_vendor_direct_fez' as const, label: 'Fez pickup from vendor' },
            { key: 'supports_vendor_to_hub' as const, label: 'Vendor drops at hub' },
            { key: 'supports_local_delivery' as const, label: 'Local delivery' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="mt-3 w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Update location' : 'Create location'}
        </button>
      </Sheet>
    </>
  );
}
