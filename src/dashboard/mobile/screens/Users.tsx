import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Eye,
  EyeOff,
  Loader,
  Mail,
  Plus,
  Search,
  Trash2,
  Users as UsersIcon,
} from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { SectionLabel } from '../components/MobileDetailParts';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import {
  deleteUser,
  emptyUserForm,
  fetchRoles,
  fetchUsers,
  formatRole,
  roleBadgeClass,
  saveUser,
  sendPasswordReset,
  updateUser,
  userFormFromRow,
  type RoleRow,
  type UserFormData,
  type UserRow,
} from '../lib/peopleApi';

const inputCls =
  'w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-base text-gray-900 outline-none focus:border-primary-500 focus:bg-white';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

export default function MobileUsers() {
  const notification = useNotification();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<UserFormData>(emptyUserForm());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersData, rolesData] = await Promise.all([fetchUsers(), fetchRoles()]);
      setRows(usersData);
      setRoles(rolesData);
    } catch {
      notification.error('Load failed', 'Unable to fetch users');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((u) => {
      if (!showInactive && !u.is_active) return false;
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        (u.full_name || '').toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [rows, search, showInactive]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyUserForm());
    setFormOpen(true);
    setSelected(null);
  };

  const openEdit = (user: UserRow) => {
    setEditing(user);
    setForm(userFormFromRow(user));
    setFormOpen(true);
    setSelected(null);
  };

  const submit = async () => {
    if (!editing && !form.email.trim()) {
      notification.error('Missing email', 'Email is required for new users');
      return;
    }
    setSaving(true);
    try {
      await saveUser(editing?.id || null, form);
      notification.success(
        editing ? 'User updated' : 'Invitation sent',
        editing ? form.full_name || form.email : 'User will set their password via invite email',
      );
      setFormOpen(false);
      setEditing(null);
      load();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Could not save user');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: UserRow) => {
    try {
      await updateUser(user.id, { is_active: !user.is_active });
      notification.success(user.is_active ? 'Deactivated' : 'Activated', user.email);
      setSelected(null);
      load();
    } catch (err) {
      notification.error('Update failed', err instanceof Error ? err.message : 'Could not update status');
    }
  };

  const toggleCatalog = async (user: UserRow) => {
    try {
      await updateUser(user.id, { catalog_access: !user.catalog_access });
      notification.success(
        user.catalog_access ? 'Catalog access removed' : 'Catalog access granted',
        user.email,
      );
      setSelected((prev) => (prev?.id === user.id ? { ...prev, catalog_access: !user.catalog_access } : prev));
      load();
    } catch (err) {
      notification.error('Update failed', err instanceof Error ? err.message : 'Could not update catalog access');
    }
  };

  const handleReset = async (user: UserRow) => {
    setResetting(true);
    try {
      await sendPasswordReset(user.email);
      notification.success('Reset email sent', user.email);
    } catch (err) {
      notification.error('Reset failed', err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async (user: UserRow) => {
    const msg =
      `Permanently remove ${user.email}?\n\nThe login and staff profile will be deleted. The email can be reused for a new user.`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      await deleteUser(user.id);
      notification.success('User removed', 'Account deleted; email can be reused');
      setSelected(null);
      load();
    } catch (err) {
      notification.error('Remove failed', err instanceof Error ? err.message : 'Could not delete user');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div style={{ paddingBottom: TABBAR_SPACE }}>
          <div className="sticky top-0 z-10 bg-gray-50 px-4 pb-3 pt-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-gray-900">Users</h1>
                <p className="text-xs text-gray-500">Staff accounts &amp; permissions</p>
              </div>
              <button
                type="button"
                onClick={openCreate}
                className="flex shrink-0 items-center gap-1 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>

            <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-gray-100">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email, role…"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                style={{ fontSize: '16px' }}
              />
            </div>

            <label className="flex items-center gap-2 px-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded accent-primary-600"
              />
              Show inactive users
            </label>
          </div>

          <div className="space-y-2 px-4 pt-1">
            <SectionLabel>
              {filtered.length} user{filtered.length !== 1 ? 's' : ''}
            </SectionLabel>

            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-7 w-7 animate-spin text-primary-600" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl bg-white px-6 py-12 text-center ring-1 ring-gray-100">
                <UsersIcon className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="font-semibold text-gray-900">No users found</p>
                <button type="button" onClick={openCreate} className="mt-3 text-sm font-semibold text-primary-600">
                  Add staff user
                </button>
              </div>
            ) : (
              filtered.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelected(user)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left ring-1 ring-gray-100 active:bg-gray-50"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-sm font-bold text-primary-700">
                    {(user.full_name || user.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-gray-900">{user.full_name || 'No name'}</p>
                      {!user.is_active && (
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-500">{user.email}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${roleBadgeClass(user.role)}`}>
                      {formatRole(user.role)}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
                </button>
              ))
            )}
          </div>
        </div>
      </PullToRefresh>

      <Sheet open={!!selected} onClose={() => setSelected(null)} ariaLabel="User details">
        {selected && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-base font-bold text-primary-700">
                {(selected.full_name || selected.email).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900">{selected.full_name || 'No name'}</h2>
                <p className="truncate text-sm text-gray-500">{selected.email}</p>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl bg-gray-50 p-4 ring-1 ring-gray-100">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Role</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${roleBadgeClass(selected.role)}`}>
                  {formatRole(selected.role)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Status</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${selected.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                  {selected.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              {selected.role === 'agent' && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Catalog access</span>
                  <button
                    type="button"
                    onClick={() => toggleCatalog(selected)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${selected.catalog_access ? 'bg-purple-600' : 'bg-gray-300'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${selected.catalog_access ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </div>
              )}
              {selected.last_login && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Last login</span>
                  <span className="text-gray-900">{new Date(selected.last_login).toLocaleDateString()}</span>
                </div>
              )}
            </div>

            <button type="button" onClick={() => openEdit(selected)} className="w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white">
              Edit user
            </button>
            <button
              type="button"
              onClick={() => handleReset(selected)}
              disabled={resetting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-semibold text-gray-800 ring-1 ring-gray-200 disabled:opacity-60"
            >
              <Mail className="h-4 w-4" />
              {resetting ? 'Sending…' : 'Send password reset'}
            </button>
            <button
              type="button"
              onClick={() => toggleActive(selected)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-sm font-semibold text-gray-800 ring-1 ring-gray-200"
            >
              {selected.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {selected.is_active ? 'Deactivate account' : 'Activate account'}
            </button>
            <button
              type="button"
              onClick={() => handleDelete(selected)}
              disabled={deleting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 py-3.5 text-sm font-semibold text-red-700 ring-1 ring-red-100 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? 'Removing…' : 'Remove account'}
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} ariaLabel="User form">
        <h2 className="text-lg font-bold text-gray-900">{editing ? 'Edit user' : 'Invite user'}</h2>
        <div className="space-y-3">
          <Field label="Email *">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={!!editing}
              className={`${inputCls} disabled:opacity-60`}
            />
          </Field>
          {!editing && (
            <p className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs text-blue-800 ring-1 ring-blue-100">
              An invitation email will be sent. The user sets their own password when they accept.
            </p>
          )}
          <Field label="Full name">
            <input
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className={inputCls}
            />
          </Field>
          <Field label="Role *">
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className={inputCls}
            >
              {roles.map((role) => (
                <option key={role.name} value={role.name}>
                  {role.display_name}
                </option>
              ))}
            </select>
          </Field>
          {editing && (
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="rounded accent-primary-600"
              />
              User is active
            </label>
          )}
        </div>
        <button type="button" onClick={submit} disabled={saving} className="mt-2 w-full rounded-2xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-60">
          {saving ? 'Saving…' : editing ? 'Update user' : 'Send invitation'}
        </button>
      </Sheet>
    </>
  );
}
