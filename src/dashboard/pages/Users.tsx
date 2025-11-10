import { useEffect, useState } from 'react';
import { Users as UsersIcon, Plus, Edit, Trash2, Shield, Eye, EyeOff } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  last_login: string;
  created_at: string;
}

interface Role {
  name: string;
  display_name: string;
  description: string;
}

export function UsersPage() {
  const notification = useNotification();
  const { session } = useAuth();
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  useEffect(() => {
    fetchData();
  }, [session]);

  const fetchData = async () => {
    try {
      const authHeaders: HeadersInit = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
      const [usersRes, rolesRes] = await Promise.all([
        fetch(`${apiBase}/api/users`, { headers: authHeaders }),
        fetch(`${apiBase}/api/roles`, { headers: authHeaders })
      ]);

      const [usersData, rolesData] = await Promise.all([
        usersRes.json(),
        rolesRes.json()
      ]);

      setUsers(usersData.data || []);
      setRoles(rolesData.data || []);
      notification.success('Data Loaded', `${usersData.data?.length || 0} users found`);
    } catch (error) {
      console.error('Error fetching data:', error);
      notification.error('Failed to Load', 'Unable to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-red-100 text-red-800',
      manager: 'bg-blue-100 text-blue-800',
      viewer: 'bg-gray-100 text-gray-800',
    };
    return colors[role] || 'bg-gray-100 text-gray-800';
  };

  const getRoleIcon = (role: string) => {
    if (role === 'admin') return <Shield className="w-4 h-4" />;
    if (role === 'manager') return <UsersIcon className="w-4 h-4" />;
    return <Eye className="w-4 h-4" />;
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setShowForm(true);
  };

  const handleDelete = async (userId: string) => {
    if (!confirm('Are you sure you want to deactivate this user?')) return;

    try {
      const response = await fetch(`${apiBase}/api/users/${userId}`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });

      if (response.ok) {
        notification.success('User Deactivated', 'User has been deactivated');
        fetchData();
      } else {
        notification.error('Delete Failed', 'Unable to deactivate user');
      }
    } catch (error) {
      notification.error('Error', 'An unexpected error occurred');
    }
  };

  const toggleUserStatus = async (user: User) => {
    try {
      const response = await fetch(`${apiBase}/api/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ is_active: !user.is_active })
      });

      if (response.ok) {
        notification.success(
          user.is_active ? 'User Deactivated' : 'User Activated',
          `${user.email} is now ${user.is_active ? 'inactive' : 'active'}`
        );
        fetchData();
      }
    } catch (error) {
      notification.error('Error', 'Failed to update user status');
    }
  };

  return (
    <div>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600 mt-2">
            Manage user accounts and permissions � {users.length} total users
          </p>
        </div>
        <button
          onClick={() => {
            setEditingUser(null);
            setShowForm(true);
          }}
          className="btn-primary flex items-center"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add User
        </button>
      </div>

      {/* User Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : users.length === 0 ? (
          <div className="col-span-full card text-center py-12">
            <UsersIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No users found</p>
            <button
              onClick={() => setShowForm(true)}
              className="btn-primary mt-4"
            >
              Add Your First User
            </button>
          </div>
        ) : (
          users.map((user) => (
            <div key={user.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-semibold text-lg mr-3">
                    {user.full_name?.charAt(0) || user.email.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{user.full_name || 'No name'}</h3>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => toggleUserStatus(user)}
                  className="p-1"
                >
                  {user.is_active ? (
                    <Eye className="w-5 h-5 text-green-600" />
                  ) : (
                    <EyeOff className="w-5 h-5 text-gray-400" />
                  )}
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Role</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${getRoleColor(user.role)}`}>
                    {getRoleIcon(user.role)}
                    {user.role}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Status</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    user.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {user.last_login && (
                  <div className="text-sm text-gray-600">
                    Last login: {new Date(user.last_login).toLocaleDateString()}
                  </div>
                )}

                <div className="flex gap-2 pt-3 border-t">
                  <button
                    onClick={() => handleEdit(user)}
                    className="flex-1 btn-primary flex items-center justify-center text-sm"
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(user.id)}
                    className="flex-1 btn-orange flex items-center justify-center text-sm"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <UserForm
          user={editingUser}
          roles={roles}
          onClose={() => {
            setShowForm(false);
            setEditingUser(null);
          }}
          onSave={() => {
            setShowForm(false);
            setEditingUser(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

// User Form Component
interface UserFormProps {
  user: User | null;
  roles: Role[];
  onClose: () => void;
  onSave: () => void;
}

function UserForm({ user, roles, onClose, onSave }: UserFormProps) {
  const notification = useNotification();
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
  const { session } = useAuth();
  const [formData, setFormData] = useState({
    email: user?.email || '',
    password: '',
    full_name: user?.full_name || '',
    role: user?.role || 'viewer',
    is_active: user?.is_active ?? true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const url = user
        ? `${apiBase}/api/users/${user.id}`
        : `${apiBase}/api/users`;

      const method = user ? 'PUT' : 'POST';
      const body = user 
        ? { full_name: formData.full_name, role: formData.role, is_active: formData.is_active }
        : formData;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
      });

      if (response.ok) {
        notification.success(
          user ? 'User Updated' : 'User Created',
          'User saved successfully'
        );
        onSave();
      } else {
        const error = await response.json();
        notification.error('Save Failed', error.message || 'Unable to save user');
      }
    } catch (error) {
      notification.error('Error', 'An unexpected error occurred');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {user ? 'Edit User' : 'Add New User'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email *
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              disabled={!!user}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {!user && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password *
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                minLength={6}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Full Name
            </label>
            <input
              type="text"
              name="full_name"
              value={formData.full_name}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Role *
            </label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              {roles.map(role => (
                <option key={role.name} value={role.name}>
                  {role.display_name} - {role.description}
                </option>
              ))}
            </select>
          </div>

          {user && (
            <div>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleChange}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">User is active</span>
              </label>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              Cancel
            </button>
            <button type="submit" className="flex-1 btn-primary">
              {user ? 'Update User' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

