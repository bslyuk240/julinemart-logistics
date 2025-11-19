const ATTENDANCE_STATS = [
  {
    name: 'Warehouse A',
    onTime: 32,
    late: 2,
    absent: 1,
  },
  {
    name: 'Distribution Center B',
    onTime: 26,
    late: 1,
    absent: 0,
  },
  {
    name: 'Fulfillment Hub C',
    onTime: 19,
    late: 3,
    absent: 2,
  },
];

export function ManagerAttendance() {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm uppercase tracking-wide text-primary-600">Attendance</p>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Team Presence Snapshot</h1>
        <p className="text-gray-600 mt-3">
          View on-time ratios, late arrivals, and absences for each hub to keep operations running safely.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="grid grid-cols-4 bg-gray-50 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span>Hub</span>
          <span className="text-center">On Time</span>
          <span className="text-center">Late</span>
          <span className="text-center">Absent</span>
        </div>
        {ATTENDANCE_STATS.map((row) => (
          <div key={row.name} className="grid grid-cols-4 px-6 py-4 border-t border-gray-100 items-center">
            <span className="text-sm font-medium text-gray-800">{row.name}</span>
            <span className="text-center text-gray-700">{row.onTime}</span>
            <span className="text-center text-gray-700">{row.late}</span>
            <span className="text-center text-gray-700">{row.absent}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
