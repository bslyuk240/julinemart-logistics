import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  ExternalLink,
  MapPin,
  Package,
  Truck,
} from 'lucide-react';
import { customerBaseFromPath } from '../lib/nav';
import {
  loadReturnConfirmation,
  returnMethodPath,
  type ReturnConfirmationState,
} from '../lib/returns';

export default function MobileReturnConfirmation() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const base = customerBaseFromPath(location.pathname);
  const homePath = base || '/';

  const [confirmation, setConfirmation] = useState<ReturnConfirmationState | null>(
    (location.state as ReturnConfirmationState) || null,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (confirmation || !id) return;
    setConfirmation(loadReturnConfirmation(id));
  }, [confirmation, id]);

  const trackingLink = useMemo(() => {
    if (!confirmation?.fez_tracking) return null;
    return `https://web.fezdelivery.co/track-delivery?tracking=${confirmation.fez_tracking}`;
  }, [confirmation?.fez_tracking]);

  const copyReturnCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  if (!confirmation?.return_code || !confirmation?.method) {
    return (
      <div className="p-4">
        <button
          type="button"
          onClick={() => navigate(homePath)}
          className="mb-4 flex items-center gap-2 text-sm text-gray-600"
        >
          <ArrowLeft className="h-5 w-5" />
          Back
        </button>
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-lg font-semibold text-gray-900">Return details not found</p>
          <p className="mt-2 text-sm text-gray-600">Please start the return process again.</p>
          <div className="mt-5 space-y-2">
            {id ? (
              <button
                type="button"
                onClick={() => navigate(returnMethodPath(base, id))}
                className="w-full rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
              >
                Go to return options
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => navigate(homePath)}
              className="w-full rounded-xl border border-gray-200 py-3.5 text-sm font-semibold text-gray-700"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isPickup = confirmation.method === 'pickup';

  return (
    <div className="pb-6">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={() => navigate(homePath)} aria-label="Back" className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-primary-700">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Return created
          </p>
          <p className="truncate text-[11px] text-gray-400">{isPickup ? 'Fez pickup' : 'Fez drop-off'}</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Return code</p>
              <p className="mt-1 break-all text-2xl font-bold text-gray-900">{confirmation.return_code}</p>
              <p className="mt-2 text-xs text-gray-600">Share with the Fez rider or drop-off desk.</p>
            </div>
            <button
              type="button"
              onClick={() => copyReturnCode(confirmation.return_code!)}
              aria-label="Copy return code"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          {copied && <p className="mt-2 text-xs text-green-600">Copied to clipboard</p>}

          {isPickup ? (
            <div className="mt-4 rounded-xl bg-primary-50 p-3 text-sm text-primary-900">
              <div className="flex items-start gap-2">
                <Truck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Pickup booked</p>
                  <p className="mt-0.5 text-xs">Keep your phone available; the rider may call to confirm.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Drop-off instructions</p>
                  <p className="mt-0.5 text-xs">Take your package to the Fez location and present the return code.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {confirmation.fez_tracking ? (
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-primary-600" />
              <h2 className="text-sm font-semibold text-gray-900">Tracking</h2>
            </div>
            <p className="mt-2 font-mono text-sm text-gray-900">{confirmation.fez_tracking}</p>
            {trackingLink ? (
              <a
                href={trackingLink}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 py-3 text-sm font-semibold text-primary-700"
              >
                View on Fez
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">
              {isPickup ? 'Pickup address' : 'Drop-off hub'}
            </h2>
          </div>
          <div className="mt-2 space-y-0.5 text-sm text-gray-700">
            <p className="font-semibold">{isPickup ? confirmation.customer?.name : confirmation.hub?.name}</p>
            <p>{isPickup ? confirmation.customer?.address : confirmation.hub?.address}</p>
            <p>
              {(isPickup ? confirmation.customer?.city : confirmation.hub?.city)},{' '}
              {(isPickup ? confirmation.customer?.state : confirmation.hub?.state)}
            </p>
            {isPickup && confirmation.customer?.phone ? (
              <p className="text-gray-500">Phone: {confirmation.customer.phone}</p>
            ) : null}
            {!isPickup && confirmation.hub?.phone ? (
              <p className="text-gray-500">Hub phone: {confirmation.hub.phone}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">Packaging tips</h2>
          </div>
          <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs text-gray-700">
            <li>Place all items and accessories in one sealed package.</li>
            <li>Include the return code inside the box for quick verification.</li>
            <li>Remove old shipping labels or barcodes to avoid delays.</li>
          </ul>
        </div>

        <button
          type="button"
          onClick={() => navigate(homePath)}
          className="w-full rounded-xl border border-primary-100 bg-primary-50 py-3.5 text-sm font-semibold text-primary-700"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
