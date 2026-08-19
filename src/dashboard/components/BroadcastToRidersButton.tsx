import { useState } from 'react';
import { Radio, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

type Props = {
  manualShipmentId?: string;
  subOrderId?: string;
  status: string;
  onChanged: () => void;
  disabled?: boolean;
  /** Stretch to the width of its container — mobile card layouts want this, desktop inline button rows don't. */
  fullWidth?: boolean;
};

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/**
 * Alternative to RiderPicker's hand-pick-one-rider flow: offers the job to
 * every online, active rider covering the pickup town instead. Shared
 * between desktop and mobile — same component, same two endpoints, only
 * the surrounding page differs.
 */
export default function BroadcastToRidersButton({ manualShipmentId, subOrderId, status, onChanged, disabled, fullWidth }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = manualShipmentId ? 'manual-shipment-broadcast-rider' : 'broadcast-rider';
  const bodyKey = manualShipmentId ? 'shipment_id' : 'sub_order_id';
  const bodyValue = manualShipmentId || subOrderId;

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${functionsBase}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ [bodyKey]: bodyValue, ...payload }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Request failed');
      onChanged();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startBroadcast = async () => {
    const result = await call({});
    if (result) {
      const n = result.riders_notified ?? 0;
      setError(n === 0 ? 'Broadcast started, but no online riders currently cover this area' : null);
    }
  };

  const cancelBroadcast = () => call({ cancel: true });

  if (status === 'broadcasting') {
    return (
      <div className={`flex items-center gap-2 ${fullWidth ? 'w-full justify-center rounded-lg border border-blue-200 bg-blue-50/60 py-2' : ''}`}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
          <Radio className="w-3.5 h-3.5 animate-pulse" />
          Broadcasting to riders…
        </span>
        <button
          type="button"
          onClick={cancelBroadcast}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-red-600 disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
          Cancel
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${fullWidth ? 'w-full' : ''}`}>
      <button
        type="button"
        onClick={startBroadcast}
        disabled={busy || disabled}
        className={`btn-secondary flex items-center disabled:opacity-50 ${fullWidth ? 'w-full justify-center' : ''}`}
      >
        <Radio className="w-4 h-4 mr-2" />
        {busy ? 'Broadcasting…' : 'Broadcast to Online Riders'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
