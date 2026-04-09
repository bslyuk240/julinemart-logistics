import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function SetPassword() {
  const navigate = useNavigate();
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [ready, setReady]         = useState(false);
  const [tokenType, setTokenType] = useState('');

  // Supabase puts the session tokens in the URL hash after email link click
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const access_token  = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const type          = params.get('type'); // 'invite' or 'recovery'

    if (access_token && refresh_token) {
      setTokenType(type || '');
      supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
        if (error) setError('Invalid or expired link. Request a new one from the login page.');
        else setReady(true);
      });
    } else {
      // No token — check if already signed in (e.g. user navigated here directly)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) { setReady(true); setTokenType('recovery'); }
        else setError('No valid session. Use the link from your email, or request a new password reset.');
      });
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return; }
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }
    navigate('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/logo.png" alt="JulineMart" className="h-10 object-contain mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-gray-900">
            {tokenType === 'invite' ? 'Welcome! Set Your Password' : 'Set New Password'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {tokenType === 'invite'
              ? 'Create a password to access your vendor dashboard.'
              : 'Enter your new password below.'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
          {error && !ready ? (
            <div className="text-center space-y-4">
              <p className="text-red-600 text-sm bg-red-50 rounded-xl p-4">{error}</p>
              <button onClick={() => navigate('/login')} className="btn-secondary w-full">
                Back to Login
              </button>
            </div>
          ) : ready ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Min. 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  minLength={8}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Repeat password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
              )}
              <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving…
                  </span>
                ) : tokenType === 'invite' ? 'Create Password & Enter Dashboard' : 'Update Password'}
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
