import { Link } from 'react-router-dom';

export function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-md text-center bg-white border border-gray-200 rounded-2xl shadow-lg p-10 space-y-4">
        <h1 className="text-4xl font-bold text-gray-900">Access Denied</h1>
        <p className="text-gray-600">
          You do not have permission to view this area. Please sign in with the appropriate account or return to the public portal.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            to="/login"
            className="px-4 py-2 rounded-full bg-primary-600 text-white font-semibold hover:bg-primary-700 transition-colors"
          >
            Login
          </Link>
          <Link
            to="/customer"
            className="px-4 py-2 rounded-full border border-primary-600 text-primary-600 font-semibold hover:bg-primary-50 transition-colors"
          >
            Back to Portal
          </Link>
        </div>
      </div>
    </div>
  );
}
