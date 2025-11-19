const PERFORMANCE_METRICS = [
  { label: 'Successful Deliveries', value: '98.2%' },
  { label: 'Average Courier Rating', value: '4.8 / 5' },
  { label: 'Average Delivery Time', value: '2.4 days' },
];

export function ManagerPerformance() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-wide text-primary-600">Performance</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">KPI Overview</h1>
        <p className="text-gray-600 mt-3">
          Keep your eyes on the trends that matter for the JulineMart courier network.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {PERFORMANCE_METRICS.map((metric) => (
          <div key={metric.label} className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <p className="text-sm uppercase tracking-wider text-gray-500">{metric.label}</p>
            <p className="text-3xl font-semibold text-gray-900 mt-3">{metric.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
