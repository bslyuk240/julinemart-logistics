import { BrandLogo } from '../../shared/BrandLogo';

export function CustomerContactPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-4">
          <BrandLogo withText size={32} textClassName="text-2xl font-bold text-primary-600" />
          <p className="text-gray-600">
            Need a hand? Our logistics experts are on standby to help you track orders, calculate shipping, or answer general questions.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-200">
          <p className="text-sm uppercase tracking-wide text-primary-600 text-center">Contact</p>
          <h1 className="text-3xl font-bold text-gray-900 text-center mt-2">We’re here to help</h1>
          <p className="text-center text-gray-600 mt-3">
            Reach out through any of the channels below and we’ll respond within one business day.
          </p>

          <div className="mt-8 grid gap-6 sm:grid-cols-3">
            <div className="border border-gray-100 rounded-2xl p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Email</p>
              <p className="text-lg font-semibold text-gray-900">support@julinemart.com</p>
            </div>
            <div className="border border-gray-100 rounded-2xl p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Phone</p>
              <p className="text-lg font-semibold text-gray-900">+234 800 000 0000</p>
            </div>
            <div className="border border-gray-100 rounded-2xl p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Hours</p>
              <p className="text-lg font-semibold text-gray-900">Mon–Sat · 9AM–6PM</p>
            </div>
          </div>
        </div>

        <section className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Talk to the JulineMart logistics team</h2>
          <p className="text-gray-600 mb-6">
            Whether you’re awaiting a shipment, planning a pickup, or want to escalate a concern, we route every message to the right courier operations squad.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-gray-500">Customer Care</p>
              <p className="text-lg font-semibold text-primary-600">care@julinemart.com</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Operations Hotline</p>
              <p className="text-lg font-semibold text-primary-600">+234 700 000 0000</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
