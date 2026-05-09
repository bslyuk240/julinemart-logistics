import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader, AlertCircle } from 'lucide-react';
import { supabase } from '../../contexts/AuthContext';

/**
 * Supabase sends invite and password-reset links to this route.
 * The URL contains a `code` query param (PKCE flow).
 * We exchange it for a session, then route the user to the right place.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const handle = async () => {
      const params = new URLSearchParams(window.location.search);
      const code  = params.get('code');
      const type  = params.get('type'); // 'invite' | 'recovery' | 'email_change' | null

      if (!code) {
        // Older implicit-flow links put tokens in the hash — hand off to reset-password
        if (window.location.hash.includes('access_token')) {
          navigate('/reset-password', { replace: true });
          return;
        }
        setError('Invalid or expired link. Please request a new one.');
        return;
      }

      const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);

      if (exchangeErr) {
        setError(exchangeErr.message || 'Link is invalid or has expired. Please request a new one.');
        return;
      }

      // Session is now established. Route based on link type.
      if (type === 'recovery' || type === 'invite') {
        // User needs to set/reset their password
        navigate('/reset-password', { replace: true });
      } else {
        // email_change confirmation or unknown — go to dashboard
        navigate('/admin', { replace: true });
      }
    };

    handle();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-red-100 rounded-full">
            <AlertCircle className="w-7 h-7 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Link Expired</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <div className="flex flex-col gap-2 pt-2">
            <a href="/forgot-password" className="btn-primary py-2 text-sm">Request a new reset link</a>
            <a href="/login" className="text-sm text-gray-500 hover:text-gray-700">Back to login</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center space-y-4">
        <Loader className="w-10 h-10 text-primary-600 mx-auto animate-spin" />
        <p className="text-gray-600 font-medium">Verifying your link...</p>
      </div>
    </div>
  );
}
