import { Package, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../contexts/AuthContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

interface ManualShipmentListItem {
  id: string;
  shipment_code: string;
  recipient: { name: string } | null;
  status: string;
  tracking_number: string | null;
  waybill_number: string | null;
  created_at: string;
}

const STATUS_FILTERS = ['all', 'pending', 'assigned', 'in_transit', 'delivered'];

export function ManualShipmentsPage() {
  const navigate = useNavigate();
  const notification = useNotification();
  const [shipments, setShipments] = useState<ManualShipmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchShipments = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter });
      const response = await fetch(`${functionsBase}/manual-shipments?${params}`, { headers: await authHeader() });
      const data = await response.json();
      if (data.success) setShipments(data.data || []);
      else notification.error('Failed to Load', data.error || 'Unable to fetch manual shipments');
    } catch (error) {
      console.error('Error fetching manual shipments:', error);
      notification.error('Failed to Load', 'Unable to fetch manual shipments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShipments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filtered = shipments.filter((s) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      s.shipment_code.toLowerCase().includes(term) ||
      (s.recipient?.name || '').toLowerCase().includes(term) ||
      (s.tracking_number || '').toLowerCase().includes(term)
    );
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Manual Shipments</h1>
          <p className="text-gray-600 mt-2">Ad-hoc waybills not tied to any customer order</p>
        </div>
        <button onClick={() => navigate('/admin/manual-shipments/create')} className="btn-primary flex items-center">
          <Plus className="w-4 h-4 mr-2" />
          New Manual Shipment
        </button>
      </div>

      <div className="card mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, recipient, or tracking number"
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex gap-2">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                  statusFilter === status ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {status.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No manual shipments found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="pb-2">Code</th>
                <th className="pb-2">Recipient</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Tracking</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/admin/manual-shipments/${s.id}`)}
                  className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="py-2 font-mono font-medium">{s.shipment_code}</td>
                  <td className="py-2">{s.recipient?.name || '—'}</td>
                  <td className="py-2 capitalize">{s.status}</td>
                  <td className="py-2 font-mono text-xs">{s.tracking_number || '—'}</td>
                  <td className="py-2 text-gray-500">{new Date(s.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
