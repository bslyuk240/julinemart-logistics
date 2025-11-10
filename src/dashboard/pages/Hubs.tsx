import { useEffect, useState } from 'react';
import { MapPin, Plus, Edit } from 'lucide-react';
import { HubForm } from '../components/HubForm';
import { useNotification } from '../contexts/NotificationContext';

interface Hub {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  phone: string;
  manager_name: string;
  is_active: boolean;
}

export function HubsPage() {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingHub, setEditingHub] = useState<Hub | null>(null);
  const notification = useNotification();

  useEffect(() => {
    fetchHubs();
  }, []);

  const fetchHubs = async () => {
    try {
      const response = await fetch('/api/hubs');
      const data = await response.json();
      setHubs(data.data || []);
    } catch (error) {
      console.error('Error fetching hubs:', error);
      notification.error('Failed to load hubs', 'Please try again later');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveHub = async (hubData: any) => {
    try {
      const url = editingHub 
        ? `/api/hubs/${editingHub.id}`
        : '/api/hubs';
      
      const method = editingHub ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hubData),
      });

      if (response.ok) {
        notification.success(
          editingHub ? 'Hub Updated' : 'Hub Created',
          editingHub 
            ? `${hubData.name} has been updated successfully` 
            : `${hubData.name} has been added to your hubs`
        );
        setShowForm(false);
        setEditingHub(null);
        fetchHubs();
      } else {
        notification.error('Operation Failed', 'Unable to save hub changes');
      }
    } catch (error) {
      console.error('Error saving hub:', error);
      notification.error('Error', 'An unexpected error occurred');
    }
  };

  const handleEdit = (hub: Hub) => {
    setEditingHub(hub);
    setShowForm(true);
    notification.info('Editing Hub', `Making changes to ${hub.name}`);
  };

  const handleAdd = () => {
    setEditingHub(null);
    setShowForm(true);
  };

  return (
    <div>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Hubs</h1>
          <p className="text-gray-600 mt-2">
            Manage delivery hub locations • {hubs.length} total hubs
          </p>
        </div>
        <button onClick={handleAdd} className="btn-primary flex items-center">
          <Plus className="w-5 h-5 mr-2" />
          Add Hub
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : hubs.length === 0 ? (
          <div className="col-span-full card text-center py-12">
            <MapPin className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No hubs configured yet</p>
            <button onClick={handleAdd} className="btn-primary mt-4">
              Add Your First Hub
            </button>
          </div>
        ) : (
          hubs.map((hub) => (
            <div key={hub.id} className="card hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center mr-3">
                    <MapPin className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{hub.name}</h3>
                    <p className="text-sm text-gray-500">{hub.code}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(hub)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Edit className="w-4 h-4 text-gray-600" />
                  </button>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    hub.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {hub.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <p className="text-gray-600">📍 {hub.city}, {hub.state}</p>
                <p className="text-gray-600">👤 {hub.manager_name}</p>
                <p className="text-gray-600">📞 {hub.phone}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {showForm && (
        <HubForm
          hub={editingHub}
          onClose={() => {
            setShowForm(false);
            setEditingHub(null);
            notification.info('Form Closed', 'No changes were saved');
          }}
          onSave={handleSaveHub}
        />
      )}
    </div>
  );
}
