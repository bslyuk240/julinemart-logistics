import { useEffect, useState } from 'react';
import { AlertTriangle, Loader, RefreshCw, Truck } from 'lucide-react';
import {
  createQuotedShipment,
  fetchShippingQuoteStatus,
  requestShippingQuotes,
  type PackageOverride,
  type ShippingQuote,
  type ShippingQuotesPayload,
} from '../lib/shippingQuotesApi';

function naira(value?: number | null) {
  return `₦${Number(value || 0).toLocaleString()}`;
}

function etaLabel(quote: ShippingQuote) {
  if (quote.estimated_delivery_min_days == null && quote.estimated_delivery_max_days == null) return 'ETA unavailable';
  if (quote.estimated_delivery_min_days === quote.estimated_delivery_max_days) {
    return `${quote.estimated_delivery_min_days} working day${quote.estimated_delivery_min_days === 1 ? '' : 's'}`;
  }
  return `${quote.estimated_delivery_min_days ?? '?'}–${quote.estimated_delivery_max_days ?? '?'} working days`;
}

function providerLabel(code?: string | null) {
  if (code === 'fez') return 'FEZ';
  if (code === 'shipbubble') return 'Shipbubble';
  return code || 'Provider';
}

function formatFetchedAt(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Props = {
  subOrderId: string;
  selectedLane: string;
  getAuthHeaders: () => Promise<HeadersInit>;
  onBooked?: () => void;
  compact?: boolean;
};

export function JloShippingQuotes({ subOrderId, selectedLane, getAuthHeaders, onBooked, compact }: Props) {
  const [payload, setPayload] = useState<ShippingQuotesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [selected, setSelected] = useState<ShippingQuote | null>(null);
  const [editingPackage, setEditingPackage] = useState(false);
  const [pkg, setPkg] = useState<PackageOverride>({ weight: 0, length: 0, width: 0, height: 0 });

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const data = await fetchShippingQuoteStatus(subOrderId, headers);
      setPayload(data);
      setPkg({
        weight: data.package.weight || 0,
        length: data.package.length || 0,
        width: data.package.width || 0,
        height: data.package.height || 0,
      });
      setMissing(data.package.missing || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load JLO shipping');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedLane === 'local_rider') return;
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subOrderId, selectedLane]);

  if (selectedLane === 'local_rider') return null;

  const fetchQuotes = async (opts: { action?: 'refresh' | 'retry'; provider?: string; package_override?: PackageOverride } = {}) => {
    setBusy(true);
    setError(null);
    setSelected(null);
    try {
      const headers = await getAuthHeaders();
      const data = await requestShippingQuotes(subOrderId, headers, opts);
      setPayload(data);
      setMissing([]);
    } catch (err) {
      const maybe = err as Error & { missing?: string[]; data?: ShippingQuotesPayload };
      setError(maybe.message);
      if (maybe.missing) setMissing(maybe.missing);
      if (maybe.data) setPayload(maybe.data);
    } finally {
      setBusy(false);
      setEditingPackage(false);
    }
  };

  const confirmCreate = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      await createQuotedShipment(subOrderId, selected.id, headers);
      setSelected(null);
      await loadStatus();
      onBooked?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create shipment');
    } finally {
      setBusy(false);
    }
  };

  const booked = payload?.shipment_status === 'booked';
  const quotes = payload?.quotes || [];

  return (
    <div className={`rounded-lg border border-indigo-200 bg-indigo-50 ${compact ? 'p-3' : 'p-4'} mb-4`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 font-semibold text-indigo-950">
            <Truck className="h-4 w-4" />
            JLO Shipping
          </h4>
          <p className="mt-1 text-xs text-indigo-800">
            Customer paid {naira(payload?.customer_shipping_charge)} ·{' '}
            {booked ? 'Shipment booked' : 'Not booked'}
          </p>
        </div>
      </div>

      {payload && (
        <div className={`mb-3 grid gap-2 text-xs text-indigo-900 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <p>
            <span className="font-semibold">Origin:</span> {payload.origin.name} · {payload.origin.city}
          </p>
          <p>
            <span className="font-semibold">Destination:</span> {payload.destination.city}, {payload.destination.state}
          </p>
          <p>
            <span className="font-semibold">Package:</span>{' '}
            {payload.package.weight || '—'}kg · {payload.package.length || '—'} × {payload.package.width || '—'} × {payload.package.height || '—'} cm
          </p>
        </div>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-indigo-800">
          <Loader className="h-4 w-4 animate-spin" /> Loading shipping details…
        </p>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            {missing.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {missing.map((item) => <li key={item}>{item}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {booked && payload && (
        <div className="mb-3 rounded-md border border-indigo-200 bg-white p-3 text-sm">
          <p className="font-semibold text-gray-900">Shipment created</p>
          <p className="mt-1 text-gray-700">JLO Tracking: <span className="font-mono">{payload.tracking_number}</span></p>
          <p className="text-gray-700">Courier: {payload.fulfilment_courier_name} via {providerLabel(payload.fulfilment_provider)}</p>
          <p className="text-gray-700">Cost: {naira(payload.carrier_cost)} · Margin: {naira(payload.shipping_margin)}</p>
        </div>
      )}

      {editingPackage && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-indigo-200 bg-white p-3">
          {(['weight', 'length', 'width', 'height'] as const).map((field) => (
            <label key={field} className="text-xs text-gray-700">
              <span className="mb-1 block font-semibold capitalize">{field}{field === 'weight' ? ' (kg)' : ' (cm)'}</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={pkg[field] || ''}
                onChange={(e) => setPkg((prev) => ({ ...prev, [field]: Number(e.target.value) }))}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </label>
          ))}
        </div>
      )}

      {selected && (
        <div className="mb-3 rounded-md border border-indigo-300 bg-white p-3 text-sm">
          <p className="font-semibold text-gray-900">Confirm shipping provider</p>
          <p className="mt-1 text-gray-700">Courier: {selected.courier}</p>
          <p className="text-gray-700">Provider: {providerLabel(selected.provider)}</p>
          <p className="text-gray-700">Cost: {naira(selected.amount)}</p>
          <p className="text-gray-700">Estimated delivery: {etaLabel(selected)}</p>
          <p className="text-gray-700">Customer shipping charge: {naira(payload?.customer_shipping_charge)}</p>
          <p className="font-medium text-gray-900">Estimated margin: {naira(selected.shipping_margin)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setSelected(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary text-sm" onClick={confirmCreate} disabled={busy}>
              {busy ? 'Creating…' : 'Create shipment'}
            </button>
          </div>
        </div>
      )}

      {!booked && quotes.length > 0 && !selected && (
        <div className="mb-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
            {quotes.length} shipping option{quotes.length === 1 ? '' : 's'} found
          </p>
          {quotes.map((quote) => (
            <div key={quote.id} className="rounded-md border border-indigo-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{quote.courier}</p>
                  <p className="text-xs text-gray-600">
                    via {providerLabel(quote.provider)} · {quote.service_name} · {etaLabel(quote)}
                    {quote.pickup_available ? ' · Pickup available' : ''}
                  </p>
                  <p className="mt-1 text-sm text-gray-800">Cost {naira(quote.amount)}</p>
                  <p className={`text-sm font-medium ${quote.shipping_margin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    Estimated JLO margin {naira(quote.shipping_margin)}
                  </p>
                </div>
                <button type="button" className="btn-primary shrink-0 text-sm" onClick={() => setSelected(quote)} disabled={busy}>
                  Select
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(payload?.providers || []).some((p) => !p.ok) && (
        <div className="mb-3 space-y-1 text-xs text-amber-900">
          {payload?.providers.filter((p) => !p.ok).map((p) => (
            <div key={p.provider} className="flex items-center justify-between gap-2">
              <span>{providerLabel(p.provider)} rates unavailable. {p.error}</span>
              <button
                type="button"
                className="text-indigo-800 underline"
                onClick={() => fetchQuotes({ action: 'retry', provider: p.provider })}
                disabled={busy}
              >
                Retry failed provider
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!booked && (
          <button
            type="button"
            className="btn-primary flex items-center gap-2 text-sm"
            onClick={() => fetchQuotes({
              action: 'refresh',
              package_override: editingPackage ? pkg : undefined,
            })}
            disabled={busy}
          >
            {busy ? <Loader className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {quotes.length > 0 ? 'Refresh quotes' : 'Get shipping quotes'}
          </button>
        )}
        {!booked && (
          <button
            type="button"
            className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-sm text-indigo-900"
            onClick={() => setEditingPackage((v) => !v)}
          >
            Edit package details
          </button>
        )}
        {payload?.quotes_requested_at && (
          <span className="text-xs text-indigo-800">
            Quotes fetched: {formatFetchedAt(payload.quotes_requested_at)}
          </span>
        )}
      </div>
    </div>
  );
}
