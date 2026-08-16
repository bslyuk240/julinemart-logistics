import { Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Home() {
  const { user, riderActive, signOut } = useAuth();

  if (riderActive === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center max-w-sm mx-auto">
        <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <Clock className="w-6 h-6 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Application under review</h1>
        <p className="mt-2 text-sm text-gray-500">
          We're verifying your documents and will call your guarantor. Approval usually takes 24–48 hours.
        </p>
        <p className="mt-4 text-xs text-gray-400">{user?.email}</p>
        <button onClick={signOut} className="btn-secondary mt-8 max-w-[160px]">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-black text-gray-900">Julinemart Dispatch</h1>
      <p className="mt-2 text-sm text-gray-500">{user?.email}</p>
      <button onClick={signOut} className="btn-secondary mt-8 max-w-[160px]">
        Sign out
      </button>
    </div>
  );
}
