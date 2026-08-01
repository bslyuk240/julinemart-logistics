import { supabase } from '../../contexts/AuthContext';

export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  catalog_access: boolean;
  last_login: string;
  created_at: string;
}

export interface RoleRow {
  name: string;
  display_name: string;
  description: string;
}

export interface UserFormData {
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export const DEFAULT_ROLES: RoleRow[] = [
  { name: 'admin', display_name: 'Administrator', description: 'Full access' },
  { name: 'shop_manager', display_name: 'Shop Manager', description: 'Catalog, vendors, categories' },
  {
    name: 'manager',
    display_name: 'Manager',
    description: 'Ops + catalog + vendors + hub dispatch; not admin-only screens',
  },
  { name: 'agent', display_name: 'Agent', description: 'Orders, dispatch & support' },
  { name: 'viewer', display_name: 'Viewer (legacy)', description: 'Ops pages; no catalog write routes' },
  { name: 'vendor', display_name: 'Vendor', description: 'Vendor portal only' },
  { name: 'social_media_manager', display_name: 'Social Media Manager', description: 'Meta Ads only' },
];

export const emptyUserForm = (): UserFormData => ({
  email: '',
  full_name: '',
  role: 'agent',
  is_active: true,
});

export function userFormFromRow(user: UserRow): UserFormData {
  return {
    email: user.email,
    full_name: user.full_name || '',
    role: user.role,
    is_active: user.is_active,
  };
}

function apiUrls(path: string): string[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const full = normalized.startsWith('/api/') ? normalized : `/api${normalized}`;
  const urls = [full];
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && window.location.port !== '8888') {
    urls.push(`http://localhost:8888${full}`);
  }
  return urls;
}

async function peopleFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
    ...(init?.headers || {}),
  };

  let lastError: Error | null = null;
  const urls = apiUrls(path);
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.status === 404 && i < urls.length - 1) continue;
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || json?.message || json?.hint || `Request failed (${res.status})`);
      return json as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Request failed');
      if (i < urls.length - 1) continue;
    }
  }
  throw lastError || new Error('Request failed');
}

export async function fetchUsers(): Promise<UserRow[]> {
  const res = await peopleFetch<{ data?: UserRow[] }>('/users');
  return res.data || [];
}

export async function fetchRoles(): Promise<RoleRow[]> {
  const res = await peopleFetch<{ data?: RoleRow[] }>('/roles');
  return res.data?.length ? res.data : DEFAULT_ROLES;
}

export async function saveUser(editingId: string | null, form: UserFormData) {
  const path = editingId ? `/users/${editingId}` : '/users';
  const body = editingId
    ? { full_name: form.full_name, role: form.role, is_active: form.is_active }
    : { email: form.email, full_name: form.full_name, role: form.role };
  return peopleFetch<{ success?: boolean; data?: UserRow }>(path, {
    method: editingId ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateUser(id: string, patch: Partial<Pick<UserRow, 'is_active' | 'catalog_access'>>) {
  return peopleFetch<{ success?: boolean }>(`/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteUser(id: string) {
  return peopleFetch<{ success?: boolean }>(`/users/${id}`, { method: 'DELETE' });
}

export async function sendPasswordReset(email: string) {
  return peopleFetch<{ success?: boolean }>('/users/send-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function roleBadgeClass(role: string): string {
  const colors: Record<string, string> = {
    admin: 'bg-red-100 text-red-800',
    agent: 'bg-blue-100 text-blue-800',
    shop_manager: 'bg-purple-100 text-purple-800',
    manager: 'bg-indigo-100 text-indigo-800',
    viewer: 'bg-slate-100 text-slate-800',
    vendor: 'bg-green-100 text-green-800',
    social_media_manager: 'bg-pink-100 text-pink-800',
  };
  return colors[role] || 'bg-gray-100 text-gray-800';
}

export function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
