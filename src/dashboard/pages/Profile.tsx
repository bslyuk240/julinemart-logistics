import { FormEvent, useEffect, useState } from 'react';
import { Loader, Lock, Mail, User } from 'lucide-react';
import { useAuth, supabase } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ProfilePage() {
  const { user, updatePassword, resetPassword } = useAuth();
  const notification = useNotification();

  const [fullName, setFullName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    setFullName(user?.full_name || '');
  }, [user?.full_name]);

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setSavingName(true);
    try {
      const { error } = await supabase.from('users').update({ full_name: fullName.trim() || null }).eq('id', user.id);
      if (error) throw error;
      notification.success('Profile updated', 'Your display name has been saved.');
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Could not update profile');
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      notification.error('Mismatch', 'Passwords do not match');
      return;
    }
    if (password.length < 6) {
      notification.error('Too short', 'Password must be at least 6 characters');
      return;
    }
    setChangingPassword(true);
    const { error } = await updatePassword(password);
    setChangingPassword(false);
    if (error) {
      notification.error('Update failed', error.message || 'Could not change password');
    } else {
      setPassword('');
      setConfirmPassword('');
      notification.success('Password updated', 'Your password has been changed.');
    }
  };

  const sendResetLink = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    const { error } = await resetPassword(user.email);
    setSendingReset(false);
    if (error) {
      notification.error('Email failed', error.message || 'Could not send reset link');
    } else {
      notification.success('Email sent', `A reset link was sent to ${user.email}`);
    }
  };

  if (!user) return null;

  const initial = user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your account details and password.</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-xl font-semibold text-white">
            {initial}
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{user.full_name || 'Staff user'}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
            <span className="mt-1 inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
              {formatRole(user.role)}
            </span>
          </div>
        </div>
      </div>

      <form onSubmit={saveName} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <User className="h-4 w-4" />
          Display name
        </h2>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Your full name"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="submit"
          disabled={savingName}
          className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {savingName ? 'Saving…' : 'Save name'}
        </button>
      </form>

      <form onSubmit={changePassword} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Lock className="h-4 w-4" />
          Change password
        </h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary-500"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary-500"
        />
        <button
          type="submit"
          disabled={changingPassword || !password}
          className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {changingPassword ? 'Updating…' : 'Update password'}
        </button>
      </form>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <Mail className="h-4 w-4" />
          Password reset email
        </h2>
        <p className="mt-1 text-sm text-gray-500">Send a reset link to your email if you prefer to set a new password from there.</p>
        <button
          type="button"
          onClick={sendResetLink}
          disabled={sendingReset}
          className="mt-4 flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-900 disabled:opacity-60"
        >
          {sendingReset && <Loader className="h-4 w-4 animate-spin" />}
          Send reset link
        </button>
      </div>
    </div>
  );
}
