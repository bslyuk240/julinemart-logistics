import { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type ActiveRider = {
  id: string;
  full_name: string;
  phone: string;
  vehicle_type: string;
  vehicle_plate: string;
  is_online: boolean;
  approved_vendor_locations?: { city: string; state: string } | null;
};

type RiderPickerProps = {
  value: string;
  onChange: (riderId: string) => void;
};

export default function RiderPicker({ value, onChange }: RiderPickerProps) {
  const [riders, setRiders] = useState<ActiveRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${functionsBase}/admin-rider-verifications?status=active`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || 'Failed to load riders');
        if (!cancelled) {
          const sorted = [...(payload.data || [])].sort((a, b) => Number(b.is_online) - Number(a.is_online));
          setRiders(sorted);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load riders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="w-full px-3 py-2 border rounded flex items-center gap-2 text-sm text-gray-500">
        <Loader className="w-4 h-4 animate-spin" /> Loading active riders…
      </div>
    );
  }

  if (error) {
    return <div className="w-full px-3 py-2 border rounded text-sm text-red-600">{error}</div>;
  }

  if (riders.length === 0) {
    return (
      <div className="w-full px-3 py-2 border rounded text-sm text-gray-500 bg-gray-50">
        No active riders yet — approve one in Rider Verifications first.
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border rounded"
    >
      <option value="">Select a rider</option>
      {riders.map((r) => (
        <option key={r.id} value={r.id}>
          {r.is_online ? '🟢 ' : '⚪ '}
          {r.full_name} — {r.vehicle_type}
          {r.vehicle_plate ? ` (${r.vehicle_plate})` : ''}
          {r.approved_vendor_locations ? ` · ${r.approved_vendor_locations.city}` : ''}
        </option>
      ))}
    </select>
  );
}

export type { ActiveRider };
