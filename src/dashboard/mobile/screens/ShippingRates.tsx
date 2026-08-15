import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  DollarSign,
  Loader,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { SectionLabel } from '../components/MobileDetailParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';
import { fetchCouriers, fetchHubs, type CourierRow, type HubRow } from '../lib/networkApi';
import {
  deleteShippingRate,
  emptyRateForm,
  fetchShippingRates,
  fetchZones,
  rateDisplayPrice,
  rateFormFromRow,
  ratePerKg,
  saveShippingRate,
  type ShippingRateFormData,
  type ShippingRateRow,
  type ZoneRow,
} from '../lib/shippingRatesApi';

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

export default function MobileShippingRates() {
  const notification = useNotification();
  const [rates, setRates] = useState<ShippingRateRow[]>([]);
  const [hubs, setHubs] = useState<HubRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterHub, setFilterHub] = useState('all');
  const [filterZone, setFilterZone] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<ShippingRateRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ShippingRateRow | null>(null);
  const [form, setForm] = useState<ShippingRateFormData>(emptyRateForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ratesData, hubsData, zonesData, couriersData] = await Promise.all([
        fetchShippingRates(),
        fetchHubs(),
        fetchZones(),
        fetchCouriers(),
      ]);
      setRates(ratesData);
      setHubs(hubsData);
      setZones(zonesData);
      setCouriers(couriersData);
    } catch {
      notification.error('Failed to Load', 'Unable to fetch shipping rates');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(
    () => ({
      total: rates.length,
      active: rates.filter((r) => r.is_active).length,
    }),
    [rates],
  );

  const filtered = useMemo(() => {
    return rates.filter((rate) => {
      if (!showInactive && !rate.is_active) return false;
      if (filterHub !== 'all' && rate.origin_hub_id !== filterHub) return false;
      if (filterZone !== 'all' && rate.destination_zone_id !== filterZone) return false;
      return true;
    });
  }, [rates, filterHub, filterZone, showInactive]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyRateForm());
    setFormOpen(true);
    setSelected(null);
  };

  const openEdit = (rate: ShippingRateRow) => {
    setEditing(rate);
    setForm(rateFormFromRow(rate));
    setFormOpen(true);
    setSelected(null);
  };

  const submit = async () => {
    if (!form.origin_hub_id || !form.destination_zone_id || !form.courier_id) {
      notification.error('Missing fields', 'Hub, zone, and courier are required');
      return;
    }
    setSaving(true);
    try {
      await saveShippingRate(editing?.id || null, form);
      notification.success(editing ? 'Rate updated' : 'Rate created', 'Shipping rate saved');
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Could not save rate');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rate: ShippingRateRow) => {
    const label = `${rate.hubs?.name || 'Hub'} → ${rate.zones?.name || 'Zone'}`;
    if (!window.confirm(`Delete rate for ${label}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteShippingRate(rate.id);
      notification.success('Deleted', 'Shipping rate removed');
      setSelected(null);
      load();
    } catch (err) {
      notification.error('Delete failed', err instanceof Error ? err.message : 'Could not delete rate');
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
                <h1 className="text-lg font-bold text-gray-900">Shipping Rates</h1>
                <p className="text-xs text-gray-500">Hub → zone pricing</p>
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

            <div className="mb-3 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-800 to-teal-950 p-4 text-white shadow-md">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-300/80">Rates</p>
                  <p className="text-2xl font-bold tabular-nums">{stats.total}</p>
                  <p className="text-xs text-emerald-100/80">{stats.active} active</p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                  <DollarSign className="h-5 w-5" />
                </div>
              </div>
            </div>

            <SectionLabel>Origin hub</SectionLabel>
            <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
              <button
                type="button"
                onClick={() => setFilterHub('all')}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
                  filterHub === 'all' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'
                }`}
              >
                All hubs
              </button>
              {hubs.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setFilterHub(h.id)}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
                    filterHub === h.id ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'
                  }`}
                >
                  {h.name}
                </button>
              ))}
            </div>

            <SectionLabel>Destination zone</SectionLabel>
            <div className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
              <button
                type="button"
                onClick={() => setFilterZone('all')}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
                  filterZone === 'all' ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'
                }`}
              >
                All zones
              </button>
              {zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setFilterZone(z.id)}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
                    filterZone === z.id ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'
                  }`}
                >
                  {z.name}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 px-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded accent-primary-600"
              />
              Show inactive rates
            </label>
          </div>

          <div className="space-y-2 px-4 pt-1">
            <SectionLabel>
              {filtered.length} rate{filtered.length !== 1 ? 's' : ''}
            </SectionLabel>

            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <DollarSign className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No rates match</p>
                <button type="button" onClick={openCreate} className="mt-3 text-sm font-semibold text-primary-600">
                  Add shipping rate
                </button>
              </div>
            ) : (
              filtered.map((rate) => {
                const price = rateDisplayPrice(rate);
                const perKg = ratePerKg(rate);
                return (
                  <button
                    key={rate.id}
                    type="button"
                    onClick={() => setSelected(rate)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {rate.hubs?.name || 'Hub'} → {rate.zones?.name || 'Zone'}
                        </p>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            rate.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {rate.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">{rate.couriers?.name || 'Courier'}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-gray-500">
                        {rate.delivery_timeline_days > 0 && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5">{rate.delivery_timeline_days}d delivery</span>
                        )}
                        {perKg > 0 && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5">+{formatNaira(perKg)}/kg</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <p className="text-sm font-bold tabular-nums text-primary-600">{formatNaira(price)}</p>
                      <ChevronRight className="h-4 w-4 text-gray-300" />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="Rate details">
        {selected && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {selected.hubs?.name || 'Hub'} → {selected.zones?.name || 'Zone'}
              </h2>
              <p className="text-sm text-gray-500">{selected.couriers?.name || 'Courier'}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100">
              <div>
                <p className="text-[10px] uppercase text-gray-400">Base rate</p>
                <p className="text-sm font-semibold tabular-nums text-gray-900">{formatNaira(rateDisplayPrice(selected))}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-gray-400">Per kg</p>
                <p className="text-sm font-semibold tabular-nums text-gray-900">{formatNaira(ratePerKg(selected))}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-gray-400">Weight range</p>
                <p className="text-sm text-gray-900">
                  {selected.min_weight ?? 0}–{selected.max_weight ?? 4} kg
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-gray-400">Delivery</p>
                <p className="text-sm text-gray-900">{selected.delivery_timeline_days || 3} days</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-gray-400">VAT</p>
                <p className="text-sm text-gray-900">{selected.vat_percentage ?? 7.5}%</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-gray-400">Free shipping</p>
                <p className="text-sm tabular-nums text-gray-900">
                  {selected.free_shipping_threshold ? formatNaira(selected.free_shipping_threshold) : '—'}
                </p>
              </div>
            </div>

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

      <Sheet open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} ariaLabel="Shipping rate form">
        <h2 className="text-lg font-bold text-gray-900">{editing ? 'Edit rate' : 'New rate'}</h2>
        <div className="space-y-3">
          <Field label="Origin hub *">
            <select
              value={form.origin_hub_id}
              onChange={(e) => setForm((f) => ({ ...f, origin_hub_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">Select hub</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Destination zone *">
            <select
              value={form.destination_zone_id}
              onChange={(e) => setForm((f) => ({ ...f, destination_zone_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">Select zone</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Courier *">
            <select
              value={form.courier_id}
              onChange={(e) => setForm((f) => ({ ...f, courier_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">Select courier</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Base / flat rate (₦) *">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.flat_rate}
              onChange={(e) => setForm((f) => ({ ...f, flat_rate: parseFloat(e.target.value) || 0 }))}
              className={inputCls}
            />
          </Field>
          <Field label="Additional rate per kg (₦)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.additional_weight_rate}
              onChange={(e) => setForm((f) => ({ ...f, additional_weight_rate: parseFloat(e.target.value) || 0 }))}
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min weight (kg)">
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.min_weight}
                onChange={(e) => setForm((f) => ({ ...f, min_weight: parseFloat(e.target.value) || 0 }))}
                className={inputCls}
              />
            </Field>
            <Field label="Max weight (kg)">
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.max_weight}
                onChange={(e) => setForm((f) => ({ ...f, max_weight: parseFloat(e.target.value) || 0 }))}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="VAT (%)">
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={form.vat_percentage}
              onChange={(e) => setForm((f) => ({ ...f, vat_percentage: parseFloat(e.target.value) || 0 }))}
              className={inputCls}
            />
          </Field>
          <Field label="Free shipping threshold (₦)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.free_shipping_threshold}
              onChange={(e) => setForm((f) => ({ ...f, free_shipping_threshold: parseFloat(e.target.value) || 0 }))}
              className={inputCls}
            />
          </Field>
          <Field label="Delivery timeline (days)">
            <input
              type="number"
              min="1"
              value={form.delivery_timeline_days}
              onChange={(e) => setForm((f) => ({ ...f, delivery_timeline_days: parseInt(e.target.value, 10) || 1 }))}
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="rounded accent-primary-600"
            />
            Rate is active
          </label>
        </div>
        <button type="button" onClick={submit} disabled={saving} className="mt-2 w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : editing ? 'Update rate' : 'Create rate'}
        </button>
      </Sheet>
    </>
  );
}
