import { useState } from 'react';
import { Package, Search, Shield, TrendingUp, Truck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { customerBaseFromPath } from '../lib/nav';

type TrackMode = 'order' | 'shipment';

export default function MobileCustomerHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const base = customerBaseFromPath(location.pathname);

  const [trackMode, setTrackMode] = useState<TrackMode>('order');
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [phone, setPhone] = useState('');

  const trackPath = `${base}/track`.replace('//', '/');
  const shipmentPath = `${base}/track/shipment`.replace('//', '/');

  const handleTrackOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (orderNumber && email) {
      navigate(`${trackPath}?order=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`);
    }
  };

  const handleTrackShipment = (e: React.FormEvent) => {
    e.preventDefault();
    if (trackingNumber && phone) {
      navigate(
        `${shipmentPath}?tracking=${encodeURIComponent(trackingNumber)}&phone=${encodeURIComponent(phone)}`,
      );
    }
  };

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Track your delivery</h1>
        <p className="mt-1 text-sm text-gray-600">
          Enter your order or shipment details for live updates.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-4 flex rounded-lg bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setTrackMode('order')}
            className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${
              trackMode === 'order' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'
            }`}
          >
            Store order
          </button>
          <button
            type="button"
            onClick={() => setTrackMode('shipment')}
            className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${
              trackMode === 'shipment' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-600'
            }`}
          >
            Manual shipment
          </button>
        </div>

        {trackMode === 'order' ? (
          <form onSubmit={handleTrackOrder} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Order number</label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="e.g. 12345"
                className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                style={{ fontSize: '16px' }}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                style={{ fontSize: '16px' }}
                required
              />
            </div>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
            >
              <Search className="h-4 w-4" />
              Track my order
            </button>
            <p className="text-center text-xs text-gray-500">Find your order number in your confirmation email.</p>
          </form>
        ) : (
          <form onSubmit={handleTrackShipment} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Tracking number</label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="e.g. GWD026112514"
                className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                style={{ fontSize: '16px' }}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Recipient phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08012345678"
                className="w-full rounded-xl border border-gray-200 px-3.5 py-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                style={{ fontSize: '16px' }}
                required
              />
            </div>
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white"
            >
              <Search className="h-4 w-4" />
              Track my shipment
            </button>
            <p className="text-center text-xs text-gray-500">
              Use the Fez tracking number or MSH code from your waybill.
            </p>
          </form>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
          <Package className="mx-auto h-5 w-5 text-primary-600" />
          <p className="mt-2 text-[11px] font-medium text-gray-700">Live tracking</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
          <TrendingUp className="mx-auto h-5 w-5 text-primary-600" />
          <p className="mt-2 text-[11px] font-medium text-gray-700">Real-time updates</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-center">
          <Shield className="mx-auto h-5 w-5 text-primary-600" />
          <p className="mt-2 text-[11px] font-medium text-gray-700">Secure lookup</p>
        </div>
      </div>

      <div className="rounded-2xl border border-primary-100 bg-primary-50 p-4">
        <div className="flex gap-3">
          <Truck className="h-5 w-5 shrink-0 text-primary-600" />
          <div>
            <p className="text-sm font-semibold text-primary-900">Need help?</p>
            <p className="mt-0.5 text-xs text-primary-800/80">
              Call +2347075825761 or email support@julinemart.com
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
