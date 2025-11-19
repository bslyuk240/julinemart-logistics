export function ManagerHome() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-wide text-primary-600">Manager Hub</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Operational Command Center</h1>
        <p className="text-gray-600 mt-3">
          Monitor attendance, performance, and key logistics signals across all fulfillment hubs in one place.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-6">
        {[
          { title: 'Active Hubs', value: '14', desc: 'Hubs currently processing orders' },
          { title: 'Live Deliveries', value: '328', desc: 'Shipments in transit right now' },
          { title: 'Alerts', value: '3', desc: 'Escalations needing manager review' },
        ].map((card) => (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6" key={card.title}>
            <p className="text-xs uppercase tracking-wider text-gray-500">{card.title}</p>
            <p className="text-4xl font-semibold mt-2 text-gray-900">{card.value}</p>
            <p className="text-sm text-gray-500 mt-1">{card.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
