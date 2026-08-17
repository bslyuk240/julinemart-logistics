import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function SignUp() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;

      if (data.session) {
        navigate('/apply', { replace: true });
      } else {
        setNotice('Account created — check your email to confirm it, then sign in to continue your application.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center px-6 py-12 max-w-sm mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-gray-900">
          Become a<br />
          <span className="text-primary-600">Dispatch rider</span>
        </h1>
        <p className="mt-2 text-sm text-gray-500">Create your account, then complete a short application.</p>
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
          <input
            id="password"
            type="password"
            required
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="field-label flex items-center gap-1.5" htmlFor="confirm">
            <Lock className="w-3.5 h-3.5" /> Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            placeholder="Re-enter your password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field-input"
            autoComplete="new-password"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-green-600">{notice}</p>}

        <button type="submit" className="btn-primary bg-gradient-to-r from-primary-600 to-primary-700" disabled={submitting}>
          {submitting ? 'Creating account…' : (
            <>
              Continue
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already applied?{' '}
        <Link to="/login" className="font-semibold text-primary-600">Sign in</Link>
      </p>
    </div>
  );
}
