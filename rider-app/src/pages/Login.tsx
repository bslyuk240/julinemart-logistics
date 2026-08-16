import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Enter your email above first, then tap "Forgot password?"');
      return;
    }
    setSendingReset(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (resetError) throw resetError;
      setNotice('Password reset link sent — check your email.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset link');
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="relative overflow-hidden bg-primary-50">
        <img
          src="/rider-hero.png"
          alt=""
          aria-hidden="true"
          className="w-full h-[190px] object-cover motion-safe:animate-hero-float"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-gray-50 via-transparent to-transparent" />
        <img
          src="/logo.png"
          alt="JulineMart"
          className="absolute left-6 bottom-3 w-14 h-14 rounded-full shadow-md ring-4 ring-white"
        />
      </div>

      <div className="flex-1 px-6 pt-6 pb-10 max-w-sm w-full mx-auto">
        <div className="mb-7">
          <h1 className="text-3xl font-black tracking-tight text-gray-900">
            Julinemart<br />
            <span className="text-primary-600">Dispatch</span>
          </h1>
          <p className="mt-2 text-sm text-gray-500">For approved riders only.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="field-label flex items-center gap-1.5" htmlFor="email">
              <Mail className="w-3.5 h-3.5" /> Email
            </label>
            <input
              id="email"
              type="email"
              required
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="field-label flex items-center gap-1.5" htmlFor="password">
              <Lock className="w-3.5 h-3.5" /> Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field-input pr-11"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
              </button>
            </div>
            <div className="mt-2 text-right">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={sendingReset}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50"
              >
                {sendingReset ? 'Sending…' : 'Forgot password?'}
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-green-600">{notice}</p>}

          <button
            type="submit"
            className="btn-primary bg-gradient-to-r from-primary-600 to-primary-700 shadow-lg shadow-primary-600/25"
            disabled={submitting}
          >
            {submitting ? 'Signing in…' : (
              <>
                Sign in
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 flex items-center justify-center gap-2.5 text-center">
          <ShieldCheck className="w-8 h-8 text-primary-600 shrink-0" />
          <div className="text-left">
            <p className="text-xs font-semibold text-gray-900">Secure rider access</p>
            <p className="text-xs text-gray-500">Your data is protected and encrypted</p>
          </div>
        </div>
      </div>
    </div>
  );
}
