import { Mail, Phone } from 'lucide-react';

export default function MobileCustomerContact() {
  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Contact us</h1>
        <p className="mt-1 text-sm text-gray-600">
          Our logistics team can help with tracking, shipping, and general questions.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-primary-600">Get in touch</p>
        <p className="mt-2 text-center text-sm text-gray-600">We respond within one business day.</p>

        <div className="mt-5 space-y-3">
          <a
            href="mailto:support@julinemart.com"
            className="flex items-center gap-3 rounded-xl border border-gray-100 p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50">
              <Mail className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Customer support</p>
              <p className="text-sm font-semibold text-gray-900">support@julinemart.com</p>
            </div>
          </a>

          <a
            href="mailto:admin@julinemart.com"
            className="flex items-center gap-3 rounded-xl border border-gray-100 p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
              <Mail className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Operations</p>
              <p className="text-sm font-semibold text-gray-900">admin@julinemart.com</p>
            </div>
          </a>

          <a href="tel:+2347075825761" className="flex items-center gap-3 rounded-xl border border-gray-100 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50">
              <Phone className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Phone</p>
              <p className="text-sm font-semibold text-gray-900">+2347075825761</p>
            </div>
          </a>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm font-semibold text-gray-900">Talk to the logistics team</p>
        <p className="mt-1 text-xs text-gray-600">
          Whether you are awaiting a shipment or need to escalate a concern, we route every message to the right
          operations squad.
        </p>
      </div>
    </div>
  );
}
