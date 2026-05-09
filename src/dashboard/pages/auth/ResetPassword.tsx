import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { supabase } from '../../contexts/AuthContext';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword]             = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                   = useState('');
  const [success, setSuccess]               = useState(false);
  const [isLoading, setIsLoading]           = useState(false);
  const [sessionReady, setSessionReady]     = useState(false);
  const [checking, setChecking]             = useState(true);

  // Ensure there is a valid session before letting the user submit.
  // The /auth/callback page exchanges the code and sets the session before
  // redirecting here, so usually getSession() returns it immediately.
  // As a fallback we also handle the legacy hash-based implicit flow.
  useEffect(() => {
    const init = async () => {
      // Legacy implicit flow: Supabase puts tokens in the URL hash
      if (window.location.hash.includes('access_token')) {
        const hashParams = new URLSearchParams(window.location.hash.replace('#', '?'));
        const accessToken  = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          window.history.replaceState({}, '', '/reset-password');
        }
      }

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSessionReady(true);
      } else {
        // No session — link was already used or never landed on /auth/callback
        setError('This link has expired or is invalid. Please request a new password reset.');
      }
      setChecking(false);
    };

    init();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setIsLoading(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (updateErr) {
      setError(updateErr.message || 'Failed to update password');
    } else {
      setSuccess(true);
      // Sign out so the user logs in fresh with the new password
      await supabase.auth.signOut();
      setTimeout(() => navigate('/login'), 2500);
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center space-y-4">
          <Loader className="w-10 h-10 text-primary-600 mx-auto animate-spin" />
          <p className="text-gray-600 font-medium">Verifying your session...</p>
        </div>
      </div>
    );
  }

  // ── Invalid / expired link ─────────────────────────────────────────────────
  if (!sessionReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-red-100 rounded-full">
            <AlertCircle className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Link Expired</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <div className="flex flex-col gap-2 pt-2">
            <a href="/forgot-password" className="btn-primary py-2 text-sm block">Request a new link</a>
            <a href="/login" className="text-sm text-gray-500 hover:text-gray-700">Back to login</a>
          </div>
        </div>
      </div>
    );
  }

  // ── Set password form ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-600 rounded-full mb-4">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Set Your Password</h1>
          <p className="text-gray-600 mt-2">Choose a strong password to secure your account</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {success ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-green-800">Password set successfully!</p>
                <p className="text-sm text-green-600 mt-0.5">Redirecting you to login...</p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">New Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full btn-primary flex items-center justify-center py-3 text-base"
              >
                {isLoading ? (
                  <><Loader className="w-5 h-5 mr-2 animate-spin" /> Saving...</>
                ) : (
                  <><Lock className="w-5 h-5 mr-2" /> Set Password</>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
