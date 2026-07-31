import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader, Mail, Phone, Search, ShoppingBag } from 'lucide-react';
import { supabase } from '../../contexts/AuthContext';
import { PullToRefresh } from '../PullToRefresh';
import { SectionLabel } from '../components/MobileDetailParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { formatNaira } from '../lib/displayUtils';

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
  return name || 'Customer';
}

export default function MobileCustomers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<CustomerWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data: filteredRows } = await (supabase as any).rpc('get_storefront_customers');

    if (!filteredRows?.length) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    const emails = filteredRows.map((c: Customer) => c.email).filter(Boolean);
    const { data: orderRows } = await (supabase as any)
      .from('orders')
      .select('customer_email, total_amount')
      .in('customer_email', emails)
      .eq('payment_status', 'paid');

    const statsMap: Record<string, { order_count: number; total_spent: number }> = {};
    for (const row of orderRows || []) {
      if (!row.customer_email) continue;
      if (!statsMap[row.customer_email]) statsMap[row.customer_email] = { order_count: 0, total_spent: 0 };
      statsMap[row.customer_email].order_count += 1;
      statsMap[row.customer_email].total_spent += Number(row.total_amount || 0);
    }

    setCustomers(
      filteredRows.map((c: Customer) => ({
        ...c,
        order_count: statsMap[c.email]?.order_count ?? 0,
        total_spent: statsMap[c.email]?.total_spent ?? 0,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(
      (c) =>
        c.email?.toLowerCase().includes(q) ||
        c.first_name?.toLowerCase().includes(q) ||
        c.last_name?.toLowerCase().includes(q) ||
        (c.phone || '').includes(q),
    );
  }, [customers, search]);

  return (
    <PullToRefresh onRefresh={load}>
      <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Customers</h1>
          <p className="text-xs text-gray-500">Quick lookup during support calls</p>
        </div>

        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-gray-100">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, phone…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
            style={{ fontSize: '16px' }}
          />
        </div>

        <SectionLabel>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''}
        </SectionLabel>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl bg-white p-4 text-center text-sm text-gray-500 ring-1 ring-gray-100">
            {search ? 'No customers match your search' : 'No customers yet'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c) => (
              <div key={c.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-gray-100">
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{fullName(c)}</p>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{c.email}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                      <ShoppingBag className="h-3 w-3" />
                      {c.order_count}
                    </span>
                  </div>
                  {c.total_spent > 0 && (
                    <p className="mt-1 text-xs font-medium text-green-700">{formatNaira(c.total_spent)} lifetime</p>
                  )}
                </div>
                <div className="flex border-t border-gray-100">
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-primary-600 active:bg-gray-50"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call
                    </a>
                  )}
                  <a
                    href={`mailto:${c.email}`}
                    className="flex flex-1 items-center justify-center gap-1.5 border-l border-gray-100 py-2.5 text-xs font-semibold text-primary-600 active:bg-gray-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Email
                  </a>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/orders?search=${encodeURIComponent(c.email)}`)}
                    className="flex flex-1 items-center justify-center gap-1 border-l border-gray-100 py-2.5 text-xs font-semibold text-gray-700 active:bg-gray-50"
                  >
                    Orders
                    <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
