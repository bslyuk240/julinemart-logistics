import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { functionsAuthHeader, functionsBase } from '../lib/functionsAuth';
import { statusLabel, statusStyle, timeAgo } from '../lib/displayUtils';

interface ManualShipmentListItem {
  id: string;
  shipment_code: string;
  recipient: { name: string } | null;
  status: string;
  tracking_number: string | null;
  waybill_number: string | null;
  created_at: string;
}

const STATUS_FILTERS = ['all', 'pending', 'assigned', 'in_transit', 'delivered'] as const;

export default function MobileManualShipments() {
  const notification = useNotification();
  const [shipments, setShipments] = useState<ManualShipmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');

  const fetchShipments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      const response = await fetch(`${functionsBase}/manual-shipments?${params}`, { headers: await functionsAuthHeader() });
      const data = await response.json();
      if (data.success) setShipments(data.data || []);
      else notification.error('Failed to Load', data.error || 'Unable to fetch manual shipments');
    } catch {
      notification.error('Failed to Load', 'Unable to fetch manual shipments');
    } finally {
      setLoading(false);
    }
  }, [notification, statusFilter]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const filtered = useMemo(() => {
    if (!search.trim()) return shipments;
    const q = search.toLowerCase();
    return shipments.filter(
      (s) =>
        s.shipment_code.toLowerCase().includes(q) ||
        (s.recipient?.name || '').toLowerCase().includes(q) ||
        (s.tracking_number || '').toLowerCase().includes(q),
    );
  }, [shipments, search]);

  const counts = useMemo(() => {
    return {
      all: shipments.length,
      pending: shipments.filter((s) => s.status === 'pending').length,
      assigned: shipments.filter((s) => s.status === 'assigned').length,
      in_transit: shipments.filter((s) => s.status === 'in_transit').length,
      delivered: shipments.filter((s) => s.status === 'delivered').length,
    };
  }, [shipments]);

  return (
    <PullToRefresh onRefresh={fetchShipments}>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Manual Shipments</h1>
            <p className="text-xs text-gray-500">Ad-hoc waybills not tied to orders</p>
          </div>
          <Link
            to="/admin/manual-shipments/create"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white"
            aria-label="New shipment"
          >
            <Plus className="h-5 w-5" />
          </Link>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Code, recipient, tracking…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
            style={{ fontSize: '16px' }}
          />
        </div>

        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
          {STATUS_FILTERS.map((key) => {
            const active = statusFilter === key;
            const count = counts[key];
            if (key !== 'all' && count === 0) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`whitespace-nowrap rounded-full border px-3 py-2 text-[11px] font-medium capitalize ${
                  active ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-gray-600'
                }`}
              >
                {key.replace('_', ' ')} {count}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="h-20 animate-pulse rounded-lg bg-gray-100" />
            <div className="h-20 animate-pulse rounded-lg bg-gray-100" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">No manual shipments found.</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <Link
                key={s.id}
                to={`/admin/manual-shipments/${s.id}`}
                className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[13px] font-bold text-gray-900">{s.shipment_code}</div>
                    <div className="mt-0.5 text-sm font-medium text-gray-900">{s.recipient?.name || '—'}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle(s.status)}`}>
                    {statusLabel(s.status)}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {[s.tracking_number, timeAgo(s.created_at)].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
