import { useEffect, useState } from 'react';
import { Truck, Plus, Edit, Trash2, Search } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface Courier {
  id: string;
  name: string;
  code: string;
  contact_person: string;
  contact_phone: string;
  contact_email: string;
  is_active: boolean;
  created_at: string;
}

export function CouriersPage() {
  const notification = useNotification();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCourier, setEditingCourier] = useState<Courier | null>(null);

  useEffect(() => {
    fetchCouriers();
  }, []);

  const fetchCouriers = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/couriers');
      const data = await response.json();
      setCouriers(data.data || []);
      notification.success('Data Loaded', `${data.data?.length || 0} couriers found`);
    } catch (error) {
      console.error('Error fetching couriers:', error);
      notification.error('Failed to Load', 'Unable to fetch couriers');
    } finally {
      setLoading(false);
    }
  };

  const filteredCouriers = couriers.filter(courier =>
    courier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    courier.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAdd = () => {
    setEditingCourier(null);
    setShowForm(true);
  };

  const handleEdit = (courier: Courier) => {
    setEditingCourier(courier);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this courier?')) return;

    try {
      const response = await fetch(`http://localhost:3001/api/couriers/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        notification.success('Deleted', 'Courier removed successfully');
        fetchCouriers();
      }
    } catch (error) {
      notification.error('Error', 'Failed to delete courier');
    }
  };

  return (
    <div>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Courier Partners</h1>
          <p className="text-gray-600 mt-2">
            Manage delivery courier partners • {filteredCouriers.length} couriers
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="btn-primary flex items-center"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Courier
        </button>
      </div>

      {/* Search */}
      <div className="card mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search couriers by name or code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      {/* Couriers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : filteredCouriers.length === 0 ? (
          <div className="col-span-full card text-center py-12">
            <Truck className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No couriers found</p>
            <button onClick={handleAdd} className="btn-primary mt-4">
              Add Your First Courier
            </button>
          </div>
        ) : (
          filteredCouriers.map((courier) => (
            <div key={courier.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mr-3">
                    <Truck className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{courier.name}</h3>
                    <p className="text-sm text-gray-500">{courier.code}</p>
                  </div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  courier.is_active 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {courier.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                {courier.contact_person && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Contact:</span>
                    <span className="font-medium">{courier.contact_person}</span>
                  </div>
                )}
                {courier.contact_phone && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Phone:</span>
                    <span className="font-medium">{courier.contact_phone}</span>
                  </div>
                )}
                {courier.contact_email && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Email:</span>
                    <span className="font-medium text-xs">{courier.contact_email}</span>
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-4 pt-4 border-t">
                <button
                  onClick={() => handleEdit(courier)}
                  className="flex-1 btn-primary flex items-center justify-center text-sm"
                >
                  <Edit className="w-4 h-4 mr-1" />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(courier.id)}
                  className="flex-1 btn-orange flex items-center justify-center text-sm"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <CourierForm
          courier={editingCourier}
          onClose={() => {
            setShowForm(false);
            setEditingCourier(null);
          }}
          onSave={() => {
            setShowForm(false);
            setEditingCourier(null);
            fetchCouriers();
          }}
        />
      )}
    </div>
  );
}

// Courier Form Component
interface CourierFormProps {
  courier: Courier | null;
  onClose: () => void;
  onSave: () => void;
}

function CourierForm({ courier, onClose, onSave }: CourierFormProps) {
  const notification = useNotification();
  const [formData, setFormData] = useState({
    name: courier?.name || '',
    code: courier?.code || '',
    contact_person: courier?.contact_person || '',
    contact_phone: courier?.contact_phone || '',
    contact_email: courier?.contact_email || '',
    is_active: courier?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const url = courier
        ? `http://localhost:3001/api/couriers/${courier.id}`
        : 'http://localhost:3001/api/couriers';

      const method = courier ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        notification.success(
          courier ? 'Courier Updated' : 'Courier Created',
          'Changes saved successfully'
        );
        onSave();
      } else {
        const error = await response.json();
        notification.error('Save Failed', error.message || 'Unable to save courier');
      }
    } catch (error) {
      notification.error('Error', 'An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">
            {courier ? 'Edit Courier' : 'Add New Courier'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Courier Name *
            </label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., Fez Delivery"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Courier Code *
            </label>
            <input
              type="text"
              name="code"
              value={formData.code}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., FEZ"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contact Person
            </label>
            <input
              type="text"
              name="contact_person"
              value={formData.contact_person}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., John Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contact Phone
            </label>
            <input
              type="tel"
              name="contact_phone"
              value={formData.contact_phone}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., +234 800 000 0000"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contact Email
            </label>
            <input
              type="email"
              name="contact_email"
              value={formData.contact_email}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., contact@courier.com"
            />
          </div>

          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                name="is_active"
                checked={formData.is_active}
                onChange={handleChange}
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <span className="ml-2 text-sm text-gray-700">Courier is active</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 btn-primary"
            >
              {saving ? 'Saving...' : courier ? 'Update Courier' : 'Create Courier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
