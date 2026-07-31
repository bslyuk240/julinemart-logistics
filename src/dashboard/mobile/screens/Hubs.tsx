import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2,
  ChevronRight,
  Loader,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  User,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  type HubFormData,
  type HubRow,
  emptyHubForm,
  fetchHubs,
  hubFormFromRow,
  saveHub,
} from '../lib/networkApi';

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-900 outline-none focus:border-primary-500 focus:bg-white';

type Filter = 'all' | 'active' | 'sub';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

export default function MobileHubs() {
  const notification = useNotification();
  const [rows, setRows] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<HubRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HubRow | null>(null);
  const [form, setForm] = useState<HubFormData>(emptyHubForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchHubs());
    } catch {
      notification.error('Load failed', 'Unable to load hubs');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((h) => h.is_active).length,
      sub: rows.filter((h) => h.is_sub_hub).length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((h) => {
      if (filter === 'active' && !h.is_active) return false;
      if (filter === 'sub' && !h.is_sub_hub) return false;
      if (!q) return true;
      return (
        h.name.toLowerCase().includes(q) ||
        h.code.toLowerCase().includes(q) ||
        h.city.toLowerCase().includes(q) ||
        h.state.toLowerCase().includes(q)
      );
    });
  }, [rows, search, filter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyHubForm());
    setFormOpen(true);
    setSelected(null);
  };

  const openEdit = (hub: HubRow) => {
    setEditing(hub);
    setForm(hubFormFromRow(hub));
    setFormOpen(true);
    setSelected(null);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.code.trim() || !form.address.trim() || !form.city.trim() || !form.state.trim()) {
      notification.error('Missing fields', 'Name, code, address, city and state are required');
      return;
    }
    if (form.is_sub_hub && !form.parent_hub_id) {
      notification.error('Parent hub required', 'Select a parent hub for sub-hubs');
      return;
    }
    setSaving(true);
    try {
      await saveHub(editing?.id || null, form);
      notification.success(editing ? 'Hub updated' : 'Hub created', form.name);
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Could not save hub');
    } finally {
      setSaving(false);
    }
  };

  const parentCandidates = rows.filter((h) => !h.is_sub_hub && h.id !== editing?.id);

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-gray-900">Hubs</h1>
                <p className="text-xs text-gray-500">Delivery hub locations</p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="flex shrink-0 items-center gap-1 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>

            <div className="mb-3 overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 to-primary-900 p-4 text-white shadow-md">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-primary-200">Network</p>
                  <p className="text-2xl font-bold tabular-nums">{stats.total}</p>
                  <p className="text-xs text-primary-100">{stats.active} active · {stats.sub} sub-hubs</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                  <Building2 className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="mb-3 flex min-w-0 items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-gray-100">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, code, city…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ fontSize: '16px' }}
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
              {([
                { key: 'all' as const, label: 'All' },
                { key: 'active' as const, label: 'Active' },
                { key: 'sub' as const, label: 'Sub-hubs' },
              ]).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                    filter === f.key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <MapPin className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No hubs found</p>
                <button type="button" onClick={openCreate} className="mt-3 text-sm font-semibold text-primary-600">
                  Add your first hub
                </button>
              </div>
            ) : (
              filtered.map((hub) => (
                <button
                  key={hub.id}
                  type="button"
                  onClick={() => setSelected(hub)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                >
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                      hub.is_sub_hub ? 'bg-violet-100 text-violet-700' : 'bg-primary-100 text-primary-700'
                    }`}
                  >
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="truncate font-semibold text-gray-900">{hub.name}</p>
                      {hub.is_sub_hub && (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">Sub</span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          hub.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {hub.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {hub.code} · {hub.city}, {hub.state}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      {/* Hub detail */}
      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Hub details">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
                <MapPin className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                <p className="text-sm text-gray-500">{selected.code}</p>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100">
              <DetailRow icon={<MapPin className="h-4 w-4" />} label="Location" value={`${selected.city}, ${selected.state}`} />
              {selected.address && <DetailRow icon={<Building2 className="h-4 w-4" />} label="Address" value={selected.address} />}
              {selected.manager_name && <DetailRow icon={<User className="h-4 w-4" />} label="Manager" value={selected.manager_name} />}
              {selected.phone && <DetailRow icon={<Phone className="h-4 w-4" />} label="Phone" value={selected.phone} />}
              {selected.email && <DetailRow icon={<Mail className="h-4 w-4" />} label="Email" value={selected.email} />}
              {selected.is_sub_hub && selected.parent_hub && (
                <DetailRow icon={<MapPin className="h-4 w-4" />} label="Routes via" value={`${selected.parent_hub.name}, ${selected.parent_hub.city}`} />
              )}
            </div>

            <button
              type="button"
              onClick={() => openEdit(selected)}
              className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
            >
              Edit hub
            </button>
          </div>
        )}
      </Sheet>

      {/* Hub form */}
      <Sheet open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} ariaLabel="Hub form">
        <h2 className="text-lg font-bold text-gray-900">{editing ? 'Edit hub' : 'New hub'}</h2>
        <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-0.5">
          <Field label="Hub name *">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Hub code *">
            <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Address *">
            <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="City *">
              <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="State *">
              <input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} className={inputCls} />
            </Field>
          </div>
          <Field label="Postcode">
            <input value={form.postcode} onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value }))} placeholder="For CJ hub delivery" className={inputCls} />
          </Field>
          <Field label="Phone">
            <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Manager name">
            <input value={form.manager_name} onChange={(e) => setForm((f) => ({ ...f, manager_name: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Manager phone">
            <input type="tel" value={form.manager_phone} onChange={(e) => setForm((f) => ({ ...f, manager_phone: e.target.value }))} className={inputCls} />
          </Field>
          <label className="flex items-start gap-2 rounded-xl bg-violet-50 px-3 py-3 text-sm text-gray-800 ring-1 ring-violet-100">
            <input
              type="checkbox"
              checked={form.is_sub_hub}
              onChange={(e) => setForm((f) => ({ ...f, is_sub_hub: e.target.checked, parent_hub_id: e.target.checked ? f.parent_hub_id : '' }))}
              className="mt-0.5 rounded accent-primary-600"
            />
            <span>
              <span className="font-medium">Sub-hub</span>
              <span className="mt-0.5 block text-xs text-gray-500">Collects locally and routes to a main hub for dispatch</span>
            </span>
          </label>
          {form.is_sub_hub && (
            <Field label="Parent hub *">
              <select
                value={form.parent_hub_id}
                onChange={(e) => setForm((f) => ({ ...f, parent_hub_id: e.target.value }))}
                className={inputCls}
              >
                <option value="">Select parent hub…</option>
                {parentCandidates.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} — {h.city}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="rounded accent-primary-600"
            />
            Hub is active
          </label>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Saving…' : editing ? 'Update hub' : 'Create hub'}
        </button>
      </Sheet>
    </>
  );
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-gray-400">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <p className="text-sm text-gray-900">{value}</p>
      </div>
    </div>
  );
}
