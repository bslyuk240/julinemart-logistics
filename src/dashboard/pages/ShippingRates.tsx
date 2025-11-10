import { useEffect, useState } from 'react';
import { DollarSign, Plus, Edit, Trash2, Search, Filter } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface Hub {
  id: string;
  name: string;
  code: string;
}

interface Zone {
  id: string;
  name: string;
  code: string;
}

interface Courier {
  id: string;
  name: string;
  code: string;
}

interface ShippingRate {
  id: string;
  origin_hub_id: string;
  destination_zone_id: string;
  courier_id: string;
  flat_rate: number;
  base_rate: number;
  additional_weight_rate: number;
  per_kg_rate: number;
  vat_percentage: number;
  min_weight: number;
  max_weight: number;
  free_shipping_threshold: number;
  delivery_timeline_days: number;
  is_active: boolean;
  hubs?: { name: string; code: string };
  zones?: { name: string; code: string };
  couriers?: { name: string; code: string };
}

export function ShippingRatesPage() {
  const notification = useNotification();
  const [rates, setRates] = useState<ShippingRate[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRate, setEditingRate] = useState<ShippingRate | null>(null);
  const [filterHub, setFilterHub] = useState('all');
  const [filterZone, setFilterZone] = useState('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Fetch all data in parallel
      const [ratesRes, hubsRes, zonesRes, couriersRes] = await Promise.all([
        fetch('http://localhost:3001/api/shipping-rates'),
        fetch('http://localhost:3001/api/hubs'),
        fetch('http://localhost:3001/api/zones'),
        fetch('http://localhost:3001/api/couriers')
      ]);

      const [ratesData, hubsData, zonesData, couriersData] = await Promise.all([
        ratesRes.json(),
        hubsRes.json(),
        zonesRes.json(),
        couriersRes.json()
      ]);

      setRates(ratesData.data || []);
      setHubs(hubsData.data || []);
      setZones(zonesData.data || []);
      setCouriers(couriersData.data || []);
      
      notification.success('Data Loaded', `${ratesData.data?.length || 0} shipping rates found`);
    } catch (error) {
      console.error('Error fetching data:', error);
      notification.error('Failed to Load', 'Unable to fetch shipping rates');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingRate(null);
    setShowForm(true);
  };

  const handleEdit = (rate: ShippingRate) => {
    setEditingRate(rate);
    setShowForm(true);
  };

  const handleDelete = async (rateId: string) => {
    if (!confirm('Are you sure you want to delete this rate?')) return;

    try {
      const response = await fetch(`http://localhost:3001/api/shipping-rates/${rateId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        notification.success('Rate Deleted', 'Shipping rate removed successfully');
        fetchData();
      } else {
        notification.error('Delete Failed', 'Unable to delete rate');
      }
    } catch (error) {
      notification.error('Error', 'An unexpected error occurred');
    }
  };

  const filteredRates = rates.filter(rate => {
    if (filterHub !== 'all' && rate.origin_hub_id !== filterHub) return false;
    if (filterZone !== 'all' && rate.destination_zone_id !== filterZone) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Shipping Rates</h1>
          <p className="text-gray-600 mt-2">
            Manage multi-hub shipping rates  {filteredRates.length} of {rates.length} rates
          </p>
        </div>
        <button onClick={handleAdd} className="btn-primary flex items-center">
          <Plus className="w-5 h-5 mr-2" />
          Add Rate
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Hub
            </label>
            <select
              value={filterHub}
              onChange={(e) => setFilterHub(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Hubs</option>
              {hubs.map(hub => (
                <option key={hub.id} value={hub.id}>{hub.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filter by Zone
            </label>
            <select
              value={filterZone}
              onChange={(e) => setFilterZone(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="all">All Zones</option>
              {zones.map(zone => (
                <option key={zone.id} value={zone.id}>{zone.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Rates Table */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : filteredRates.length === 0 ? (
          <div className="text-center py-12">
            <DollarSign className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No shipping rates found</p>
            <button onClick={handleAdd} className="btn-primary mt-4">
              Add Your First Rate
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Route
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Courier
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Base Rate
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Per KG
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Weight Range
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Delivery
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredRates.map((rate) => (
                  <tr key={rate.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {rate.hubs?.name || 'Any Hub'}  {rate.zones?.name || 'Unknown'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {rate.hubs?.code}  {rate.zones?.code}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900">
                      {rate.couriers?.name || 'Any Courier'}
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-gray-900">
                      {(rate.flat_rate || rate.base_rate || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-900">
                      {(rate.additional_weight_rate || rate.per_kg_rate || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-600">
                      {rate.min_weight || 0}kg - {rate.max_weight || 4}kg
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-600">
                      {rate.delivery_timeline_days || 3} days
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        rate.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {rate.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(rate)}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          <Edit className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => handleDelete(rate.id)}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <ShippingRateForm
          rate={editingRate}
          hubs={hubs}
          zones={zones}
          couriers={couriers}
          onClose={() => {
            setShowForm(false);
            setEditingRate(null);
          }}
          onSave={() => {
            setShowForm(false);
            setEditingRate(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}

// Shipping Rate Form Component
interface RateFormProps {
  rate: ShippingRate | null;
  hubs: Hub[];
  zones: Zone[];
  couriers: Courier[];
  onClose: () => void;
  onSave: () => void;
}

function ShippingRateForm({ rate, hubs, zones, couriers, onClose, onSave }: RateFormProps) {
  const notification = useNotification();
  const [formData, setFormData] = useState({
    origin_hub_id: rate?.origin_hub_id || '',
    destination_zone_id: rate?.destination_zone_id || '',
    courier_id: rate?.courier_id || '',
    flat_rate: rate?.flat_rate || rate?.base_rate || 0,
    additional_weight_rate: rate?.additional_weight_rate || rate?.per_kg_rate || 0,
    vat_percentage: rate?.vat_percentage || 7.5,
    min_weight: rate?.min_weight || 0.5,
    max_weight: rate?.max_weight || 4.0,
    free_shipping_threshold: rate?.free_shipping_threshold || 0,
    delivery_timeline_days: rate?.delivery_timeline_days || 3,
    is_active: rate?.is_active ?? true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const url = rate
        ? `http://localhost:3001/api/shipping-rates/${rate.id}`
        : 'http://localhost:3001/api/shipping-rates';

      const method = rate ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        notification.success(
          rate ? 'Rate Updated' : 'Rate Created',
          'Shipping rate saved successfully'
        );
        onSave();
      } else {
        notification.error('Save Failed', 'Unable to save rate');
      }
    } catch (error) {
      notification.error('Error', 'An unexpected error occurred');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : 
              type === 'number' ? parseFloat(value) || 0 : value
    }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-2xl font-bold text-gray-900">
            {rate ? 'Edit Shipping Rate' : 'Add New Shipping Rate'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Origin Hub *
              </label>
              <select
                name="origin_hub_id"
                value={formData.origin_hub_id}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select Hub</option>
                {hubs.map(hub => (
                  <option key={hub.id} value={hub.id}>{hub.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Destination Zone *
              </label>
              <select
                name="destination_zone_id"
                value={formData.destination_zone_id}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select Zone</option>
                {zones.map(zone => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Courier *
              </label>
              <select
                name="courier_id"
                value={formData.courier_id}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Select Courier</option>
                {couriers.map(courier => (
                  <option key={courier.id} value={courier.id}>{courier.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Base/Flat Rate () *
              </label>
              <input
                type="number"
                name="flat_rate"
                value={formData.flat_rate}
                onChange={handleChange}
                required
                min="0"
                step="0.01"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Additional Rate Per KG ()
              </label>
              <input
                type="number"
                name="additional_weight_rate"
                value={formData.additional_weight_rate}
                onChange={handleChange}
                min="0"
                step="0.01"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                VAT (%)
              </label>
              <input
                type="number"
                name="vat_percentage"
                value={formData.vat_percentage}
                onChange={handleChange}
                min="0"
                max="100"
                step="0.1"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Min Weight (kg)
              </label>
              <input
                type="number"
                name="min_weight"
                value={formData.min_weight}
                onChange={handleChange}
                min="0"
                step="0.1"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Weight (kg)
              </label>
              <input
                type="number"
                name="max_weight"
                value={formData.max_weight}
                onChange={handleChange}
                min="0"
                step="0.1"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Free Shipping Threshold ()
              </label>
              <input
                type="number"
                name="free_shipping_threshold"
                value={formData.free_shipping_threshold}
                onChange={handleChange}
                min="0"
                step="0.01"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Delivery Timeline (days)
              </label>
              <input
                type="number"
                name="delivery_timeline_days"
                value={formData.delivery_timeline_days}
                onChange={handleChange}
                min="1"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleChange}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">Rate is active</span>
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-6 border-t">
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              Cancel
            </button>
            <button type="submit" className="flex-1 btn-primary">
              {rate ? 'Update Rate' : 'Create Rate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
