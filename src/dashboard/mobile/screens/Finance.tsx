import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  BarChart3,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Loader,
  Plus,
  Receipt,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  EXPENSE_CATEGORIES,
  type AddExpenseForm,
  type ExpenseCategory,
  type MonthlyPnl,
  type RecentExpense,
  type ReturnStats,
  addLedgerExpense,
  computeYtdTotals,
  fmtFinance,
  loadFinanceDashboard,
} from '../lib/financeApi';

const CATEGORY_COLORS = [
  'bg-primary-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
  'bg-indigo-500',
];

const emptyExpenseForm = (): AddExpenseForm => ({
  category: 'operations',
  subcategory: 'miscellaneous',
  description: '',
  amount: '',
  paid_to: '',
  paid_at: new Date().toISOString().split('T')[0],
  payment_method: 'bank_transfer',
  tax_deductible: true,
});

function MarginRing({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const deg = (clamped / 100) * 360;
  return (
    <div
      className="relative h-16 w-16 shrink-0 rounded-full"
      style={{
        background: `conic-gradient(#2563eb ${deg}deg, #e5e7eb ${deg}deg)`,
      }}
    >
      <div className="absolute inset-1.5 flex flex-col items-center justify-center rounded-full bg-slate-900">
        <span className="text-sm font-bold text-white">{clamped}%</span>
        <span className="text-[8px] uppercase tracking-wide text-slate-400">margin</span>
      </div>
    </div>
  );
}

function MonthlyBarChart({ rows }: { rows: MonthlyPnl[] }) {
  const chartRows = [...rows].slice(0, 8).reverse();
  const maxRev = Math.max(...chartRows.map((m) => Number(m.revenue || 0)), 1);

  if (chartRows.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">No monthly data yet</p>;
  }

  return (
    <div className="flex items-end justify-between gap-1.5 pt-2" style={{ height: 120 }}>
      {chartRows.map((m) => {
        const rev = Number(m.revenue || 0);
        const profit = Number(m.gross_profit || 0);
        const revH = Math.max(8, (rev / maxRev) * 100);
        const profitH = rev > 0 ? Math.max(4, (Math.abs(profit) / maxRev) * 100) : 0;
        const label = m.period?.slice(5) || m.period;

        return (
          <div key={m.period} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="relative flex w-full flex-1 items-end justify-center gap-0.5">
              <div
                className="w-[42%] rounded-t bg-blue-200"
                style={{ height: `${revH}%` }}
                title={`Revenue ${fmtFinance(rev)}`}
              />
              <div
                className={`w-[42%] rounded-t ${profit >= 0 ? 'bg-emerald-500' : 'bg-red-400'}`}
                style={{ height: `${profitH}%` }}
                title={`Profit ${fmtFinance(profit)}`}
              />
            </div>
            <span className="truncate text-[9px] font-medium text-gray-500">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function RevenueMixBar({
  commission,
  margin,
  shipping,
}: {
  commission: number;
  margin: number;
  shipping: number;
}) {
  const total = commission + margin + shipping || 1;
  const segments = [
    { label: 'Commission', value: commission, cls: 'bg-blue-500' },
    { label: 'Own-store', value: margin, cls: 'bg-violet-500' },
    { label: 'Shipping', value: shipping, cls: 'bg-teal-500' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
        {segments.map((s) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={s.cls}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${fmtFinance(s.value)}`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className={`h-2 w-2 rounded-full ${s.cls}`} />
            <span>{s.label}</span>
            <span className="font-semibold text-gray-900">{fmtFinance(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MobileFinance() {
  const notification = useNotification();
  const currentYear = new Date().getFullYear();

  const [monthlyPnl, setMonthlyPnl] = useState<MonthlyPnl[]>([]);
  const [expensesByCategory, setExpensesByCategory] = useState<ExpenseCategory[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<RecentExpense[]>([]);
  const [returnStats, setReturnStats] = useState<ReturnStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [form, setForm] = useState<AddExpenseForm>(emptyExpenseForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadFinanceDashboard();
      setMonthlyPnl(data.monthlyPnl);
      setExpensesByCategory(data.expensesByCategory);
      setRecentExpenses(data.recentExpenses);
      setReturnStats(data.returnStats);
    } catch {
      notification.error('Load failed', 'Could not fetch financial data');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    load();
  }, [load]);

  const ytd = useMemo(() => computeYtdTotals(monthlyPnl), [monthlyPnl]);
  const profitMarginPct = ytd.revenue > 0 ? Math.round((ytd.profit / ytd.revenue) * 100) : 0;
  const totalYtdExpenses = expensesByCategory.reduce((s, c) => s + c.total_amount, 0);

  const handleAddExpense = async () => {
    if (!form.description || !form.amount || !form.paid_at) {
      notification.error('Missing fields', 'Description, amount and date are required');
      return;
    }
    const amount = parseFloat(form.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      notification.error('Invalid amount', 'Enter a valid positive amount');
      return;
    }
    setSaving(true);
    try {
      await addLedgerExpense(form);
      notification.success('Expense added', `${fmtFinance(amount)} recorded under ${form.category}`);
      setExpenseOpen(false);
      setForm(emptyExpenseForm());
      load();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Could not save expense');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900';

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-4 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-gray-900">Finance & P&amp;L</h1>
              <p className="text-xs text-gray-500">Year-to-date · {currentYear}</p>
            </div>
            <button
              type="button"
              onClick={() => setExpenseOpen(true)}
              className="flex shrink-0 items-center gap-1 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              Expense
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-primary-600" />
            </div>
          ) : (
            <>
              {/* Hero analytics card */}
              <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-primary-900 p-4 text-white shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Net profit (YTD)</p>
                    <p className={`mt-1 text-2xl font-bold tabular-nums ${ytd.profit >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      {fmtFinance(ytd.profit)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {ytd.orders.toLocaleString()} orders · Revenue {fmtFinance(ytd.revenue)}
                    </p>
                  </div>
                  <MarginRing pct={profitMarginPct} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
                  <div>
                    <p className="text-[10px] text-slate-400">Revenue</p>
                    <p className="text-sm font-semibold tabular-nums">{fmtFinance(ytd.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">Expenses</p>
                    <p className="text-sm font-semibold tabular-nums text-red-300">{fmtFinance(ytd.expenses)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">VAT</p>
                    <p className="text-sm font-semibold tabular-nums">{fmtFinance(ytd.vat)}</p>
                  </div>
                </div>
              </div>

              {/* KPI strip */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Gross sales', value: fmtFinance(ytd.grossSales), icon: TrendingUp, bg: 'from-blue-50 to-blue-100 border-blue-200', fg: 'text-blue-700' },
                  { label: 'Refunds paid', value: fmtFinance(ytd.refunds), icon: TrendingDown, bg: 'from-orange-50 to-orange-100 border-orange-200', fg: 'text-orange-700' },
                ].map((k) => (
                  <div key={k.label} className={`rounded-xl border bg-gradient-to-br p-3 ${k.bg}`}>
                    <k.icon className={`mb-1.5 h-4 w-4 ${k.fg}`} />
                    <p className="text-[10px] text-gray-500">{k.label}</p>
                    <p className={`text-sm font-bold tabular-nums ${k.fg}`}>{k.value}</p>
                  </div>
                ))}
              </div>

              {/* Revenue mix */}
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary-600" />
                  <h2 className="text-sm font-semibold text-gray-900">Revenue mix</h2>
                </div>
                <RevenueMixBar commission={ytd.commission} margin={ytd.margin} shipping={ytd.shipping} />
              </div>

              {/* Monthly trend */}
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">Monthly trend</h2>
                  <div className="flex gap-2 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded bg-blue-200" /> Rev
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded bg-emerald-500" /> Profit
                    </span>
                  </div>
                </div>
                <MonthlyBarChart rows={monthlyPnl} />
              </div>

              {/* Returns & refunds */}
              {returnStats && (
                <div className="rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50/80 to-white p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-orange-600" />
                    <h2 className="text-sm font-semibold text-gray-900">Returns &amp; refunds</h2>
                    <span className="text-[10px] text-gray-400">YTD</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-orange-100">
                      <p className="text-[10px] text-gray-500">Refunded</p>
                      <p className="text-sm font-bold text-orange-700">{fmtFinance(returnStats.total_refunded)}</p>
                      <p className="text-[10px] text-gray-400">{returnStats.refund_count} refunds</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-yellow-100">
                      <p className="text-[10px] text-gray-500">Pending debits</p>
                      <p className="text-sm font-bold text-yellow-700">{fmtFinance(returnStats.pending_debits)}</p>
                      <p className="text-[10px] text-gray-400">{returnStats.pending_debit_count} vendors</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-green-100">
                      <p className="text-[10px] text-gray-500">Recovered</p>
                      <p className="text-sm font-bold text-green-700">{fmtFinance(returnStats.recovered_debits)}</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-2.5 ring-1 ring-gray-100">
                      <p className="text-[10px] text-gray-500">Net return cost</p>
                      <p className="text-sm font-bold text-blue-700">
                        {fmtFinance(Math.max(0, returnStats.total_refunded - returnStats.recovered_debits))}
                      </p>
                    </div>
                  </div>
                  {returnStats.pending_debits > 0 && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-yellow-800">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {fmtFinance(returnStats.pending_debits)} pending —{' '}
                        <Link to="/admin/vendor-debits" className="font-medium underline">
                          Vendor Debits
                        </Link>
                      </span>
                    </p>
                  )}
                  {returnStats.pending_debits === 0 && returnStats.total_refunded > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-green-700">
                      <CheckCircle className="h-3.5 w-3.5" />
                      All vendor debits settled
                    </p>
                  )}
                </div>
              )}

              {/* Monthly P&L list */}
              <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
                <div className="border-b border-gray-50 px-4 py-3">
                  <h2 className="text-sm font-semibold text-gray-900">Monthly P&amp;L</h2>
                  <p className="text-[10px] text-gray-400">Tap a row for details</p>
                </div>
                {monthlyPnl.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">No data yet</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {monthlyPnl.map((m) => {
                      const profit = Number(m.gross_profit || 0);
                      const open = expandedMonth === m.period;
                      return (
                        <div key={m.period}>
                          <button
                            type="button"
                            onClick={() => setExpandedMonth(open ? null : m.period)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">{m.period}</p>
                              <p className="text-[11px] text-gray-500">
                                Rev {fmtFinance(Number(m.revenue))} · Exp {fmtFinance(Number(m.expenses))}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold tabular-nums ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {fmtFinance(profit)}
                              </p>
                              <p className="text-[10px] text-gray-400">{Number(m.profit_margin_pct || 0).toFixed(1)}%</p>
                            </div>
                            {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                          </button>
                          {open && (
                            <div className="grid grid-cols-2 gap-2 bg-blue-50/50 px-4 pb-3 text-[11px] text-gray-600">
                              <div><span className="text-gray-400">Orders</span><br />{Number(m.order_count || 0)}</div>
                              <div><span className="text-gray-400">Gross sales</span><br />{fmtFinance(Number(m.gross_sales))}</div>
                              <div><span className="text-gray-400">Commission</span><br />{fmtFinance(Number(m.commission_revenue))}</div>
                              <div><span className="text-gray-400">Margin</span><br />{fmtFinance(Number(m.margin_revenue))}</div>
                              <div><span className="text-gray-400">Shipping</span><br />{fmtFinance(Number(m.shipping_revenue))}</div>
                              {Number(m.refund_amount || 0) > 0 && (
                                <div><span className="text-red-400">Refunds</span><br /><span className="text-red-600">−{fmtFinance(Number(m.refund_amount))}</span></div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Expenses by category */}
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-gray-900">
                  Expenses by category <span className="font-normal text-gray-400">(YTD)</span>
                </h2>
                {expensesByCategory.length === 0 ? (
                  <p className="text-sm text-gray-400">No expenses this year</p>
                ) : (
                  <div className="space-y-3">
                    {expensesByCategory.map((c, i) => {
                      const pct = totalYtdExpenses > 0 ? (c.total_amount / totalYtdExpenses) * 100 : 0;
                      return (
                        <div key={c.category}>
                          <div className="mb-1 flex justify-between text-xs">
                            <span className="capitalize text-gray-600">{c.category.replace(/_/g, ' ')}</span>
                            <span className="font-semibold tabular-nums text-gray-900">{fmtFinance(c.total_amount)}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full ${CATEGORY_COLORS[i % CATEGORY_COLORS.length]}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-[10px] text-gray-400">{c.transaction_count} txns · {pct.toFixed(0)}%</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent expenses */}
              <div className="rounded-xl border border-gray-100 bg-white overflow-hidden shadow-sm">
                <div className="border-b border-gray-50 px-4 py-3">
                  <h2 className="text-sm font-semibold text-gray-900">Recent expenses</h2>
                </div>
                {recentExpenses.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">No expenses recorded</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {recentExpenses.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-gray-900">{e.description || e.subcategory || e.category}</p>
                          <p className="text-[10px] capitalize text-gray-400">
                            {e.category} ·{' '}
                            {e.paid_at ? new Date(e.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-red-600 tabular-nums">{fmtFinance(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Link
                to="/admin/settlements"
                className="flex items-center justify-between rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4"
              >
                <div className="flex items-center gap-3">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Courier settlements</p>
                    <p className="text-[11px] text-gray-500">Track shipping P&amp;L &amp; payouts</p>
                  </div>
                </div>
                <ChevronDown className="-rotate-90 h-4 w-4 text-gray-400" />
              </Link>
            </>
          )}
        </div>
      </PullToRefresh>

      <Sheet open={expenseOpen} onClose={() => setExpenseOpen(false)} ariaLabel="Add expense">
        <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary-600" />
          Record expense
        </h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Category</label>
            <select
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  category: e.target.value,
                  subcategory: EXPENSE_CATEGORIES[e.target.value]?.[0] || '',
                }))
              }
              className={inputCls}
            >
              {Object.keys(EXPENSE_CATEGORIES).map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Subcategory</label>
            <select
              value={form.subcategory}
              onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
              className={inputCls}
            >
              {(EXPENSE_CATEGORIES[form.category] || []).map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Amount (₦)</label>
            <input
              type="number"
              min="0"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className={inputCls}
              placeholder="0"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={inputCls}
              placeholder="What was this for?"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Paid to</label>
            <input
              type="text"
              value={form.paid_to}
              onChange={(e) => setForm((f) => ({ ...f, paid_to: e.target.value }))}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Date</label>
              <input
                type="date"
                value={form.paid_at}
                onChange={(e) => setForm((f) => ({ ...f, paid_at: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Method</label>
              <select
                value={form.payment_method}
                onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
                className={inputCls}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="online">Online</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.tax_deductible}
              onChange={(e) => setForm((f) => ({ ...f, tax_deductible: e.target.checked }))}
              className="rounded accent-primary-600"
            />
            Tax deductible
          </label>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setExpenseOpen(false)} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddExpense}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? <Loader className="h-4 w-4 animate-spin" /> : 'Save'}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
