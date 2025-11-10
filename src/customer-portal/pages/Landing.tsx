import { useState } from 'react';
import { Search, Package, TrendingUp, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../shared/BrandLogo';

export function CustomerPortalLanding() {
  const navigate = useNavigate();
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');

  const handleTrackOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (orderNumber && email) {
      navigate(`/track?order=${encodeURIComponent(orderNumber)}&email=${encodeURIComponent(email)}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <BrandLogo withText size={28} textClassName="text-2xl font-bold text-primary-600" />
            <nav className="flex gap-6">
              <a href="#track" className="text-gray-600 hover:text-primary-600">Track Order</a>
              <a href="#estimate" className="text-gray-600 hover:text-primary-600">Shipping Estimate</a>
              <a href="#contact" className="text-gray-600 hover:text-primary-600">Contact</a>
            </nav>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Track Your Order in Real-Time
          </h2>
          <p className="text-xl text-gray-600">
            Enter your order number and email to see live tracking updates
          </p>
        </div>

        {/* Tracking Form */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <form onSubmit={handleTrackOrder} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Order Number
                </label>
                <input
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="e.g., 12345"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full bg-primary-600 text-white py-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
              >
                <Search className="w-5 h-5" />
                Track My Order
              </button>
            </form>

            <p className="text-sm text-gray-500 mt-4 text-center">
              You'll find your order number in your confirmation email
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <Package className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Real-Time Tracking</h3>
            <p className="text-gray-600">
              See exactly where your package is at every step of the journey
            </p>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
              <TrendingUp className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Multi-Hub Logistics</h3>
            <p className="text-gray-600">
              Orders fulfilled from multiple warehouses for faster delivery
            </p>
          </div>

          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
              <Shield className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Secure & Reliable</h3>
            <p className="text-gray-600">
              Your orders are handled by trusted courier partners nationwide
            </p>
          </div>
        </div>
      </section>

      {/* Delivery Timeline */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h3 className="text-3xl font-bold text-center mb-12">Typical Delivery Timeline</h3>
          
          <div className="max-w-3xl mx-auto">
            <div className="space-y-8">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                  1
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Order Confirmed</h4>
                  <p className="text-gray-600">Your order is received and being prepared</p>
                  <p className="text-sm text-gray-500">Usually within 1 hour</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                  2
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Processing</h4>
                  <p className="text-gray-600">Items are being packed at our fulfillment center</p>
                  <p className="text-sm text-gray-500">1-2 business days</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-primary-600 text-white rounded-full flex items-center justify-center font-bold">
                  3
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">In Transit</h4>
                  <p className="text-gray-600">Your package is on its way with our courier partner</p>
                  <p className="text-sm text-gray-500">2-5 business days</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                  ✓
                </div>
                <div>
                  <h4 className="font-semibold text-lg mb-1">Delivered</h4>
                  <p className="text-gray-600">Package successfully delivered to your address</p>
                  <p className="text-sm text-gray-500">You'll receive a confirmation</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <h3 className="text-xl font-bold mb-4">JulineMart</h3>
              <p className="text-gray-400">
                Fast, reliable delivery across Nigeria
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Quick Links</h4>
              <ul className="space-y-2 text-gray-400">
                <li><a href="#track" className="hover:text-white">Track Order</a></li>
                <li><a href="#estimate" className="hover:text-white">Shipping Rates</a></li>
                <li><a href="#contact" className="hover:text-white">Contact Us</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-gray-400">
                <li>Email: support@julinemart.com</li>
                <li>Phone: +234 800 000 0000</li>
                <li>Hours: Mon-Sat 9AM-6PM</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center text-gray-400">
            <p>&copy; 2025 JulineMart. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
