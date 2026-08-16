import { useEffect, useState } from 'react';
import { MapPin, Plus, Edit, Truck, Pause, Play, Trash2, X } from 'lucide-react';
import { HubForm } from '../components/HubForm';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../../lib/supabase';

interface Hub {
  id: string;
  name: string;
  code: string;
  address?: string;
  city: string;
  state: string;
  postcode?: string;
  phone: string;
  email?: string;
  manager_name: string;
  manager_phone?: string;
  is_active: boolean;
  is_sub_hub: boolean;
  parent_hub_id: string | null;
  parent_hub?: { id: string; name: string; city: string } | null;
}

interface Courier {
  id: string;
  name: string;
  code: string;
}

interface CourierHub {
  id: string;
  courier_id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  phone: string | null;
  is_active: boolean;
  notes: string | null;
  couriers?: { name: string; code: string } | null;
}

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? `Bearer ${session.access_token}` : '';
}

const emptyCourierHubForm = {
  courier_id: '',
  name: '',
  address: '',
  city: '',
  state: '',
  phone: '',
  notes: '',
};

function CourierHubsSection() {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [courierHubs, setCourierHubs] = useState<CourierHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CourierHub | null>(null);
  const [form, setForm] = useState(emptyCourierHubForm);
  const [saving, setSaving] = useState(false);
  const notification = useNotification();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const auth = await getAuthHeader();
      const [couriersRes, hubsRes] = await Promise.all([
        fetch('/api/couriers'),
        fetch('/api/admin-courier-hubs', { headers: { Authorization: auth } }),
      ]);
      const couriersData = await couriersRes.json();
      const hubsData = await hubsRes.json();
      setCouriers(couriersData.data || []);
      setCourierHubs(hubsData.data || []);
    } catch {
      notification.error('Error', 'Failed to load courier hubs');
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ ...emptyCourierHubForm, courier_id: couriers[0]?.id || '' });
    setShowForm(true);
  }

  function openEdit(hub: CourierHub) {
    setEditing(hub);
    setForm({
      courier_id: hub.courier_id,
      name: hub.name,
      address: hub.address,
      city: hub.city,
      state: hub.state,
      phone: hub.phone || '',
      notes: hub.notes || '',
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.courier_id || !form.name.trim() || !form.address.trim() || !form.city.trim() || !form.state.trim()) {
      notification.error('Validation', 'Courier, name, address, city, and state are required');
      return;
    }
    setSaving(true);
    try {
      const auth = await getAuthHeader();
      const url = editing ? `/api/admin-courier-hubs?id=${editing.id}` : '/api/admin-courier-hubs';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      notification.success('Saved', `${form.name} ${editing ? 'updated' : 'added'}`);
      setShowForm(false);
      load();
    } catch (e: any) {
      notification.error('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(hub: CourierHub) {
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`/api/admin-courier-hubs?id=${hub.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ is_active: !hub.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      notification.success('Updated', `${hub.name} is now ${data.data.is_active ? 'active' : 'inactive'}`);
      load();
    } catch (e: any) {
      notification.error('Error', e.message);
    }
  }

  async function handleDelete(hub: CourierHub) {
    if (!window.confirm(`Delete ${hub.name}? This cannot be undone.`)) return;
    try {
      const auth = await getAuthHeader();
      const res = await fetch(`/api/admin-courier-hubs?id=${hub.id}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      notification.success('Deleted', `${hub.name} removed`);
      load();
    } catch (e: any) {
      notification.error('Cannot delete', e.message);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-3">
        <p className="text-sm text-gray-600">
          Depots run by a courier (Fez, or any other courier you use) — not staffed by JulineMart. These populate
          the "Courier Hub" dropdown on the Vendor Locations page instead of free-typing a name/address per city.
        </p>
        <button onClick={openCreate} className="btn-primary flex items-center shrink-0" disabled={couriers.length === 0}>
          <Plus className="w-5 h-5 mr-2" />
          Add Courier Hub
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : couriers.length === 0 ? (
        <div className="card text-center py-12">
          <Truck className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No couriers configured yet — add a courier under Couriers first.</p>
        </div>
      ) : courierHubs.length === 0 ? (
        <div className="card text-center py-12">
          <Truck className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No courier hubs yet.</p>
          <button onClick={openCreate} className="btn-primary mt-4">Add Your First Courier Hub</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {courierHubs.map((hub) => (
            <div key={hub.id} className={`card ${!hub.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center mr-3">
                    <Truck className="w-6 h-6 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{hub.name}</h3>
                    <p className="text-sm text-gray-500">{hub.couriers?.name || 'Unknown courier'}</p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(hub)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Edit">
                    <Edit className="w-4 h-4 text-gray-600" />
                  </button>
                  <button onClick={() => toggleActive(hub)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title={hub.is_active ? 'Deactivate' : 'Activate'}>
                    {hub.is_active ? <Pause className="w-4 h-4 text-gray-600" /> : <Play className="w-4 h-4 text-gray-600" />}
                  </button>
                  <button onClick={() => handleDelete(hub)} className="p-2 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <p className="text-gray-600">📍 {hub.address}</p>
                <p className="text-gray-500">{hub.city}, {hub.state}</p>
                {hub.phone && <p className="text-gray-600">📞 {hub.phone}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-lg font-bold text-gray-900">{editing ? 'Edit Courier Hub' : 'Add Courier Hub'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Courier *</label>
                <select value={form.courier_id} onChange={e => setForm(f => ({ ...f, courier_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  {couriers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Hub Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Fez Onitsha Hub" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Address *</label>
                <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Full address for vendors to drop off" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">City *</label>
                  <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Onitsha" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">State *</label>
                  <input type="text" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. Anambra" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Internal Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-6">
              <button onClick={() => setShowForm(false)} className="px-5 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50">
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Courier Hub'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function HubsPage() {
  const [tab, setTab] = useState<'jlo' | 'courier'>('jlo');
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingHub, setEditingHub] = useState<Hub | null>(null);
  const notification = useNotification();

  useEffect(() => {
    fetchHubs();
  }, []);

  const fetchHubs = async () => {
    try {
      const response = await fetch('/api/hubs');
      const data = await response.json();
      setHubs(data.data || []);
    } catch (error) {
      console.error('Error fetching hubs:', error);
      notification.error('Failed to load hubs', 'Please try again later');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveHub = async (hubData: any) => {
    try {
      const url = editingHub
        ? `/api/hubs/${editingHub.id}`
        : '/api/hubs';

      const method = editingHub ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hubData),
      });

      if (response.ok) {
        notification.success(
          editingHub ? 'Hub Updated' : 'Hub Created',
          editingHub
            ? `${hubData.name} has been updated successfully`
            : `${hubData.name} has been added to your hubs`
        );
        setShowForm(false);
        setEditingHub(null);
        fetchHubs();
      } else {
        notification.error('Operation Failed', 'Unable to save hub changes');
      }
    } catch (error) {
      console.error('Error saving hub:', error);
      notification.error('Error', 'An unexpected error occurred');
    }
  };

  const handleEdit = (hub: Hub) => {
    setEditingHub(hub);
    setShowForm(true);
    notification.info('Editing Hub', `Making changes to ${hub.name}`);
  };

  const handleAdd = () => {
    setEditingHub(null);
    setShowForm(true);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Hubs</h1>
        <p className="text-gray-600 mt-2">
          {tab === 'jlo'
            ? `Manage delivery hub locations • ${hubs.length} total hubs`
            : 'Manage courier-owned depot locations'}
        </p>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        {([
          { id: 'jlo' as const, label: 'JLO Hubs' },
          { id: 'courier' as const, label: 'Courier Hubs' },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              tab === t.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'courier' ? (
        <CourierHubsSection />
      ) : (
        <>
          <div className="mb-8 flex justify-end">
            <button onClick={handleAdd} className="btn-primary flex items-center">
              <Plus className="w-5 h-5 mr-2" />
              Add Hub
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {loading ? (
              <div className="col-span-full text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              </div>
            ) : hubs.length === 0 ? (
              <div className="col-span-full card text-center py-12">
                <MapPin className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No hubs configured yet</p>
                <button onClick={handleAdd} className="btn-primary mt-4">
                  Add Your First Hub
                </button>
              </div>
            ) : (
              hubs.map((hub) => (
                <div key={hub.id} className="card hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center">
                      <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center mr-3">
                        <MapPin className="w-6 h-6 text-primary-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{hub.name}</h3>
                        <p className="text-sm text-gray-500">{hub.code}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <button
                        onClick={() => handleEdit(hub)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <Edit className="w-4 h-4 text-gray-600" />
                      </button>
                      {hub.is_sub_hub && (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          Sub-hub
                        </span>
                      )}
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        hub.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {hub.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-600">📍 {hub.city}, {hub.state}</p>
                    <p className="text-gray-600">👤 {hub.manager_name}</p>
                    <p className="text-gray-600">📞 {hub.phone}</p>
                    {hub.is_sub_hub && hub.parent_hub && (
                      <p className="text-purple-600 text-xs font-medium">
                        Routes via: {hub.parent_hub.name}, {hub.parent_hub.city}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {showForm && (
        <HubForm
          hub={editingHub}
          allHubs={hubs}
          onClose={() => {
            setShowForm(false);
            setEditingHub(null);
            notification.info('Form Closed', 'No changes were saved');
          }}
          onSave={handleSaveHub}
        />
      )}
    </div>
  );
}
