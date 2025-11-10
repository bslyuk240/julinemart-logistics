import { useEffect, useState } from 'react';
import { Settings, Key, CheckCircle, XCircle, AlertCircle, Save } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface Courier {
  id: string;
  name: string;
  code: string;
  api_enabled: boolean;
  api_base_url: string;
  api_key_encrypted: string;
  supports_live_tracking: boolean;
  supports_label_generation: boolean;
  is_active: boolean;
}

export function CourierSettingsPage() {
  const notification = useNotification();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, { api_key: string; api_secret: string }>>({});

  useEffect(() => {
    fetchCouriers();
  }, []);

  const fetchCouriers = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/couriers');
      const data = await response.json();
      setCouriers(data.data || []);
      
      // Initialize credentials state
      const initialCredentials: Record<string, { api_key: string; api_secret: string }> = {};
      data.data?.forEach((courier: Courier) => {
        initialCredentials[courier.id] = {
          api_key: courier.api_key_encrypted ? '••••••••••••' : '',
          api_secret: '',
        };
      });
      setCredentials(initialCredentials);
    } catch (error) {
      console.error('Error fetching couriers:', error);
      notification.error('Failed to Load', 'Unable to fetch courier settings');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialChange = (courierId: string, field: 'api_key' | 'api_secret', value: string) => {
    setCredentials(prev => ({
      ...prev,
      [courierId]: {
        ...prev[courierId],
        [field]: value,
      },
    }));
  };

  const handleToggleAPI = async (courierId: string, enabled: boolean) => {
    try {
      const response = await fetch(`http://localhost:3001/api/couriers/${courierId}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_enabled: enabled }),
      });

      if (response.ok) {
        notification.success(
          enabled ? 'API Enabled' : 'API Disabled',
          `Courier API has been ${enabled ? 'enabled' : 'disabled'}`
        );
        fetchCouriers();
      }
    } catch (error) {
      notification.error('Error', 'Failed to update API status');
    }
  };

  const handleSaveCredentials = async (courierId: string) => {
    setSaving(courierId);
    
    try {
      const creds = credentials[courierId];
      
      // Only send if not masked
      const payload: any = {};
      if (creds.api_key && !creds.api_key.includes('•')) {
        payload.api_key = creds.api_key;
      }
      if (creds.api_secret) {
        payload.api_secret = creds.api_secret;
      }

      const response = await fetch(`http://localhost:3001/api/couriers/${courierId}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        notification.success('Credentials Saved', 'API credentials updated successfully');
        fetchCouriers();
      } else {
        notification.error('Save Failed', 'Unable to save credentials');
      }
    } catch (error) {
      notification.error('Error', 'Failed to save credentials');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Courier API Settings</h1>
        <p className="text-gray-600 mt-2">
          Configure API credentials for live courier integrations
        </p>
      </div>

      {/* Info Banner */}
      <div className="card mb-6 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 mb-1">About API Integration</h3>
            <p className="text-sm text-blue-800">
              Connect your courier accounts to enable automatic shipment creation, live tracking, 
              and label generation. API credentials are encrypted and stored securely.
            </p>
          </div>
        </div>
      </div>

      {/* Courier Settings Cards */}
      <div className="space-y-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          couriers.map((courier) => (
            <div key={courier.id} className="card">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    {courier.name}
                    {courier.api_enabled ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <XCircle className="w-5 h-5 text-gray-400" />
                    )}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Code: {courier.code} • Base URL: {courier.api_base_url || 'Not configured'}
                  </p>
                </div>

                <label className="flex items-center cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={courier.api_enabled}
                      onChange={(e) => handleToggleAPI(courier.id, e.target.checked)}
                      className="sr-only"
                    />
                    <div className={`w-14 h-8 rounded-full transition-colors ${
                      courier.api_enabled ? 'bg-green-500' : 'bg-gray-300'
                    }`}>
                      <div className={`absolute left-1 top-1 w-6 h-6 bg-white rounded-full transition-transform ${
                        courier.api_enabled ? 'transform translate-x-6' : ''
                      }`} />
                    </div>
                  </div>
                  <span className="ml-3 text-sm font-medium text-gray-700">
                    {courier.api_enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>

              {/* Features */}
              <div className="flex gap-4 mb-6 pb-6 border-b">
                <div className="flex items-center gap-2 text-sm">
                  {courier.supports_live_tracking ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-gray-400" />
                  )}
                  <span className={courier.supports_live_tracking ? 'text-gray-900' : 'text-gray-500'}>
                    Live Tracking
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {courier.supports_label_generation ? (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  ) : (
                    <XCircle className="w-4 h-4 text-gray-400" />
                  )}
                  <span className={courier.supports_label_generation ? 'text-gray-900' : 'text-gray-500'}>
                    Label Generation
                  </span>
                </div>
              </div>

              {/* API Credentials Form */}
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  API Credentials
                </h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    API Key
                  </label>
                  <input
                    type="text"
                    value={credentials[courier.id]?.api_key || ''}
                    onChange={(e) => handleCredentialChange(courier.id, 'api_key', e.target.value)}
                    placeholder="Enter your API key"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {courier.api_key_encrypted 
                      ? 'API key is configured. Enter a new value to update.' 
                      : 'No API key configured yet.'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    API Secret (Optional)
                  </label>
                  <input
                    type="password"
                    value={credentials[courier.id]?.api_secret || ''}
                    onChange={(e) => handleCredentialChange(courier.id, 'api_secret', e.target.value)}
                    placeholder="Enter API secret if required"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Some couriers require an additional secret key
                  </p>
                </div>

                <button
                  onClick={() => handleSaveCredentials(courier.id)}
                  disabled={saving === courier.id}
                  className="btn-primary flex items-center"
                >
                  {saving === courier.id ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Credentials
                    </>
                  )}
                </button>
              </div>

              {/* Instructions */}
              {courier.code === 'FEZ' && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-semibold text-sm text-gray-900 mb-2">
                    📋 How to get Fez Delivery API Credentials:
                  </h4>
                  <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                    <li>Visit <a href="https://fezdispatch.com" target="_blank" className="text-primary-600 hover:underline">fezdispatch.com</a></li>
                    <li>Log in to your Fez account</li>
                    <li>Navigate to Settings → API Settings</li>
                    <li>Generate or copy your API key</li>
                    <li>Paste it above and click Save</li>
                  </ol>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Security Notice */}
      <div className="card mt-6 bg-yellow-50 border-yellow-200">
        <div className="flex items-start gap-3">
          <Settings className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-yellow-900 mb-1">Security Notice</h3>
            <p className="text-sm text-yellow-800">
              API credentials are encrypted before storage. Never share your API keys with unauthorized users.
              Disable API access immediately if you suspect your credentials have been compromised.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
