import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Loader,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Truck,
  User,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  type CourierFormData,
  type CourierRow,
  courierFormFromRow,
  deleteCourier,
  emptyCourierForm,
  fetchCouriers,
  saveCourier,
} from '../lib/networkApi';

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-900 outline-none focus:border-primary-500 focus:bg-white';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

export default function MobileCouriers() {
  const notification = useNotification();
  const [rows, setRows] = useState<CourierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [selected, setSelected] = useState<CourierRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CourierRow | null>(null);
  const [form, setForm] = useState<CourierFormData>(emptyCourierForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchCouriers());
    } catch {
      notification.error('Load failed', 'Unable to load couriers');
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
      active: rows.filter((c) => c.is_active).length,
    }),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (!showInactive && !c.is_active) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
    });
  }, [rows, search, showInactive]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyCourierForm());
    setFormOpen(true);
    setSelected(null);
  };

  const openEdit = (courier: CourierRow) => {
    setEditing(courier);
    setForm(courierFormFromRow(courier));
    setFormOpen(true);
    setSelected(null);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      notification.error('Missing fields', 'Name and code are required');
      return;
    }
    setSaving(true);
    try {
      await saveCourier(editing?.id || null, form);
      notification.success(editing ? 'Courier updated' : 'Courier created', form.name);
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Could not save courier');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (courier: CourierRow) => {
    if (!window.confirm(`Delete ${courier.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteCourier(courier.id);
      notification.success('Deleted', `${courier.name} removed`);
      setSelected(null);
      load();
    } catch (err) {
      notification.error('Delete failed', err instanceof Error ? err.message : 'Could not delete courier');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-gray-900">Couriers</h1>
                <p className="text-xs text-gray-500">Delivery partners</p>
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

            <div className="mb-3 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 p-4 text-white shadow-md">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Partners</p>
                  <p className="text-2xl font-bold tabular-nums">{stats.total}</p>
                  <p className="text-xs text-slate-300">{stats.active} active</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                  <Truck className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-gray-100">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ fontSize: '16px' }}
              />
            </div>

            <label className="flex items-center gap-2 px-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded accent-primary-600"
              />
              Show inactive couriers
            </label>
          </div>

          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <Truck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No couriers found</p>
                <button type="button" onClick={openCreate} className="mt-3 text-sm font-semibold text-primary-600">
                  Add courier partner
                </button>
              </div>
            ) : (
              filtered.map((courier) => (
                <button
                  key={courier.id}
                  type="button"
                  onClick={() => setSelected(courier)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-700">
                    {courier.code.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-gray-900">{courier.name}</p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          courier.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {courier.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{courier.code}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Courier details">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-base font-bold text-slate-700">
                {selected.code.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                <p className="text-sm text-gray-500">{selected.code}</p>
              </div>
            </div>

            {(selected.contact_person || selected.contact_phone || selected.contact_email) && (
              <div className="space-y-2 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100">
                {selected.contact_person && (
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                    <User className="h-4 w-4 text-gray-400" />
                    {selected.contact_person}
                  </div>
                )}
                {selected.contact_phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                    <Phone className="h-4 w-4 text-gray-400" />
                    {selected.contact_phone}
                  </div>
                )}
                {selected.contact_email && (
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                    <Mail className="h-4 w-4 text-gray-400" />
                    {selected.contact_email}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => openEdit(selected)} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white">
                <Pencil className="h-4 w-4" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(selected)}
                disabled={deleting}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-red-50 py-3 text-sm font-semibold text-red-700 ring-1 ring-red-100 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} ariaLabel="Courier form">
        <h2 className="text-lg font-bold text-gray-900">{editing ? 'Edit courier' : 'New courier'}</h2>
        <div className="space-y-3">
          <Field label="Courier name *">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Fez Delivery" className={inputCls} />
          </Field>
          <Field label="Courier code *">
            <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. FEZ" className={inputCls} />
          </Field>
          <Field label="Contact person">
            <input value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Contact phone">
            <input type="tel" value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))} className={inputCls} />
          </Field>
          <Field label="Contact email">
            <input type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))} className={inputCls} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="rounded accent-primary-600"
            />
            Courier is active
          </label>
        </div>
        <button type="button" onClick={submit} disabled={saving} className="mt-2 w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : editing ? 'Update courier' : 'Create courier'}
        </button>
      </Sheet>
    </>
  );
}
