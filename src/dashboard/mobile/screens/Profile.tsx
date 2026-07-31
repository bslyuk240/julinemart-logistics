import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader, Lock, Mail } from 'lucide-react';
import { useAuth, supabase } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { DetailRow, SectionLabel } from '../components/MobileDetailParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MobileProfile() {
  const navigate = useNavigate();
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

  if (!user) return null;

  const initial = user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase();

  const saveName = async (event: FormEvent) => {
    event.preventDefault();
    setSavingName(true);
    try {
      const { error } = await supabase.from('users').update({ full_name: fullName.trim() || null }).eq('id', user.id);
      if (error) throw error;
      notification.success('Saved', 'Display name updated');
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
      notification.success('Updated', 'Password changed');
    }
  };

  const sendResetLink = async () => {
    setSendingReset(true);
    const { error } = await resetPassword(user.email);
    setSendingReset(false);
    if (error) {
      notification.error('Email failed', error.message || 'Could not send reset link');
    } else {
      notification.success('Email sent', `Reset link sent to ${user.email}`);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-gray-50">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2.5 border-b border-gray-100 bg-white px-3 py-2.5">
        <button type="button" onClick={() => navigate(-1)} className="shrink-0 text-gray-500">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-semibold text-gray-900">Profile</h1>
      </div>

      <div className="flex-1 pb-4" style={{ paddingBottom: TABBAR_SPACE }}>
        <div className="border-b border-gray-100 bg-white px-4 py-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-2xl font-semibold text-white">
            {initial}
          </div>
          <p className="mt-3 text-lg font-bold text-gray-900">{user.full_name || 'Staff user'}</p>
          <p className="text-sm text-gray-500">{user.email}</p>
          <span className="mt-2 inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase text-gray-600">
            {formatRole(user.role)}
          </span>
        </div>

        <SectionLabel>Account</SectionLabel>
        <div className="mx-4 overflow-hidden rounded-xl bg-white">
          <DetailRow label="Email" value={user.email} />
          <DetailRow label="Role" value={formatRole(user.role)} />
        </div>

        <SectionLabel>Display name</SectionLabel>
        <form onSubmit={saveName} className="mx-4 space-y-3 overflow-hidden rounded-xl bg-white p-4">
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <button
            type="submit"
            disabled={savingName}
            className="w-full rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {savingName ? 'Saving…' : 'Save name'}
          </button>
        </form>

        <SectionLabel>Change password</SectionLabel>
        <form onSubmit={changePassword} className="mx-4 space-y-3 overflow-hidden rounded-xl bg-white p-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <button
            type="submit"
            disabled={changingPassword || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {changingPassword ? <Loader className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Update password
          </button>
        </form>

        <SectionLabel>Reset via email</SectionLabel>
        <div className="mx-4 overflow-hidden rounded-xl bg-white p-4">
          <p className="text-sm text-gray-600">Prefer a link in your inbox? We can email you a password reset link.</p>
          <button
            type="button"
            onClick={sendResetLink}
            disabled={sendingReset}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-3 text-sm font-semibold text-gray-900 disabled:opacity-60"
          >
            {sendingReset ? <Loader className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send reset link
          </button>
        </div>
      </div>
    </div>
  );
}
