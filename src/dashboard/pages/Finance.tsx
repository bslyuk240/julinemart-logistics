import { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, BarChart2,
  Plus, RefreshCw, ChevronDown, ChevronUp, Receipt,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useNotification } from '../contexts/NotificationContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyPnl {
  period: string;
  revenue: number;
  commission_revenue: number;
  margin_revenue: number;
  shipping_revenue: number;
  gross_sales: number;
  expenses: number;
  gross_profit: number;
  profit_margin_pct: number;
  vat_collected: number;
  order_count: number;
}

interface ExpenseCategory {
  category: string;
  total_amount: number;
  transaction_count: number;
}

interface RecentExpense {
  id: string;
  category: string;
  subcategory: string;
  description: string;
  amount: number;
  paid_to: string;
  paid_at: string;
  payment_method: string;
}

interface AddExpenseForm {
  category: string;
  subcategory: string;
  description: string;
  amount: string;
  paid_to: string;
  paid_at: string;
  payment_method: string;
  tax_deductible: boolean;
}

const EXPENSE_CATEGORIES: Record<string, string[]> = {
  courier:       ['delivery_fees', 'fuel', 'vehicle_maintenance'],
  marketing:     ['ads', 'influencer', 'content', 'print'],
  platform:      ['netlify', 'supabase', 'domain', 'software'],
  staff:         ['salary', 'bonus', 'training'],
  operations:    ['office', 'packaging', 'utilities', 'insurance'],
  sourcing:      ['cj_import', 'customs', 'freight'],
  other:         ['miscellaneous'],
};

const fmt = (n: number) => `₦${Number(n || 0).toLocaleString()}`;

// ─── Component ────────────────────────────────────────────────────────────────

export function FinancePage() {
  const notification = useNotification();

  const [monthlyPnl, setMonthlyPnl]         = useState<MonthlyPnl[]>([]);
  const [expensesByCategory, setExpCat]      = useState<ExpenseCategory[]>([]);
  const [recentExpenses, setRecentExpenses]  = useState<RecentExpense[]>([]);
  const [loading, setLoading]               = useState(true);
  const [showAddExpense, setShowAddExpense]  = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [expandedMonth, setExpandedMonth]   = useState<string | null>(null);

  const [form, setForm] = useState<AddExpenseForm>({
    category: 'operations',
    subcategory: 'miscellaneous',
    description: '',
    amount: '',
    paid_to: '',
    paid_at: new Date().toISOString().split('T')[0],
    payment_method: 'bank_transfer',
    tax_deductible: true,
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [pnlRes, catRes, expRes] = await Promise.all([
        (supabase as any).from('monthly_pnl_view').select('*').limit(12),
        (supabase as any)
          .from('ledger_expenses')
          .select('category, amount')
          .gte('paid_at', new Date(new Date().getFullYear(), 0, 1).toISOString()),
        (supabase as any)
          .from('ledger_expenses')
          .select('id, category, subcategory, description, amount, paid_to, paid_at, payment_method')
          .order('paid_at', { ascending: false })
          .limit(20),
      ]);

      setMonthlyPnl(pnlRes.data || []);

      // Group by category
      const catMap: Record<string, { total: number; count: number }> = {};
      for (const row of (catRes.data || [])) {
        const c = row.category || 'other';
        if (!catMap[c]) catMap[c] = { total: 0, count: 0 };
        catMap[c].total += Number(row.amount);
        catMap[c].count += 1;
      }
      const cats: ExpenseCategory[] = Object.entries(catMap)
        .map(([category, v]) => ({ category, total_amount: v.total, transaction_count: v.count }))
        .sort((a, b) => b.total_amount - a.total_amount);
      setExpCat(cats);

      setRecentExpenses(expRes.data || []);
    } catch (e) {
      notification.error('Load Failed', 'Could not fetch financial data');
    } finally {
      setLoading(false);
    }
  };

  // ── YTD totals from monthly_pnl_view ─────────────────────────────────────
  const currentYear = new Date().getFullYear().toString();
  const ytd = monthlyPnl
    .filter(m => m.period?.startsWith(currentYear))
    .reduce(
      (acc, m) => ({
        revenue:    acc.revenue    + Number(m.revenue          || 0),
        expenses:   acc.expenses   + Number(m.expenses         || 0),
        profit:     acc.profit     + Number(m.gross_profit     || 0),
        commission: acc.commission + Number(m.commission_revenue || 0),
        margin:     acc.margin     + Number(m.margin_revenue   || 0),
        shipping:   acc.shipping   + Number(m.shipping_revenue || 0),
        grossSales: acc.grossSales + Number(m.gross_sales      || 0),
        vat:        acc.vat        + Number(m.vat_collected    || 0),
        orders:     acc.orders     + Number(m.order_count      || 0),
      }),
      { revenue: 0, expenses: 0, profit: 0, commission: 0, margin: 0, shipping: 0, grossSales: 0, vat: 0, orders: 0 }
    );

  const profitMarginPct = ytd.revenue > 0
    ? Math.round((ytd.profit / ytd.revenue) * 100)
    : 0;

  // ── Add expense ───────────────────────────────────────────────────────────
  const handleAddExpense = async () => {
    if (!form.description || !form.amount || !form.paid_at) {
      notification.error('Missing Fields', 'Description, amount and date are required');
      return;
    }
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      notification.error('Invalid Amount', 'Enter a valid positive amount');
      return;
    }
    setSaving(true);
    try {
      const d = new Date(form.paid_at);
      const { error } = await (supabase as any).from('ledger_expenses').insert({
        source:           'manual',
        category:         form.category,
        subcategory:      form.subcategory || null,
        description:      form.description,
        amount,
        currency:         'NGN',
        tax_deductible:   form.tax_deductible,
        vat_amount:       0,
        payment_method:   form.payment_method,
        paid_to:          form.paid_to || null,
        paid_at:          new Date(form.paid_at).toISOString(),
        fiscal_year:      d.getFullYear(),
        fiscal_month:     d.getMonth() + 1,
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      });
      if (error) throw error;
      notification.success('Expense Added', `₦${amount.toLocaleString()} recorded under ${form.category}`);
      setShowAddExpense(false);
      setForm(f => ({ ...f, description: '', amount: '', paid_to: '' }));
      load();
    } catch (e: any) {
      notification.error('Save Failed', e.message || 'Could not save expense');
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart2 className="w-7 h-7 text-primary-600" />
            Finance & P&amp;L
          </h1>
          <p className="text-sm text-gray-500 mt-1">Year-to-date • {currentYear}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary flex items-center gap-1.5 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => setShowAddExpense(v => !v)}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Expense
          </button>
        </div>
      </div>

      {/* Add Expense Form */}
      {showAddExpense && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary-500" /> Record an Expense
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Category *</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value, subcategory: EXPENSE_CATEGORIES[e.target.value]?.[0] || '' }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                {Object.keys(EXPENSE_CATEGORIES).map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Subcategory</label>
              <select
                value={form.subcategory}
                onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                {(EXPENSE_CATEGORIES[form.category] || []).map(s => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Amount (₦) *</label>
              <input
                type="number"
                min="0"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Description *</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="What was this expense for?"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Paid To</label>
              <input
                type="text"
                value={form.paid_to}
                onChange={e => setForm(f => ({ ...f, paid_to: e.target.value }))}
                placeholder="Vendor / person name"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Date *</label>
              <input
                type="date"
                value={form.paid_at}
                onChange={e => setForm(f => ({ ...f, paid_at: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Payment Method</label>
              <select
                value={form.payment_method}
                onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="online">Online</option>
              </select>
            </div>
            <div className="flex items-center gap-2 self-end pb-2">
              <input
                id="tax_ded"
                type="checkbox"
                checked={form.tax_deductible}
                onChange={e => setForm(f => ({ ...f, tax_deductible: e.target.checked }))}
                className="w-4 h-4 rounded accent-primary-600"
              />
              <label htmlFor="tax_ded" className="text-sm text-gray-700">Tax deductible</label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setShowAddExpense(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleAddExpense} disabled={saving} className="btn-primary text-sm flex items-center gap-1.5">
              {saving ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</> : 'Save Expense'}
            </button>
          </div>
        </div>
      )}

      {/* YTD Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Revenue',   value: fmt(ytd.revenue),   icon: TrendingUp,  color: 'bg-blue-50 text-blue-600',   sub: `${ytd.orders} orders · Gross sales ${fmt(ytd.grossSales)}` },
          { label: 'Total Expenses',  value: fmt(ytd.expenses),  icon: TrendingDown, color: 'bg-red-50 text-red-600',    sub: `${expensesByCategory.length} categories` },
          { label: 'Net Profit',      value: fmt(ytd.profit),    icon: DollarSign,  color: ytd.profit >= 0 ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600', sub: `${profitMarginPct}% margin · Shipping ${fmt(ytd.shipping)}` },
          { label: 'VAT Collected',   value: fmt(ytd.vat),       icon: Receipt,     color: 'bg-purple-50 text-purple-600', sub: 'From delivered orders' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <p className="text-xs text-gray-500 mb-0.5">{s.label}</p>
            <p className="text-xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Monthly P&L Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900">Monthly P&amp;L</h2>
            <p className="text-xs text-gray-400 mt-0.5">Last 12 months</p>
          </div>
          {monthlyPnl.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No data yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3 text-left">Month</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3 text-right">Expenses</th>
                    <th className="px-4 py-3 text-right">Profit</th>
                    <th className="px-4 py-3 text-right">Margin</th>
                    <th className="px-4 py-3 w-6"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {monthlyPnl.map((m) => {
                    const isExpanded = expandedMonth === m.period;
                    const profit = Number(m.gross_profit || 0);
                    return (
                      <>
                        <tr
                          key={m.period}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setExpandedMonth(isExpanded ? null : m.period)}
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">{m.period}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{fmt(Number(m.revenue))}</td>
                          <td className="px-4 py-3 text-right text-red-600">{fmt(Number(m.expenses))}</td>
                          <td className={`px-4 py-3 text-right font-semibold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {fmt(profit)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 text-xs">
                            {Number(m.profit_margin_pct || 0).toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 text-gray-400">
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${m.period}-detail`} className="bg-blue-50/40">
                            <td colSpan={6} className="px-6 py-3">
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs text-gray-600">
                                <div><span className="text-gray-400 block">Orders</span>{Number(m.order_count || 0)}</div>
                                <div><span className="text-gray-400 block">Gross Sales</span>{fmt(Number(m.gross_sales))}</div>
                                <div><span className="text-gray-400 block">Commission</span>{fmt(Number(m.commission_revenue))}</div>
                                <div><span className="text-gray-400 block">Own-Store Margin</span>{fmt(Number(m.margin_revenue))}</div>
                                <div><span className="text-gray-400 block">Shipping Collected</span>{fmt(Number(m.shipping_revenue))}</div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Expense Breakdown + Recent Expenses */}
        <div className="space-y-4">

          {/* Expenses by Category (YTD) */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Expenses by Category <span className="text-xs font-normal text-gray-400">(YTD)</span></h2>
            {expensesByCategory.length === 0 ? (
              <p className="text-sm text-gray-400">No expenses yet this year</p>
            ) : (
              <div className="space-y-2.5">
                {expensesByCategory.map((c) => {
                  const totalYtdExpenses = expensesByCategory.reduce((s, x) => s + x.total_amount, 0);
                  const pct = totalYtdExpenses > 0 ? (c.total_amount / totalYtdExpenses) * 100 : 0;
                  return (
                    <div key={c.category}>
                      <div className="flex justify-between text-xs text-gray-600 mb-0.5">
                        <span className="capitalize">{c.category.replace(/_/g, ' ')}</span>
                        <span className="font-medium">{fmt(c.total_amount)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Expenses */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <h2 className="font-semibold text-gray-900 text-sm">Recent Expenses</h2>
            </div>
            <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {recentExpenses.length === 0 ? (
                <p className="text-center py-8 text-sm text-gray-400">No expenses recorded</p>
              ) : (
                recentExpenses.map((e) => (
                  <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-900 truncate">{e.description || e.subcategory || e.category}</p>
                      <p className="text-[10px] text-gray-400 capitalize">
                        {e.category} · {e.paid_at ? new Date(e.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-red-600 shrink-0">{fmt(e.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
