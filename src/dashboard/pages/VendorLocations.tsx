import { useEffect, useState } from 'react';
import { MapPin, Plus, Edit, Pause, Play, Trash2, Users, X, Check } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../../lib/supabase';

const JLO_API = import.meta.env.VITE_JLO_API_URL || '';

interface ApprovedLocation {
  id: string;
  country: string;
  state: string;
  city: string;
  lga: string;
  status: 'active' | 'paused' | 'waitlist_only' | 'coming_soon';
  supports_vendor_direct_fez: boolean;
  supports_vendor_to_hub: boolean;
  supports_local_delivery: boolean;
  hub_id: string | null;
  fez_hub_name: string | null;
  fez_hub_address: string | null;
  vendor_pickup_surcharge: number;
  notes: string | null;
  hubs?: { name: string; city: string; state: string } | null;
  couriers?: { name: string; code: string } | null;
  zones?: { name: string; code: string } | null;
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
  lga: string | null;
  vendor_category: string | null;
  est_monthly_orders: number | null;
  notified_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  active:        'bg-green-100 text-green-700',
  paused:        'bg-yellow-100 text-yellow-700',
  waitlist_only: 'bg-blue-100 text-blue-700',
  coming_soon:   'bg-gray-100 text-gray-500',
};

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? `Bearer ${session.access_token}` : '';
}

export function VendorLocationsPage() {
  const [locations, setLocations]       = useState<ApprovedLocation[]>([]);
  const [waitlist, setWaitlist]         = useState<WaitlistEntry[]>([]);
  const [tab, setTab]                   = useState<'locations' | 'waitlist'>('locations');
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [editing, setEditing]           = useState<ApprovedLocation | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [hubOptions, setHubOptions]     = useState<HubOption[]>([]);
  const notification                    = useNotification();

  type FormStatus = 'active' | 'paused' | 'waitlist_only' | 'coming_soon';
  type FormState = {
    state: string; city: string; lga: string; country: string;
    hub_id: string;
    fez_hub_name: string; fez_hub_address: string; notes: string;
    supports_vendor_direct_fez: boolean;
    supports_vendor_to_hub: boolean;
    supports_local_delivery: boolean;
    vendor_pickup_surcharge: number;
    status: FormStatus;
  };
  const emptyForm: FormState = {
    state: '', city: '', lga: '', country: 'Nigeria',
    hub_id: '',
    fez_hub_name: '', fez_hub_address: '', notes: '',
    supports_vendor_direct_fez: true,
    supports_vendor_to_hub: false,
    supports_local_delivery: false,
    vendor_pickup_surcharge: 0,
    status: 'active',
  };
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => { fetchLocations(); fetchHubs(); }, []);
  useEffect(() => { if (tab === 'waitlist') fetchWaitlist(); }, [tab]);

  async function fetchHubs() {
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`${JLO_API}/.netlify/functions/hubs`, {
        headers: { Authorization: auth },
      });
      const data = await res.json();
      const all: HubOption[] = Array.isArray(data.data) ? data.data : [];
      setHubOptions(all.filter((h) => h.is_active).sort((a, b) => `${a.state}${a.name}`.localeCompare(`${b.state}${b.name}`)));
    } catch {
      // non-fatal — dropdown just stays empty
    }
  }

  async function fetchLocations() {
    setLoading(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-locations-admin`, {
        headers: { Authorization: auth },
      });
      const data = await res.json();
      setLocations(data.locations || []);
    } catch {
      notification.error('Error', 'Failed to load approved locations');
    } finally {
      setLoading(false);
    }
  }

  async function fetchWaitlist() {
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-locations-admin?view=waitlist`, {
        headers: { Authorization: auth },
      });
      const data = await res.json();
      setWaitlist(data.waitlist || []);
    } catch {
      notification.error('Error', 'Failed to load waitlist');
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(loc: ApprovedLocation) {
    setEditing(loc);
    setForm({
      state:                      loc.state,
      city:                       loc.city,
      lga:                        loc.lga,
      country:                    loc.country || 'Nigeria',
      hub_id:                     loc.hub_id || '',
      fez_hub_name:               loc.fez_hub_name || '',
      fez_hub_address:            loc.fez_hub_address || '',
      notes:                      loc.notes || '',
      supports_vendor_direct_fez: loc.supports_vendor_direct_fez,
      supports_vendor_to_hub:     loc.supports_vendor_to_hub,
      supports_local_delivery:    loc.supports_local_delivery,
      vendor_pickup_surcharge:    loc.vendor_pickup_surcharge,
      status:                     loc.status,
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.state || !form.city || !form.lga) {
      notification.error('Validation', 'State, city, and LGA are required');
      return;
    }
    try {
      const auth = await getAuthHeader();
      const method = editing ? 'PUT' : 'POST';
      const body = editing ? { id: editing.id, ...form } : form;
      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-locations-admin`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      notification.success('Saved', `${form.city}, ${form.lga} (${form.state}) ${editing ? 'updated' : 'added'}`);
      setShowForm(false);
      fetchLocations();
    } catch (e: any) {
      notification.error('Error', e.message);
    }
  }

  async function toggleStatus(loc: ApprovedLocation) {
    const newStatus = loc.status === 'active' ? 'paused' : 'active';
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-locations-admin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ id: loc.id, status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      notification.success('Updated', `${loc.city} is now ${newStatus}`);
      fetchLocations();
    } catch {
      notification.error('Error', 'Failed to update status');
    }
  }

  async function handleActivateWaitlist(loc: ApprovedLocation) {
    if (loc.status !== 'active') {
      notification.error('Cannot activate waitlist', 'Set the location to Active first');
      return;
    }
    setActivatingId(loc.id);
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-waitlist-activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ location_id: loc.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      notification.success('Waitlist activated', data.message);
    } catch (e: any) {
      notification.error('Error', e.message);
    } finally {
      setActivatingId(null);
    }
  }

  async function handleDelete(loc: ApprovedLocation) {
    if (!window.confirm(`Delete ${loc.city}, ${loc.lga} (${loc.state})? This cannot be undone.`)) return;
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`${JLO_API}/.netlify/functions/vendor-locations-admin`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ id: loc.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      notification.success('Deleted', `${loc.city}, ${loc.lga} removed`);
      fetchLocations();
    } catch (e: any) {
      notification.error('Cannot delete', e.message);
    }
  }

  const byState: Record<string, ApprovedLocation[]> = {};
  for (const loc of locations) {
    if (!byState[loc.state]) byState[loc.state] = [];
    byState[loc.state].push(loc);
  }

  const waitlistByCity: Record<string, WaitlistEntry[]> = {};
  for (const entry of waitlist) {
    const key = `${entry.state} — ${entry.city}`;
    if (!waitlistByCity[key]) waitlistByCity[key] = [];
    waitlistByCity[key].push(entry);
  }

  return (
    <div className="space-y-5 p-4 sm:p-0">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <MapPin className="w-6 h-6 text-primary-600 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Vendor Locations</h1>
            <p className="text-sm text-gray-500">Cities and LGAs approved for vendor onboarding</p>
          </div>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 bg-primary-600 text-white px-3 py-2 sm:px-4 rounded-lg text-sm font-medium hover:bg-primary-700 transition shrink-0">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Location</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['locations', 'waitlist'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'locations'
              ? <span>Locations <span className="text-xs opacity-70">({locations.length})</span></span>
              : <span>Waitlist <span className="text-xs opacity-70">({waitlist.length})</span></span>
            }
          </button>
        ))}
      </div>

      {/* ── Locations tab ── */}
      {tab === 'locations' && (
        loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : locations.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No approved locations yet. Add one to start onboarding vendors.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(byState).sort(([a], [b]) => a.localeCompare(b)).map(([state, locs]) => (
              <div key={state}>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{state}</h3>

                {/* ── Desktop table ── */}
                <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">City / LGA</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Modes</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Hub</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {locs.map(loc => (
                        <tr key={loc.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">{loc.city}</p>
                            <p className="text-xs text-gray-500">{loc.lga}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {loc.supports_vendor_direct_fez && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Vendor Pickup</span>}
                              {loc.supports_vendor_to_hub && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Hub Drop-off</span>}
                              {loc.supports_local_delivery && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Local Delivery</span>}
                            </div>
                            {loc.vendor_pickup_surcharge > 0 && (
                              <p className="text-xs text-gray-400 mt-0.5">Pickup fee: ₦{loc.vendor_pickup_surcharge.toLocaleString()}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {loc.hubs ? (
                              <span className="font-medium text-primary-700">{loc.hubs.name}</span>
                            ) : loc.fez_hub_name ? (
                              <span className="text-gray-500">{loc.fez_hub_name} <span className="text-gray-400">(Fez)</span></span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_BADGE[loc.status] || 'bg-gray-100 text-gray-500'}`}>
                              {loc.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEdit(loc)} title="Edit" className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition"><Edit className="w-4 h-4" /></button>
                              <button onClick={() => toggleStatus(loc)} title={loc.status === 'active' ? 'Pause' : 'Activate'} className="p-1.5 text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition">
                                {loc.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                              </button>
                              <button onClick={() => handleActivateWaitlist(loc)} disabled={activatingId === loc.id} title="Notify waitlisted vendors" className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition disabled:opacity-40"><Users className="w-4 h-4" /></button>
                              <button onClick={() => handleDelete(loc)} title="Delete" className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Mobile cards ── */}
                <div className="md:hidden space-y-2">
                  {locs.map(loc => (
                    <div key={loc.id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <p className="font-semibold text-gray-900">{loc.city}</p>
                          <p className="text-xs text-gray-500">{loc.lga}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[loc.status] || 'bg-gray-100 text-gray-500'}`}>
                            {loc.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>

                      {/* Modes */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {loc.supports_vendor_direct_fez && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Vendor Pickup</span>}
                        {loc.supports_vendor_to_hub && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Hub Drop-off</span>}
                        {loc.supports_local_delivery && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Local Delivery</span>}
                      </div>

                      {loc.hubs ? (
                        <p className="text-xs font-medium text-primary-700 mb-3">Hub: {loc.hubs.name}</p>
                      ) : loc.fez_hub_name ? (
                        <p className="text-xs text-gray-400 mb-3">Fez Hub: {loc.fez_hub_name}</p>
                      ) : null}
                      {loc.vendor_pickup_surcharge > 0 && (
                        <p className="text-xs text-gray-400 mb-3">Pickup fee: ₦{loc.vendor_pickup_surcharge.toLocaleString()}</p>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
                        <button onClick={() => openEdit(loc)} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-primary-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-primary-300 transition">
                          <Edit className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button onClick={() => toggleStatus(loc)} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-yellow-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-yellow-300 transition">
                          {loc.status === 'active' ? <><Pause className="w-3.5 h-3.5" /> Pause</> : <><Play className="w-3.5 h-3.5" /> Activate</>}
                        </button>
                        <button onClick={() => handleActivateWaitlist(loc)} disabled={activatingId === loc.id} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-green-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-green-300 transition disabled:opacity-40">
                          <Users className="w-3.5 h-3.5" /> Notify
                        </button>
                        <button onClick={() => handleDelete(loc)} className="ml-auto p-1.5 text-gray-400 hover:text-red-500 rounded-lg transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Waitlist tab ── */}
      {tab === 'waitlist' && (
        waitlist.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No waitlist entries yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(waitlistByCity)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([cityKey, entries]) => (
              <div key={cityKey}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-700">{cityKey}</h3>
                  <span className="text-xs text-gray-400">{entries.length} vendor{entries.length !== 1 ? 's' : ''}</span>
                </div>

                {/* ── Desktop table ── */}
                <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600 text-xs">Name</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600 text-xs">Email</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600 text-xs">Category</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600 text-xs">Est. Orders/mo</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600 text-xs">Notified</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {entries.map(e => (
                        <tr key={e.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-gray-900">{e.full_name}</td>
                          <td className="px-4 py-2.5 text-gray-600">{e.email}</td>
                          <td className="px-4 py-2.5 text-gray-500">{e.vendor_category || '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500">{e.est_monthly_orders ?? '—'}</td>
                          <td className="px-4 py-2.5">
                            {e.notified_at
                              ? <span className="flex items-center gap-1 text-green-600 text-xs"><Check className="w-3 h-3" /> Notified</span>
                              : <span className="text-gray-400 text-xs">Pending</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Mobile cards ── */}
                <div className="sm:hidden space-y-2">
                  {entries.map(e => (
                    <div key={e.id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-gray-900 leading-snug">{e.full_name}</p>
                          <p className="text-xs text-gray-500 truncate">{e.email}</p>
                          {e.phone && <p className="text-xs text-gray-400">{e.phone}</p>}
                        </div>
                        <div className="shrink-0">
                          {e.notified_at
                            ? <span className="flex items-center gap-1 text-green-600 text-xs"><Check className="w-3 h-3" /> Notified</span>
                            : <span className="text-gray-400 text-xs">Pending</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2">
                        {e.vendor_category && (
                          <span className="text-xs text-gray-500">Category: {e.vendor_category}</span>
                        )}
                        {e.est_monthly_orders != null && (
                          <span className="text-xs text-gray-500">~{e.est_monthly_orders} orders/mo</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Add / Edit modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-gray-900">
                {editing ? 'Edit Location' : 'Add Approved Location'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* State / City / LGA — stack on mobile */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">State *</label>
                  <input type="text" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Lagos" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">City *</label>
                  <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Ikeja" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">LGA *</label>
                  <input type="text" value={form.lga} onChange={e => setForm(f => ({ ...f, lga: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Ikeja" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="active">Active — open for registration</option>
                  <option value="paused">Paused — no new registrations</option>
                  <option value="waitlist_only">Waitlist only</option>
                  <option value="coming_soon">Coming soon (admin only)</option>
                </select>
              </div>

              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Supported Modes</p>
                {[
                  { key: 'supports_vendor_direct_fez', label: 'Fez pickup from vendor address' },
                  { key: 'supports_vendor_to_hub',     label: 'Vendor drops off at hub' },
                  { key: 'supports_local_delivery',    label: 'Local delivery (non-Fez)' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={(form as any)[key]}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                      className="w-4 h-4 rounded" />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">JLO Hub (primary)</label>
                <select value={form.hub_id} onChange={e => setForm(f => ({ ...f, hub_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">— No JLO hub (use Fez hub below) —</option>
                  {hubOptions.map(h => (
                    <option key={h.id} value={h.id}>{h.name} — {h.city}, {h.state}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">If set, vendors in this location drop off at this JLO hub. Fez hub below is the fallback.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fez Hub Name <span className="font-normal text-gray-400">(fallback)</span></label>
                <input type="text" value={form.fez_hub_name} onChange={e => setForm(f => ({ ...f, fez_hub_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Fez Lagos Hub" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fez Hub Address <span className="font-normal text-gray-400">(fallback)</span></label>
                <input type="text" value={form.fez_hub_address} onChange={e => setForm(f => ({ ...f, fez_hub_address: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Full address for vendors to drop off" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Pickup Surcharge (₦)</label>
                <input type="number" min="0" value={form.vendor_pickup_surcharge}
                  onChange={e => setForm(f => ({ ...f, vendor_pickup_surcharge: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="0" />
                <p className="text-xs text-gray-400 mt-1">Extra fee when Fez comes to vendor's door</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Internal Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={2}
                  placeholder="Any notes about this location (not shown to vendors)" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-6">
              <button onClick={() => setShowForm(false)}
                className="px-5 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave}
                className="px-5 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium">
                {editing ? 'Save Changes' : 'Add Location'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
