import { useState, useEffect, useCallback } from 'react';
import { Users, Search, Mail, Phone, ShoppingBag, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Customer {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
}

interface CustomerWithStats extends Customer {
  order_count: number;
  total_spent: number;
}

function fullName(c: Customer) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return name || '—';
}

function formatCurrency(n: number) {
  return `₦${n.toLocaleString()}`;
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);

    // Load customers
    const { data: customerRows } = await (supabase as any)
      .from('customers')
      .select('id, email, first_name, last_name, phone, created_at')
      .order('created_at', { ascending: false });

    if (!customerRows?.length) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    // Load order stats grouped by customer_email
    const emails = customerRows.map((c: Customer) => c.email).filter(Boolean);
    const { data: orderRows } = await (supabase as any)
      .from('orders')
      .select('customer_email, total_amount')
      .in('customer_email', emails)
      .eq('payment_status', 'paid');

    // Aggregate
    const statsMap: Record<string, { order_count: number; total_spent: number }> = {};
    for (const row of orderRows || []) {
      if (!row.customer_email) continue;
      if (!statsMap[row.customer_email]) statsMap[row.customer_email] = { order_count: 0, total_spent: 0 };
      statsMap[row.customer_email].order_count += 1;
      statsMap[row.customer_email].total_spent += Number(row.total_amount || 0);
    }

    setCustomers(
      customerRows.map((c: Customer) => ({
        ...c,
        order_count: statsMap[c.email]?.order_count ?? 0,
        total_spent: statsMap[c.email]?.total_spent ?? 0,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = customers.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.email?.toLowerCase().includes(q) ||
      c.first_name?.toLowerCase().includes(q) ||
      c.last_name?.toLowerCase().includes(q) ||
      c.phone?.includes(q)
    );
  });

  const totalOrders = customers.reduce((s, c) => s + c.order_count, 0);
  const totalSpent  = customers.reduce((s, c) => s + c.total_spent, 0);

  return (
    <div className="w-full max-w-none p-4 sm:p-6">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-blue-600 shrink-0" />
          <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search name, email, phone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-4">
          <p className="text-xs text-gray-500 mb-1">Total Customers</p>
          <p className="text-2xl font-bold text-gray-900">{customers.length.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-4">
          <p className="text-xs text-gray-500 mb-1">Orders Placed</p>
          <p className="text-2xl font-bold text-gray-900">{totalOrders.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-4">
          <p className="text-xs text-gray-500 mb-1">Total Revenue</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalSpent)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading customers…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {search ? 'No customers match your search' : 'No customers yet'}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Customer</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Phone</th>
                  <th className="px-4 py-3 text-center">Orders</th>
                  <th className="px-4 py-3 text-right">Total Spent</th>
                  <th className="px-4 py-3 text-right">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{fullName(c)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.email}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{c.phone || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                        c.order_count > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        <ShoppingBag className="w-3 h-3" />
                        {c.order_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 font-medium">
                      {c.total_spent > 0 ? formatCurrency(c.total_spent) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
              {filtered.length} customer{filtered.length !== 1 ? 's' : ''}
              {search ? ` matching "${search}"` : ''}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {filtered.map(c => (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 leading-tight">{fullName(c)}</p>
                    <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
                      <Mail className="w-3 h-3 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </div>
                    {c.phone && (
                      <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-400">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span>{c.phone}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                      c.order_count > 0 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      <ShoppingBag className="w-3 h-3" />
                      {c.order_count} order{c.order_count !== 1 ? 's' : ''}
                    </span>
                    {c.total_spent > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                        <TrendingUp className="w-3 h-3" />
                        {formatCurrency(c.total_spent)}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-center text-xs text-gray-400 pt-1">
              {filtered.length} customer{filtered.length !== 1 ? 's' : ''}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
