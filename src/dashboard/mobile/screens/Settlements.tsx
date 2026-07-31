import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Banknote,
  CheckCircle,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  Loader,
  Package,
  Pencil,
  Plus,
  TrendingDown,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  type PendingPayment,
  type Settlement,
  type SettlementItem,
  type SubOrderRow,
  fmtFinance,
  loadSettlementItems,
  loadUnsettledSubOrders,
  orderLabel,
  plValue,
  saveSubOrderCosts,
  settlementsApi,
} from '../lib/financeApi';

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-900 outline-none focus:border-primary-500 focus:bg-white';

function courierInitial(name: string) {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

function fmtShortDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function PlPill({ value, size = 'sm' }: { value: number; size?: 'sm' | 'md' }) {
  const gain = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full font-semibold ${
        size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
      } ${gain ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}
    >
      {gain ? <TrendingUp className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} /> : <TrendingDown className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />}
      {gain ? '+' : ''}₦{Math.abs(value).toLocaleString()}
    </span>
  );
}

function statusCls(status: string) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-blue-100 text-blue-800',
    processing: 'bg-violet-100 text-violet-800',
    paid: 'bg-emerald-100 text-emerald-800',
    partial: 'bg-orange-100 text-orange-800',
  };
  return map[status] || 'bg-gray-100 text-gray-700';
}

function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="pb-1">
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onClick,
  primary,
  danger,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left active:scale-[0.99] ${
        primary
          ? 'bg-primary-600 text-white'
          : danger
            ? 'bg-red-50 text-red-800 ring-1 ring-red-100'
            : 'bg-gray-50 text-gray-900 ring-1 ring-gray-100'
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${primary ? 'bg-white/15' : 'bg-white'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {hint && <span className={`block text-xs ${primary ? 'text-primary-100' : 'text-gray-500'}`}>{hint}</span>}
      </span>
      <ChevronRight className={`h-4 w-4 shrink-0 ${primary ? 'text-white/70' : 'text-gray-400'}`} />
    </button>
  );
}

export default function MobileSettlements() {
  const notification = useNotification();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [pending, setPending] = useState<PendingPayment[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPending, setSelectedPending] = useState<PendingPayment | null>(null);
  const [createCourier, setCreateCourier] = useState<PendingPayment | null>(null);
  const [detailsCourier, setDetailsCourier] = useState<PendingPayment | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<Settlement | null>(null);
  const [historySettlement, setHistorySettlement] = useState<Settlement | null>(null);
  const [markPaidSettlement, setMarkPaidSettlement] = useState<Settlement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRes, settlementsRes] = await Promise.all([
        settlementsApi<{ success?: boolean; data?: PendingPayment[] }>('/pending'),
        settlementsApi<{ success?: boolean; data?: Settlement[] }>(''),
      ]);
      if (pendingRes.success) setPending(pendingRes.data || []);
      if (settlementsRes.success) setSettlements(settlementsRes.data || []);
    } catch {
      notification.error('Load failed', 'Unable to fetch settlement data');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPending = pending.reduce((s, p) => s + p.total_amount_due, 0);
  const totalShipments = pending.reduce((s, p) => s + p.pending_shipments, 0);
  const totalPaid = settlements.filter((s) => s.status === 'paid').reduce((s, x) => s + x.total_amount_paid, 0);
  const paidSettlements = settlements.filter((s) => s.status === 'paid');
  const totalDue = paidSettlements.reduce((s, x) => s + x.total_amount_due, 0);
  const shippingPl = totalDue - totalPaid;
  const unpaidHistory = settlements.filter((s) => s.status !== 'paid').length;

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          {/* Sticky mobile header */}
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3">
              <h1 className="text-lg font-bold text-gray-900">Settlements</h1>
              <p className="text-xs text-gray-500">Courier payouts &amp; shipping P&amp;L</p>
            </div>

            {/* Hero — primary mobile metric */}
            <div className="mb-3 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-primary-900 p-4 text-white shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Outstanding</p>
                  <p className="mt-0.5 text-2xl font-bold tabular-nums tracking-tight">{fmtFinance(totalPending)}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-300">
                    <Package className="h-3.5 w-3.5" />
                    {totalShipments} shipment{totalShipments !== 1 ? 's' : ''} · {pending.length} courier{pending.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-right backdrop-blur-sm">
                  <p className="text-[10px] text-slate-400">All-time P&amp;L</p>
                  <p className={`text-sm font-bold tabular-nums ${shippingPl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {shippingPl >= 0 ? '+' : ''}₦{Math.abs(shippingPl).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* Horizontal stat scroller */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
              <StatChip icon={<Clock className="h-3.5 w-3.5 text-amber-600" />} label="Pending" value={fmtFinance(totalPending)} />
              <StatChip icon={<CheckCircle className="h-3.5 w-3.5 text-emerald-600" />} label="Paid out" value={fmtFinance(totalPaid)} />
              <StatChip
                icon={shippingPl >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> : <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                label="Shipping"
                value={`${shippingPl >= 0 ? '+' : ''}₦${Math.abs(shippingPl).toLocaleString()}`}
                tone={shippingPl >= 0 ? 'gain' : 'loss'}
              />
            </div>

            {/* Segmented tabs */}
            <div className="mt-3 flex gap-1.5 rounded-xl bg-gray-200/80 p-1">
              {([
                { key: 'pending' as const, label: 'Due', count: pending.length },
                { key: 'history' as const, label: 'History', count: settlements.length },
              ]).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold transition-all ${
                    tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'
                  }`}
                >
                  {t.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tab === t.key ? 'bg-primary-100 text-primary-700' : 'bg-gray-300/60 text-gray-600'}`}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* List content */}
          <div className="space-y-2 px-4 pt-1">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : tab === 'pending' ? (
              pending.length === 0 ? (
                <EmptyState
                  icon={<CheckCircle className="h-12 w-12 text-emerald-500" />}
                  title="All caught up"
                  body="No courier payments waiting right now."
                />
              ) : (
                pending.map((p) => (
                  <button
                    key={p.courier_id}
                    type="button"
                    onClick={() => setSelectedPending(p)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-base font-bold text-primary-700">
                      {courierInitial(p.courier_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-gray-900">{p.courier_name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {p.pending_shipments} shipments · {fmtShortDate(p.oldest_shipment)} – {fmtShortDate(p.newest_shipment)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums text-gray-900">{fmtFinance(p.total_amount_due)}</p>
                      {p.approved_amount > 0 && (
                        <p className="text-[10px] text-blue-600">{fmtFinance(p.approved_amount)} approved</p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                  </button>
                ))
              )
            ) : settlements.length === 0 ? (
              <EmptyState icon={<FileText className="h-12 w-12 text-gray-300" />} title="No history" body="Settlement batches will show up here." />
            ) : (
              <>
                {unpaidHistory > 0 && (
                  <p className="px-1 text-xs text-amber-700">
                    {unpaidHistory} settlement{unpaidHistory !== 1 ? 's' : ''} awaiting payment
                  </p>
                )}
                {settlements.map((s) => {
                  const saving = s.total_amount_due - s.total_amount_paid;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedHistory(s)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                    >
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${s.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {s.status === 'paid' ? <CheckCircle className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-gray-900">{s.courier_name}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusCls(s.status)}`}>
                            {s.status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {fmtShortDate(s.settlement_period_start)} – {fmtShortDate(s.settlement_period_end)} · {s.total_shipments} pkg
                        </p>
                        {s.status === 'paid' && saving !== 0 && (
                          <p className="mt-1 text-[10px] font-medium text-emerald-700">
                            {saving > 0 ? `Saved ${fmtFinance(saving)}` : `+${fmtFinance(Math.abs(saving))} vs billed`}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums">{fmtFinance(s.total_amount_due)}</p>
                        {s.status === 'paid' && <p className="text-[10px] text-gray-500">paid {fmtFinance(s.total_amount_paid)}</p>}
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </PullToRefresh>

      {/* Pending courier action menu */}
      <Sheet open={!!selectedPending} onClose={() => setSelectedPending(null)} ariaLabel="Courier actions">
        {selectedPending && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-lg font-bold text-primary-700">
                {courierInitial(selectedPending.courier_name)}
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedPending.courier_name}</h2>
                <p className="text-sm text-gray-500">
                  {fmtFinance(selectedPending.total_amount_due)} due · {selectedPending.pending_shipments} shipments
                </p>
              </div>
            </div>
            <ActionRow
              icon={<Pencil className="h-5 w-5 text-primary-600" />}
              label="Review & edit costs"
              hint="Per-delivery courier cost or pay riders"
              onClick={() => {
                setDetailsCourier(selectedPending);
                setSelectedPending(null);
              }}
            />
            <ActionRow
              icon={<Plus className="h-5 w-5 text-white" />}
              label="Create settlement batch"
              hint="For Fez and courier companies"
              primary
              onClick={() => {
                setCreateCourier(selectedPending);
                setSelectedPending(null);
              }}
            />
          </div>
        )}
      </Sheet>

      {/* History settlement action menu */}
      <Sheet open={!!selectedHistory} onClose={() => setSelectedHistory(null)} ariaLabel="Settlement actions">
        {selectedHistory && (
          <div className="space-y-3">
            <SheetTitle
              title={selectedHistory.courier_name}
              subtitle={`${fmtShortDate(selectedHistory.settlement_period_start)} – ${fmtShortDate(selectedHistory.settlement_period_end)}`}
            />
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-gray-50 p-3 ring-1 ring-gray-100">
              <MiniStat label="Shipments" value={String(selectedHistory.total_shipments)} />
              <MiniStat label="Billed" value={fmtFinance(selectedHistory.total_amount_due)} />
              <MiniStat label="Paid" value={selectedHistory.status === 'paid' ? fmtFinance(selectedHistory.total_amount_paid) : '—'} />
            </div>
            <ActionRow
              icon={<Banknote className="h-5 w-5 text-primary-600" />}
              label="View shipping P&amp;L"
              hint="Line-by-line charged vs paid"
              onClick={() => {
                setHistorySettlement(selectedHistory);
                setSelectedHistory(null);
              }}
            />
            {selectedHistory.status !== 'paid' && (
              <ActionRow
                icon={<CreditCard className="h-5 w-5 text-white" />}
                label="Mark as paid"
                hint="Record payment reference & amount"
                primary
                onClick={() => {
                  setMarkPaidSettlement(selectedHistory);
                  setSelectedHistory(null);
                }}
              />
            )}
          </div>
        )}
      </Sheet>

      {createCourier && (
        <CreateSettlementSheet courier={createCourier} onClose={() => setCreateCourier(null)} onSuccess={() => { setCreateCourier(null); load(); }} />
      )}
      {detailsCourier && (
        <PendingDetailsSheet courier={detailsCourier} onClose={() => setDetailsCourier(null)} onRefresh={load} />
      )}
      {historySettlement && (
        <SettlementDetailsSheet settlement={historySettlement} onClose={() => setHistorySettlement(null)} />
      )}
      {markPaidSettlement && (
        <MarkPaidSheet
          settlement={markPaidSettlement}
          onClose={() => setMarkPaidSettlement(null)}
          onSuccess={() => { setMarkPaidSettlement(null); load(); }}
        />
      )}
    </>
  );
}

function StatChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'gain' | 'loss';
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-gray-100">
      {icon}
      <div>
        <p className="text-[10px] text-gray-500">{label}</p>
        <p className={`text-xs font-bold tabular-nums ${tone === 'gain' ? 'text-emerald-700' : tone === 'loss' ? 'text-red-700' : 'text-gray-900'}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-xs font-bold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
      <div className="mx-auto mb-3 flex justify-center">{icon}</div>
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{body}</p>
    </div>
  );
}

// ─── Create settlement ────────────────────────────────────────────────────────

function CreateSettlementSheet({
  courier,
  onClose,
  onSuccess,
}: {
  courier: PendingPayment;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const notification = useNotification();
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(
    courier.oldest_shipment ? new Date(courier.oldest_shipment).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
  );
  const [endDate, setEndDate] = useState(
    courier.newest_shipment ? new Date(courier.newest_shipment).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
  );

  const submit = async () => {
    setLoading(true);
    try {
      const res = await settlementsApi<{ success?: boolean; error?: string }>('', {
        method: 'POST',
        body: JSON.stringify({ courier_id: courier.courier_id, start_date: startDate, end_date: endDate }),
      });
      if (res.success) {
        notification.success('Created', 'Settlement batch created');
        onSuccess();
      } else notification.error('Failed', res.error || 'Unable to create');
    } catch {
      notification.error('Error', 'Failed to create settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open onClose={onClose} ariaLabel="Create settlement">
      <SheetTitle title="New settlement" subtitle={courier.courier_name} />
      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Shipments</span>
          <span className="font-semibold">{courier.pending_shipments}</span>
        </div>
        <div className="mt-2 flex justify-between text-sm">
          <span className="text-gray-500">Total cost</span>
          <span className="font-bold tabular-nums">{fmtFinance(courier.total_amount_due)}</span>
        </div>
      </div>
      <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
        Enter actual costs under <strong>Review & edit costs</strong> before creating a batch.
      </p>
      <div className="space-y-3">
        <Field label="Period start">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Period end">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={loading}
        className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white active:bg-primary-700 disabled:opacity-60"
      >
        {loading ? 'Creating…' : 'Create settlement'}
      </button>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

// ─── Pending details ──────────────────────────────────────────────────────────

function PendingDetailsSheet({
  courier,
  onClose,
  onRefresh,
}: {
  courier: PendingPayment;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const notification = useNotification();
  const [rows, setRows] = useState<SubOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editedCosts, setEditedCosts] = useState<Record<string, string>>({});
  const [payRow, setPayRow] = useState<SubOrderRow | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await loadUnsettledSubOrders(courier.courier_id);
      setRows(data);
      const initial: Record<string, string> = {};
      data.forEach((r) => {
        initial[r.id] = r.real_shipping_cost != null ? String(r.real_shipping_cost) : '';
      });
      setEditedCosts((prev) => ({ ...initial, ...prev }));
    } catch {
      notification.error('Load failed', 'Could not load deliveries');
    }
  }, [courier.courier_id, notification]);

  useEffect(() => {
    (async () => {
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const hasUnsaved = rows.some((r) => editedCosts[r.id] !== '' && editedCosts[r.id] !== String(r.real_shipping_cost ?? ''));

  const totals = useMemo(() => {
    let charged = 0;
    let cost = 0;
    for (const r of rows) {
      charged += Number(r.allocated_shipping_fee ?? 0);
      const c = editedCosts[r.id] !== '' ? Number(editedCosts[r.id]) : Number(r.real_shipping_cost ?? r.courier_charge ?? r.allocated_shipping_fee ?? 0);
      cost += c;
    }
    return { charged, cost, pl: charged - cost };
  }, [rows, editedCosts]);

  const saveCosts = async () => {
    setSaving(true);
    try {
      const updates = rows
        .filter((r) => editedCosts[r.id] !== '' && editedCosts[r.id] !== String(r.real_shipping_cost ?? ''))
        .map((r) => ({ id: r.id, cost: Number(editedCosts[r.id]) }));
      await saveSubOrderCosts(updates);
      await reload();
      notification.success('Saved', `Updated ${updates.length} cost(s)`);
    } catch {
      notification.error('Save failed', 'Could not update costs');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet open onClose={onClose} ariaLabel="Unsettled deliveries">
        <SheetTitle title={courier.courier_name} subtitle={`${rows.length} unsettled deliveries`} />

        {!loading && rows.length > 0 && (
          <div className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-white">
            <div>
              <p className="text-[10px] text-slate-400">Charged</p>
              <p className="text-sm font-bold tabular-nums">{fmtFinance(totals.charged)}</p>
            </div>
            <div className="h-8 w-px bg-white/15" />
            <div>
              <p className="text-[10px] text-slate-400">Cost</p>
              <p className="text-sm font-bold tabular-nums">{fmtFinance(totals.cost)}</p>
            </div>
            <div className="h-8 w-px bg-white/15" />
            <div>
              <p className="text-[10px] text-slate-400">P&amp;L</p>
              <PlPill value={totals.pl} size="md" />
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader className="h-7 w-7 animate-spin text-primary-600" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Package className="h-10 w-10 text-gray-300" />} title="Nothing here" body="No unsettled deliveries for this courier." />
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const charged = Number(r.allocated_shipping_fee ?? 0);
              const costInput = editedCosts[r.id] ?? '';
              const costVal = costInput !== '' ? Number(costInput) : Number(r.real_shipping_cost ?? r.courier_charge ?? r.allocated_shipping_fee ?? 0);
              const pl = plValue(charged, costVal);
              const delivered = r.delivered_at ?? r.updated_at;
              const open = expandedId === r.id;

              return (
                <div key={r.id} className="overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-gray-100">
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : r.id)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-gray-100"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-900">{orderLabel(r)}</p>
                      <p className="text-xs text-gray-500">{delivered ? fmtShortDate(delivered) : '—'} · Charged {fmtFinance(charged)}</p>
                    </div>
                    {(costInput !== '' || r.real_shipping_cost != null) && <PlPill value={pl} />}
                    <ChevronRight className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-gray-200/80 bg-white px-3 pb-3 pt-3">
                      <Field label="Courier cost">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">₦</span>
                          <input
                            type="number"
                            min="0"
                            inputMode="decimal"
                            value={costInput}
                            onChange={(e) => setEditedCosts((p) => ({ ...p, [r.id]: e.target.value }))}
                            placeholder={String(r.allocated_shipping_fee ?? 0)}
                            className={`${inputCls} pl-8 text-right`}
                          />
                        </div>
                      </Field>
                      <button
                        type="button"
                        onClick={() => setPayRow(r)}
                        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 py-3 text-sm font-semibold text-white active:bg-primary-700"
                      >
                        <CreditCard className="h-4 w-4" />
                        Pay rider
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Companies: save costs then create a settlement. Local riders: pay per delivery.
        </p>

        {hasUnsaved && (
          <button
            type="button"
            onClick={saveCosts}
            disabled={saving}
            className="sticky bottom-0 w-full rounded-2xl bg-gray-900 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save all cost changes'}
          </button>
        )}
      </Sheet>

      {payRow && (
        <PayDeliverySheet
          row={payRow}
          onClose={() => setPayRow(null)}
          onSuccess={async () => {
            setPayRow(null);
            await reload();
            onRefresh();
          }}
        />
      )}
    </>
  );
}

function PayDeliverySheet({
  row,
  onClose,
  onSuccess,
}: {
  row: SubOrderRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const notification = useNotification();
  const [loading, setLoading] = useState(false);
  const defaultAmount = String(row.real_shipping_cost ?? row.allocated_shipping_fee ?? row.courier_charge ?? '');
  const [amount, setAmount] = useState(defaultAmount);
  const [paidTo, setPaidTo] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  const charged = Number(row.allocated_shipping_fee ?? 0);
  const pl = charged - (amount !== '' ? Number(amount) : 0);

  const submit = async () => {
    if (!paymentReference.trim()) {
      notification.error('Required', 'Payment reference is required');
      return;
    }
    setLoading(true);
    try {
      const res = await settlementsApi<{ success?: boolean; error?: string }>('/pay-delivery', {
        method: 'POST',
        body: JSON.stringify({
          sub_order_id: row.id,
          amount: Number(amount),
          paid_to: paidTo.trim() || undefined,
          payment_reference: paymentReference.trim(),
          payment_method: paymentMethod,
          payment_date: paymentDate,
          notes: notes.trim() || undefined,
        }),
      });
      if (res.success) {
        notification.success('Paid', 'Payment recorded');
        onSuccess();
      } else notification.error('Failed', res.error || 'Could not record');
    } catch {
      notification.error('Error', 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open onClose={onClose} ariaLabel="Pay rider">
      <SheetTitle title="Pay rider" subtitle={orderLabel(row)} />
      <div className="space-y-3">
        <Field label="Rider name / phone">
          <input type="text" value={paidTo} onChange={(e) => setPaidTo(e.target.value)} placeholder="Optional" className={inputCls} />
        </Field>
        <Field label="Amount paid">
          <input type="number" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          {amount !== '' && (
            <div className="mt-2 flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
              <span className="text-xs text-gray-500">Customer charged {fmtFinance(charged)}</span>
              <PlPill value={pl} size="md" />
            </div>
          )}
        </Field>
        <Field label="Payment reference *">
          <input type="text" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Receipt or transfer ref" className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Method">
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Transfer</option>
              <option value="online">Online</option>
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Notes">
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={inputCls} />
        </Field>
        <button
          type="button"
          onClick={submit}
          disabled={loading || !amount}
          className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </Sheet>
  );
}

// ─── Settlement P&L detail ────────────────────────────────────────────────────

function SettlementDetailsSheet({ settlement, onClose }: { settlement: Settlement; onClose: () => void }) {
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setItems(await loadSettlementItems(settlement.id));
      } finally {
        setLoading(false);
      }
    })();
  }, [settlement.id]);

  const totalCharged = items.reduce((s, i) => s + Number(i.sub_orders?.allocated_shipping_fee ?? 0), 0);
  const totalPaid = settlement.total_amount_paid;
  const totalPl = totalCharged - totalPaid;

  return (
    <Sheet open onClose={onClose} ariaLabel="Settlement P and L">
      <SheetTitle title="Shipping P&amp;L" subtitle={settlement.courier_name} />

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-blue-50 p-3 text-center ring-1 ring-blue-100">
            <p className="text-[10px] font-medium text-blue-600">Charged</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-blue-900">{fmtFinance(totalCharged)}</p>
          </div>
          <div className="rounded-2xl bg-orange-50 p-3 text-center ring-1 ring-orange-100">
            <p className="text-[10px] font-medium text-orange-600">Paid</p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-orange-900">{fmtFinance(totalPaid)}</p>
          </div>
          <div className={`rounded-2xl p-3 text-center ring-1 ${totalPl >= 0 ? 'bg-emerald-50 ring-emerald-100' : 'bg-red-50 ring-red-100'}`}>
            <p className={`text-[10px] font-medium ${totalPl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Net</p>
            <div className="mt-1 flex justify-center">
              <PlPill value={totalPl} size="md" />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader className="h-7 w-7 animate-spin text-primary-600" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No line items</p>
      ) : (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {items.map((item) => {
            const so = item.sub_orders;
            const charged = Number(so?.allocated_shipping_fee ?? 0);
            const cost = Number(item.amount);
            const pl = charged - cost;
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-gray-50 px-3 py-3 ring-1 ring-gray-100">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">{so ? orderLabel(so) : '—'}</p>
                  <p className="text-xs text-gray-500">{fmtFinance(charged)} charged → {fmtFinance(cost)} paid</p>
                </div>
                <PlPill value={pl} size="md" />
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

// ─── Mark paid ────────────────────────────────────────────────────────────────

function MarkPaidSheet({
  settlement,
  onClose,
  onSuccess,
}: {
  settlement: Settlement;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const notification = useNotification();
  const [loading, setLoading] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [actualAmountPaid, setActualAmountPaid] = useState(String(settlement.total_amount_due));
  const [notes, setNotes] = useState('');

  const saving = settlement.total_amount_due - Number(actualAmountPaid || settlement.total_amount_due);

  const submit = async () => {
    if (!paymentReference.trim()) {
      notification.error('Required', 'Payment reference is required');
      return;
    }
    setLoading(true);
    try {
      const res = await settlementsApi<{ success?: boolean; error?: string }>(`/${settlement.id}/mark-paid`, {
        method: 'PUT',
        body: JSON.stringify({
          payment_reference: paymentReference,
          payment_method: paymentMethod,
          payment_date: paymentDate,
          notes,
          actual_amount_paid: Number(actualAmountPaid),
        }),
      });
      if (res.success) {
        notification.success('Recorded', saving > 0 ? `Saved ${fmtFinance(saving)} vs billed` : 'Payment recorded');
        onSuccess();
      } else notification.error('Failed', res.error || 'Unable to update');
    } catch {
      notification.error('Error', 'Failed to update settlement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open onClose={onClose} ariaLabel="Mark settlement paid">
      <SheetTitle title="Mark as paid" subtitle={settlement.courier_name} />
      <div className="rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100">
        <p className="text-sm text-gray-500">Amount billed</p>
        <p className="text-xl font-bold tabular-nums text-gray-900">{fmtFinance(settlement.total_amount_due)}</p>
      </div>
      <div className="space-y-3">
        <Field label="Actual amount paid">
          <input type="number" min="0" inputMode="decimal" value={actualAmountPaid} onChange={(e) => setActualAmountPaid(e.target.value)} className={inputCls} />
          {actualAmountPaid && Number(actualAmountPaid) !== settlement.total_amount_due && (
            <p className={`mt-2 rounded-xl px-3 py-2 text-xs font-medium ${saving > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              {saving > 0 ? `Saving ${fmtFinance(saving)} vs billed amount` : `Paying ${fmtFinance(Math.abs(saving))} extra`}
            </p>
          )}
        </Field>
        <Field label="Payment reference *">
          <input type="text" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="e.g. TRF/2026/001" className={inputCls} />
        </Field>
        <Field label="Payment method">
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="online">Online</option>
          </select>
        </Field>
        <Field label="Payment date">
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={2} className={inputCls} />
        </Field>
        <button type="button" onClick={submit} disabled={loading} className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-60">
          {loading ? 'Saving…' : 'Confirm payment'}
        </button>
      </div>
    </Sheet>
  );
}
