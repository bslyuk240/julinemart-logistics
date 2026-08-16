import { useAuth } from '../contexts/AuthContext';

export default function Home() {
  const { user, riderActive, signOut } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-black text-gray-900">Julinemart Dispatch</h1>
      <p className="mt-2 text-sm text-gray-500">{user?.email}</p>
      {riderActive === false && (
        <p className="mt-1 text-xs text-amber-600">Your application isn't approved yet.</p>
      )}
      <button onClick={signOut} className="btn-secondary mt-8 max-w-[160px]">
        Sign out
      </button>
    </div>
  );
}
