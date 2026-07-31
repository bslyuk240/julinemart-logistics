import { supabase } from '../../contexts/AuthContext';

// ─── Types (mirror desktop Finance.tsx) ─────────────────────────────────────

export interface MonthlyPnl {
  period: string;
  revenue: number;
  commission_revenue: number;
  margin_revenue: number;
  shipping_revenue: number;
  gross_sales: number;
  expenses: number;
  refund_amount: number;
  refund_count: number;
  gross_profit: number;
  profit_margin_pct: number;
  vat_collected: number;
  order_count: number;
}

export interface ReturnStats {
  total_refunded: number;
  refund_count: number;
  pending_debits: number;
  pending_debit_count: number;
  recovered_debits: number;
  waived_debits: number;
}

export interface ExpenseCategory {
  category: string;
  total_amount: number;
  transaction_count: number;
}

export interface RecentExpense {
  id: string;
  category: string;
  subcategory: string;
  description: string;
  amount: number;
  paid_to: string;
  paid_at: string;
  payment_method: string;
}

export interface AddExpenseForm {
  category: string;
  subcategory: string;
  description: string;
  amount: string;
  paid_to: string;
  paid_at: string;
  payment_method: string;
  tax_deductible: boolean;
}

export interface PendingPayment {
  courier_id: string;
  courier_name: string;
  courier_code: string;
  pending_shipments: number;
  total_amount_due: number;
  approved_amount: number;
  oldest_shipment: string | null;
  newest_shipment: string | null;
}

export interface Settlement {
  id: string;
  courier_id: string;
  courier_name: string;
  settlement_period_start: string;
  settlement_period_end: string;
  total_shipments: number;
  total_amount_due: number;
  total_amount_paid: number;
  status: string;
  payment_date: string;
  payment_reference: string;
  paid_by_name: string;
  created_at: string;
}

export interface SubOrderRow {
  id: string;
  main_order_id: string;
  status: string;
  delivered_at: string | null;
  updated_at: string | null;
  allocated_shipping_fee: number | null;
  real_shipping_cost: number | null;
  courier_charge: number | null;
  orders: { order_number: string } | null;
}

export interface SettlementItem {
  id: string;
  amount: number;
  sub_order_id: string;
  sub_orders: SubOrderRow | null;
}

export const EXPENSE_CATEGORIES: Record<string, string[]> = {
  courier: ['delivery_fees', 'fuel', 'vehicle_maintenance'],
  marketing: ['ads', 'influencer', 'content', 'print'],
  platform: ['netlify', 'supabase', 'domain', 'software'],
  staff: ['salary', 'bonus', 'training'],
  operations: ['office', 'packaging', 'utilities', 'insurance'],
  sourcing: ['cj_import', 'customs', 'freight'],
  other: ['miscellaneous'],
};

export const fmtFinance = (n: number | null | undefined) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;

export function computeYtdTotals(monthlyPnl: MonthlyPnl[]) {
  const currentYear = new Date().getFullYear().toString();
  return monthlyPnl
    .filter((m) => m.period?.startsWith(currentYear))
    .reduce(
      (acc, m) => ({
        revenue: acc.revenue + Number(m.revenue || 0),
        expenses: acc.expenses + Number(m.expenses || 0),
        profit: acc.profit + Number(m.gross_profit || 0),
        commission: acc.commission + Number(m.commission_revenue || 0),
        margin: acc.margin + Number(m.margin_revenue || 0),
        shipping: acc.shipping + Number(m.shipping_revenue || 0),
        grossSales: acc.grossSales + Number(m.gross_sales || 0),
        vat: acc.vat + Number(m.vat_collected || 0),
        orders: acc.orders + Number(m.order_count || 0),
        refunds: acc.refunds + Number(m.refund_amount || 0),
      }),
      {
        revenue: 0,
        expenses: 0,
        profit: 0,
        commission: 0,
        margin: 0,
        shipping: 0,
        grossSales: 0,
        vat: 0,
        orders: 0,
        refunds: 0,
      },
    );
}

function settlementsUrls(path: string): string[] {
  if (path.startsWith('/api/')) {
    const urls = [path];
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
      urls.push(`http://localhost:8888${path}`);
    }
    return urls;
  }
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  const full = `/api/settlements${suffix}`;
  const urls = [full];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${full}`);
  }
  return urls;
}

export async function settlementsApi<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    ...(init?.headers || {}),
  };

  let lastError: Error | null = null;
  for (let i = 0; i < settlementsUrls(path).length; i += 1) {
    const url = settlementsUrls(path)[i];
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.status === 404 && i < settlementsUrls(path).length - 1) continue;
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Invalid response (${res.status})`);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
      if (i < settlementsUrls(path).length - 1) continue;
    }
  }
  throw lastError || new Error('Request failed');
}

export async function loadFinanceDashboard() {
  const ytdStart = new Date(new Date().getFullYear(), 0, 1).toISOString();

  const [pnlRes, catRes, expRes, refundRes, debitRes] = await Promise.all([
    supabase.from('monthly_pnl_view').select('*').limit(12),
    supabase.from('ledger_expenses').select('category, amount').gte('paid_at', ytdStart),
    supabase
      .from('ledger_expenses')
      .select('id, category, subcategory, description, amount, paid_to, paid_at, payment_method')
      .order('paid_at', { ascending: false })
      .limit(20),
    supabase
      .from('return_requests')
      .select('refund_amount, refund_status')
      .eq('refund_status', 'completed')
      .gte('refund_completed_at', ytdStart),
    supabase.from('vendor_return_debits').select('amount, status'),
  ]);

  const monthlyPnl = (pnlRes.data || []) as MonthlyPnl[];

  const refunds = refundRes.data || [];
  const debits = debitRes.data || [];
  const returnStats: ReturnStats = {
    total_refunded: refunds.reduce((s, r) => s + Number(r.refund_amount || 0), 0),
    refund_count: refunds.length,
    pending_debits: debits.filter((d) => d.status === 'pending').reduce((s, d) => s + Number(d.amount), 0),
    pending_debit_count: debits.filter((d) => d.status === 'pending').length,
    recovered_debits: debits
      .filter((d) => ['deducted', 'paid_back'].includes(d.status))
      .reduce((s, d) => s + Number(d.amount), 0),
    waived_debits: debits.filter((d) => d.status === 'waived').reduce((s, d) => s + Number(d.amount), 0),
  };

  const catMap: Record<string, { total: number; count: number }> = {};
  for (const row of catRes.data || []) {
    const c = row.category || 'other';
    if (!catMap[c]) catMap[c] = { total: 0, count: 0 };
    catMap[c].total += Number(row.amount);
    catMap[c].count += 1;
  }
  const expensesByCategory: ExpenseCategory[] = Object.entries(catMap)
    .map(([category, v]) => ({ category, total_amount: v.total, transaction_count: v.count }))
    .sort((a, b) => b.total_amount - a.total_amount);

  return {
    monthlyPnl,
    expensesByCategory,
    recentExpenses: (expRes.data || []) as RecentExpense[],
    returnStats,
  };
}

export async function addLedgerExpense(form: AddExpenseForm) {
  const amount = parseFloat(form.amount);
  const d = new Date(form.paid_at);
  const { error } = await supabase.from('ledger_expenses').insert({
    source: 'manual',
    category: form.category,
    subcategory: form.subcategory || null,
    description: form.description,
    amount,
    currency: 'NGN',
    tax_deductible: form.tax_deductible,
    vat_amount: 0,
    payment_method: form.payment_method,
    paid_to: form.paid_to || null,
    paid_at: new Date(form.paid_at).toISOString(),
    fiscal_year: d.getFullYear(),
    fiscal_month: d.getMonth() + 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return amount;
}

export async function loadUnsettledSubOrders(courierId: string): Promise<SubOrderRow[]> {
  const { data, error } = await supabase
    .from('sub_orders')
    .select('id, main_order_id, status, delivered_at, updated_at, allocated_shipping_fee, real_shipping_cost, courier_charge, orders(order_number)')
    .eq('courier_id', courierId)
    .eq('status', 'delivered')
    .not('settlement_status', 'in', '("paid","settled")')
    .order('delivered_at', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as SubOrderRow[];
}

export async function saveSubOrderCosts(updates: { id: string; cost: number }[]) {
  await Promise.all(
    updates.map(({ id, cost }) =>
      supabase.from('sub_orders').update({ real_shipping_cost: cost, updated_at: new Date().toISOString() }).eq('id', id),
    ),
  );
}

export async function loadSettlementItems(settlementId: string): Promise<SettlementItem[]> {
  const { data, error } = await supabase
    .from('settlement_items')
    .select(
      'id, amount, sub_order_id, sub_orders(id, main_order_id, status, delivered_at, updated_at, allocated_shipping_fee, real_shipping_cost, courier_charge, orders(order_number))',
    )
    .eq('settlement_id', settlementId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as unknown as SettlementItem[];
}

export function orderLabel(row: SubOrderRow): string {
  return row.orders?.order_number ? `#${row.orders.order_number}` : `${row.main_order_id.slice(0, 8)}…`;
}

export function plValue(charged: number, cost: number) {
  return charged - cost;
}
