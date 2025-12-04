import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, ExternalLink, MapPin, Package, Truck } from 'lucide-react';
import { BrandLogo } from '../../../shared/BrandLogo';

type Method = 'pickup' | 'dropoff';

type ContactInfo = {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
};

type ConfirmationState = {
  return_code?: string;
  fez_tracking?: string | null;
  method?: Method;
  customer?: ContactInfo;
  hub?: ContactInfo;
};

export function ReturnConfirmationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(
    (location.state as ConfirmationState) || null
  );

  useEffect(() => {
    if (confirmation) return;
    if (!id) return;

    const stored = sessionStorage.getItem(`return-confirmation-${id}`);
    if (stored) {
      try {
        setConfirmation(JSON.parse(stored));
      } catch {
        // ignore parse errors
      }
    }
  }, [confirmation, id]);

  const trackingLink = useMemo(() => {
    if (!confirmation?.fez_tracking) return null;
    const tracking = confirmation.fez_tracking;
    return `https://web.fezdelivery.co/track-delivery?tracking=${tracking}`;
  }, [confirmation?.fez_tracking]);

  if (!confirmation?.return_code || !confirmation?.method) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50">
        <header className="bg-white shadow-sm">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <BrandLogo withText size={28} textClassName="text-2xl font-bold text-primary-600" />
            <button
              onClick={() => navigate('/customer')}
              className="flex items-center gap-2 text-gray-600 hover:text-primary-600"
            >
              <ArrowLeft className="h-5 w-5" />
              Back to Home
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-12 text-center sm:px-6 lg:px-8">
          <h1 className="text-2xl font-semibold text-gray-900">Return details not found</h1>
          <p className="mt-2 text-gray-600">Please start the return process again.</p>
          <div className="mt-6 flex justify-center gap-3">
            {id ? (
              <button
                onClick={() => navigate(`/customer/return/${id}/method`)}
                className="rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700"
              >
                Go to return options
              </button>
            ) : null}
            <button
              onClick={() => navigate('/customer')}
              className="rounded-lg border border-gray-200 px-4 py-2 text-gray-700 hover:border-primary-200"
            >
              Home
            </button>
          </div>
        </main>
      </div>
    );
  }

  const isPickup = confirmation.method === 'pickup';

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <BrandLogo withText size={28} textClassName="text-2xl font-bold text-primary-600" />
          <button
            onClick={() => navigate('/customer')}
            className="flex items-center gap-2 text-gray-600 hover:text-primary-600"
          >
            <ArrowLeft className="h-5 w-5" />
            Back to Home
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary-700">
          <CheckCircle className="h-5 w-5" />
          Return shipment created
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-500">Return code</p>
                  <p className="text-3xl font-bold text-gray-900">{confirmation.return_code}</p>
                  <p className="mt-2 text-sm text-gray-600">
                    Share this code with the Fez rider or the drop-off desk.
                  </p>
                </div>
                <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
                  {isPickup ? 'Fez pickup' : 'Fez drop-off'}
                </span>
              </div>

              {isPickup ? (
                <div className="mt-4 rounded-lg bg-primary-50 p-4 text-sm text-primary-900">
                  <div className="flex items-start gap-2">
                    <Truck className="mt-0.5 h-5 w-5" />
                    <div>
                      <p className="font-semibold">We booked your pickup.</p>
                      <p>Keep your phone available; the rider may call to confirm.</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-5 w-5" />
                    <div>
                      <p className="font-semibold">Drop-off instructions</p>
                      <p>Take your package to the Fez location and present the return code.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-gray-900">Packaging tips</h3>
              </div>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-gray-700">
                <li>Place all items and accessories in one sealed package.</li>
                <li>Include the return code inside the box for quick verification.</li>
                <li>Remove old shipping labels or barcodes to avoid delays.</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            {confirmation.fez_tracking ? (
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2">
                  <ExternalLink className="h-5 w-5 text-primary-600" />
                  <h3 className="text-lg font-semibold text-gray-900">Tracking</h3>
                </div>
                <p className="mt-2 text-sm text-gray-700">
                  Tracking number: <span className="font-semibold">{confirmation.fez_tracking}</span>
                </p>
                {trackingLink ? (
                  <a
                    href={trackingLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 text-primary-700 hover:text-primary-800"
                  >
                    View on Fez
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-gray-900">
                  {isPickup ? 'Pickup address' : 'Drop-off hub'}
                </h3>
              </div>
              <div className="mt-2 space-y-1 text-sm text-gray-700">
                <p className="font-semibold">{isPickup ? confirmation.customer?.name : confirmation.hub?.name}</p>
                <p>{isPickup ? confirmation.customer?.address : confirmation.hub?.address}</p>
                <p>
                  {(isPickup ? confirmation.customer?.city : confirmation.hub?.city)},{' '}
                  {(isPickup ? confirmation.customer?.state : confirmation.hub?.state)}
                </p>
                {isPickup && confirmation.customer?.phone ? (
                  <p className="text-gray-600">Phone: {confirmation.customer.phone}</p>
                ) : null}
                {!isPickup && confirmation.hub?.phone ? (
                  <p className="text-gray-600">Hub phone: {confirmation.hub.phone}</p>
                ) : null}
              </div>
            </div>

            <button
              onClick={() => navigate('/customer')}
              className="w-full rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-primary-700 hover:border-primary-200 hover:bg-primary-100"
            >
              Back to Home
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
