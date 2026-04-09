import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export default function Login() {
  const { signIn } = useAuth();
  const navigate   = useNavigate();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const [showForgot, setShowForgot]   = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent]   = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setForgotSent(true);
    setForgotLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel — brand ── */}
      <div className="hidden lg:flex lg:w-1/2 brand-gradient flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] rounded-full bg-white/5" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] rounded-full bg-white/[0.03]" />

        <div className="relative z-10 text-center">
          <img src="/logo.png" alt="JulineMart" className="h-14 object-contain mx-auto mb-8" />
          <h1 className="text-4xl font-bold text-white mb-4 leading-tight">
            Your Store.<br />Your Terms.
          </h1>
          <p className="text-primary-200 text-lg max-w-sm mx-auto leading-relaxed">
            Manage your products, track orders, and grow your business — all in one place.
          </p>

          <div className="mt-12 grid grid-cols-3 gap-6 text-center">
            {[
              { val: '10K+', label: 'Customers' },
              { val: '99.9%', label: 'Uptime' },
              { val: '24h',  label: 'Payouts' },
            ].map(s => (
              <div key={s.label} className="bg-white/10 rounded-2xl px-4 py-4">
                <p className="text-2xl font-bold text-white">{s.val}</p>
                <p className="text-primary-200 text-xs mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <img src="/logo.png" alt="JulineMart" className="h-10 object-contain mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Vendor Portal</p>
          </div>

          <div className="bg-white rounded-2xl shadow-card border border-gray-100 p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
            <p className="text-gray-500 text-sm mb-7">Sign in to your vendor dashboard</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input"
                  placeholder="you@example.com"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="input"
                  placeholder="••••••••"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-red-200 text-red-700 flex items-center justify-center text-xs font-bold flex-shrink-0">!</span>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : 'Sign In'}
              </button>
            </form>

            {!showForgot ? (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => { setShowForgot(true); setForgotEmail(email); }}
                  className="text-sm text-primary-600 hover:underline"
                >
                  Forgot or never set your password?
                </button>
              </div>
            ) : forgotSent ? (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 text-center text-sm text-green-700">
                Check your email — a password reset link has been sent to <strong>{forgotEmail}</strong>.
                <br />
                <button type="button" onClick={() => { setShowForgot(false); setForgotSent(false); }} className="text-green-600 underline mt-2 text-xs">Back to login</button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-600 font-medium">Reset / Set your password</p>
                <input
                  type="email"
                  className="input"
                  placeholder="Enter your email"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  required
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowForgot(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                  <button type="submit" disabled={forgotLoading} className="btn-primary flex-1 text-sm">
                    {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                  </button>
                </div>
              </form>
            )}

            <div className="mt-6 pt-6 border-t border-gray-100 text-center space-y-3">
              <p className="text-sm text-gray-600">
                Want to sell on JulineMart?{' '}
                <Link to="/register" className="text-primary-600 font-semibold hover:text-primary-700 hover:underline">
                  Apply to become a vendor →
                </Link>
              </p>
              <p className="text-xs text-gray-400">
                Need help?{' '}
                <a href="mailto:support@julinemart.com" className="text-primary-500 hover:underline">
                  Contact support
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
