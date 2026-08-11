import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, MapPin, Package, ShieldCheck, Truck } from 'lucide-react';
import { ReturnMethodCard } from '../../../components/ReturnMethodCard';
import { customerBaseFromPath } from '../lib/nav';
import {
  createReturnShipment,
  defaultReturnContact,
  fallbackReturnHub,
  returnConfirmationPath,
  saveReturnConfirmation,
  type ReturnContactInfo,
  type ReturnLocationState,
  type ReturnMethod,
} from '../lib/returns';

const inputCls =
  'mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100';

export default function MobileReturnMethod() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const base = customerBaseFromPath(location.pathname);
  const homePath = base || '/';

  const locationState = (location.state as ReturnLocationState) || {};

  const [selectedMethod, setSelectedMethod] = useState<ReturnMethod | null>(locationState.method || null);
  const [customerInfo, setCustomerInfo] = useState<ReturnContactInfo>(
    locationState.customer || defaultReturnContact,
  );
  const [hubInfo, setHubInfo] = useState<ReturnContactInfo>(locationState.hub || fallbackReturnHub);
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

  const canSubmit = useMemo(
    () =>
      Boolean(
        selectedMethod &&
          customerInfo.name &&
          customerInfo.phone &&
          customerInfo.address &&
          customerInfo.city &&
          customerInfo.state &&
          hubInfo.name &&
          hubInfo.address &&
          hubInfo.city &&
          hubInfo.state,
      ),
    [selectedMethod, customerInfo, hubInfo],
  );

  const updateCustomer = (field: keyof ReturnContactInfo, value: string) => {
    setCustomerInfo((prev) => ({ ...prev, [field]: value }));
  };

  const updateHub = (field: keyof ReturnContactInfo, value: string) => {
    setHubInfo((prev) => ({ ...prev, [field]: value }));
  };

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
      const result = await createReturnShipment({
        returnRequestId: id,
        method: selectedMethod,
        customer: customerInfo,
        hub: hubInfo,
      });

      const payload = {
        return_code: result.return_code,
        fez_tracking: result.fez_tracking || null,
        method: selectedMethod,
        customer: customerInfo,
        hub: hubInfo,
      };

      saveReturnConfirmation(id, payload);

      navigate(returnConfirmationPath(base, id), {
        replace: true,
        state: payload,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create return shipment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pb-28">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={() => navigate(homePath)} aria-label="Back" className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">Return shipment</p>
          <p className="truncate text-[11px] text-gray-400">Choose pickup or drop-off</p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-600">Return shipment</p>
          <h1 className="mt-1 text-lg font-bold text-gray-900">How will you send items back?</h1>
          <p className="mt-1 text-sm text-gray-600">
            Pickup by a Fez rider or drop-off at a Fez location. We will generate a return code for updates.
          </p>
        </div>

        <div className="space-y-3">
          <ReturnMethodCard
            title="Request pickup"
            description="A Fez rider collects the package from your address."
            icon={Truck}
            selected={selectedMethod === 'pickup'}
            onClick={() => setSelectedMethod('pickup')}
            helperText="Includes live tracking once created."
          />
          <ReturnMethodCard
            title="Drop off at Fez"
            description="Take the package to a Fez location with your return code."
            icon={MapPin}
            selected={selectedMethod === 'dropoff'}
            onClick={() => setSelectedMethod('dropoff')}
            helperText="Present the return code at the counter."
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">Pickup details</h2>
          </div>
          <p className="mt-1 text-xs text-gray-600">Confirm the address and contact for this return.</p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Customer name</label>
              <input
                value={customerInfo.name}
                onChange={(e) => updateCustomer('name', e.target.value)}
                className={inputCls}
                style={{ fontSize: '16px' }}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <input
                value={customerInfo.phone}
                onChange={(e) => updateCustomer('phone', e.target.value)}
                className={inputCls}
                style={{ fontSize: '16px' }}
                placeholder="08012345678"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Address</label>
              <input
                value={customerInfo.address}
                onChange={(e) => updateCustomer('address', e.target.value)}
                className={inputCls}
                style={{ fontSize: '16px' }}
                placeholder="Street address"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">City</label>
                <input
                  value={customerInfo.city}
                  onChange={(e) => updateCustomer('city', e.target.value)}
                  className={inputCls}
                  style={{ fontSize: '16px' }}
                  placeholder="City"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">State</label>
                <input
                  value={customerInfo.state}
                  onChange={(e) => updateCustomer('state', e.target.value)}
                  className={inputCls}
                  style={{ fontSize: '16px' }}
                  placeholder="State"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary-600" />
            <h2 className="text-sm font-semibold text-gray-900">Hub contact</h2>
          </div>
          <p className="mt-1 text-xs text-gray-600">Origin hub for the return shipment.</p>

          <div className="mt-4 space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Hub name</label>
              <input
                value={hubInfo.name}
                onChange={(e) => updateHub('name', e.target.value)}
                className={inputCls}
                style={{ fontSize: '16px' }}
                placeholder="Warri Hub"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Phone</label>
              <input
                value={hubInfo.phone}
                onChange={(e) => updateHub('phone', e.target.value)}
                className={inputCls}
                style={{ fontSize: '16px' }}
                placeholder="Hub phone"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Address</label>
              <input
                value={hubInfo.address}
                onChange={(e) => updateHub('address', e.target.value)}
                className={inputCls}
                style={{ fontSize: '16px' }}
                placeholder="Hub address"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">City</label>
                <input
                  value={hubInfo.city}
                  onChange={(e) => updateHub('city', e.target.value)}
                  className={inputCls}
                  style={{ fontSize: '16px' }}
                  placeholder="City"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">State</label>
                <input
                  value={hubInfo.state}
                  onChange={(e) => updateHub('state', e.target.value)}
                  className={inputCls}
                  style={{ fontSize: '16px' }}
                  placeholder="State"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-primary-100 bg-primary-50 p-4">
          <div className="flex items-start gap-2 text-sm text-primary-900">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Keep your phone reachable. Fez riders may call to confirm pickup details.</p>
          </div>
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white px-4 py-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <button
          type="button"
          onClick={handleContinue}
          disabled={loading || !selectedMethod}
          className="w-full rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {loading ? 'Creating return shipment…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
