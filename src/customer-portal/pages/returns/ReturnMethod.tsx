import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Package, ShieldCheck, Truck, CheckCircle } from 'lucide-react';
import { BrandLogo } from '../../../shared/BrandLogo';
import { ReturnMethodCard } from '../../../components/ReturnMethodCard';

type Method = 'pickup' | 'dropoff';

type ContactInfo = {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
};

type LocationState = {
  customer?: ContactInfo;
  hub?: ContactInfo;
  method?: Method;
};

const defaultContact: ContactInfo = {
  name: '',
  phone: '',
  address: '',
  city: '',
  state: '',
};

const fallbackHub: ContactInfo = {
  name: 'Warri Hub',
  phone: '',
  address: '',
  city: 'Warri',
  state: 'Delta',
};

export function ReturnMethodPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as LocationState) || {};
  const apiBase = import.meta.env.VITE_API_BASE_URL || '';

  const [selectedMethod, setSelectedMethod] = useState<Method | null>(locationState.method || null);
  const [customerInfo, setCustomerInfo] = useState<ContactInfo>(locationState.customer || defaultContact);
  const [hubInfo, setHubInfo] = useState<ContactInfo>(locationState.hub || fallbackHub);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (locationState.customer) {
      setCustomerInfo((prev) => ({ ...prev, ...locationState.customer }));
    }
    if (locationState.hub) {
      setHubInfo((prev) => ({ ...prev, ...locationState.hub }));
    }
    if (locationState.method) {
      setSelectedMethod(locationState.method);
    }
  }, [locationState.customer, locationState.hub, locationState.method]);

  const canSubmit = useMemo(() => {
    return Boolean(
      selectedMethod &&
      customerInfo.name &&
      customerInfo.phone &&
      customerInfo.address &&
      customerInfo.city &&
      customerInfo.state &&
      hubInfo.name &&
      hubInfo.address &&
      hubInfo.city &&
      hubInfo.state
    );
  }, [selectedMethod, customerInfo, hubInfo]);

  const handleContinue = async () => {
    if (!id) {
      setError('Missing return request id');
      return;
    }
    if (!selectedMethod) {
      setError('Choose a return method to continue');
      return;
    }
    if (!canSubmit) {
      setError('Please confirm customer and hub details');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${apiBase}/api/create-return-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          return_request_id: id,
          method: selectedMethod,
          customer: customerInfo,
          hub: hubInfo,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Unable to start return shipment');
      }

      const payload = {
        return_code: data.return_code,
        fez_tracking: data.fez_tracking || null,
        method: selectedMethod,
        customer: customerInfo,
        hub: hubInfo,
      };

      sessionStorage.setItem(`return-confirmation-${id}`, JSON.stringify(payload));

      navigate(`/customer/return/${id}/confirmation`, {
        replace: true,
        state: payload,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create return shipment');
    } finally {
      setLoading(false);
    }
  };

  const updateCustomer = (field: keyof ContactInfo, value: string) => {
    setCustomerInfo((prev) => ({ ...prev, [field]: value }));
  };

  const updateHub = (field: keyof ContactInfo, value: string) => {
    setHubInfo((prev) => ({ ...prev, [field]: value }));
  };

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

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary-600">
            Return Shipment
          </p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">
            Choose how you want to send back your items
          </h1>
          <p className="mt-2 text-gray-600">
            Select pickup by a Fez rider or drop-off at a Fez location. We will generate a return code to keep you updated.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <ReturnMethodCard
              title="Request Pickup (Fez Rider)"
              description="A Fez rider will come to your address to collect the package."
              icon={Truck}
              selected={selectedMethod === 'pickup'}
              onClick={() => setSelectedMethod('pickup')}
              helperText="Includes live tracking once created."
            />
            <ReturnMethodCard
              title="Drop off at Fez Location"
              description="Take the package to the nearest Fez drop-off location using the return code."
              icon={MapPin}
              selected={selectedMethod === 'dropoff'}
              onClick={() => setSelectedMethod('dropoff')}
              helperText="Use the return code at the hub counter."
            />

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-gray-900">Pickup details</h3>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                Confirm the address and contact we should use for this return.
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-700">Customer name</label>
                  <input
                    value={customerInfo.name}
                    onChange={(e) => updateCustomer('name', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="Customer full name"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Phone</label>
                  <input
                    value={customerInfo.phone}
                    onChange={(e) => updateCustomer('phone', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="e.g. 08012345678"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Address</label>
                  <input
                    value={customerInfo.address}
                    onChange={(e) => updateCustomer('address', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="Street address"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">City</label>
                  <input
                    value={customerInfo.city}
                    onChange={(e) => updateCustomer('city', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="City"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">State</label>
                  <input
                    value={customerInfo.state}
                    onChange={(e) => updateCustomer('state', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="State"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-gray-900">Hub contact</h3>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                We will use this hub as the origin for the return shipment.
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-700">Hub name</label>
                  <input
                    value={hubInfo.name}
                    onChange={(e) => updateHub('name', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="e.g. Warri Hub"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Phone</label>
                  <input
                    value={hubInfo.phone}
                    onChange={(e) => updateHub('phone', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="Hub contact phone"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-700">Address</label>
                  <input
                    value={hubInfo.address}
                    onChange={(e) => updateHub('address', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="Hub address"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">City</label>
                  <input
                    value={hubInfo.city}
                    onChange={(e) => updateHub('city', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="City"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">State</label>
                  <input
                    value={hubInfo.state}
                    onChange={(e) => updateHub('state', e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
                    placeholder="State"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-gray-900">What happens next?</h3>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-gray-700">
                <li>1) Select pickup or drop-off.</li>
                <li>2) We generate a return code and (for pickup) create a Fez shipment.</li>
                <li>3) Track the shipment with Fez if pickup is chosen.</li>
              </ul>
              <div className="mt-4 rounded-lg bg-primary-50 p-3 text-sm text-primary-800">
                <div className="flex items-start gap-2">
                  <CheckCircle className="mt-0.5 h-4 w-4" />
                  <p>
                    Keep your phone reachable. Fez riders may call to confirm pickup details.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleContinue}
              disabled={loading || !selectedMethod}
              className="w-full rounded-xl bg-primary-600 px-4 py-3 text-white shadow hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {loading ? 'Creating return shipment...' : 'Continue'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
