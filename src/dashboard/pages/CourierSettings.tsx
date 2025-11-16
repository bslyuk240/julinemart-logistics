import { useEffect, useState } from 'react';
import { Settings, Key, CheckCircle, XCircle, AlertCircle, Save, Zap } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface Courier {
  id: string;
  name: string;
  code: string;
  api_enabled: boolean;
  api_base_url: string;
  api_key_encrypted: string;
  api_user_id: string;
  api_password: string;
  supports_live_tracking: boolean;
  supports_label_generation: boolean;
  is_active: boolean;
}

export function CourierSettingsPage() {
  const notification = useNotification();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, { 
    api_user_id: string; 
    api_password: string;
    api_base_url: string;
  }>>({});

  const apiBase = import.meta.env.VITE_API_BASE_URL || '';
  const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

  useEffect(() => {
    fetchCouriers();
  }, []);

  const fetchCouriers = async () => {
    try {
      const response = await fetch(`${apiBase}/api/couriers`);
      const data = await response.json();
      setCouriers(data.data || []);
      
      // Initialize credentials state
      const initialCredentials: Record<string, { 
        api_user_id: string; 
        api_password: string;
        api_base_url: string;
      }> = {};
      
      data.data?.forEach((courier: Courier) => {
        initialCredentials[courier.id] = {
          api_user_id: courier.api_user_id || '',
          api_password: courier.api_password ? '••••••••••••' : '',
          api_base_url: courier.api_base_url || 'https://apisandbox.fezdelivery.co/v1',
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

  const handleCredentialChange = (
    courierId: string, 
    field: 'api_user_id' | 'api_password' | 'api_base_url', 
    value: string
  ) => {
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
      const response = await fetch(`${functionsBase}/save-courier-credentials/${courierId}`, {
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

  const handleTestConnection = async (courierId: string) => {
    setTesting(courierId);
    
    try {
      const creds = credentials[courierId];
      
      // Validate inputs
      if (!creds.api_user_id || !creds.api_password || creds.api_password === '••••••••••••') {
        notification.error(
          'Missing Credentials', 
          'Please enter User ID and Password before testing'
        );
        setTesting(null);
        return;
      }

      const response = await fetch(`${functionsBase}/save-courier-credentials/${courierId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test_connection',
          api_user_id: creds.api_user_id,
          api_password: creds.api_password,
          api_base_url: creds.api_base_url,
        }),
      });

      const data = await response.json();

      if (data.success) {
        notification.success(
          'Connection Successful! ✅',
          `Connected to ${data.orgName || 'Fez Delivery'}`
        );
      } else {
        notification.error(
          'Connection Failed',
          data.message || 'Unable to connect to Fez API'
        );
      }
    } catch (error) {
      notification.error('Test Failed', 'Failed to test connection');
    } finally {
      setTesting(null);
    }
  };

  const handleSaveCredentials = async (courierId: string) => {
    setSaving(courierId);
    
    try {
      const creds = credentials[courierId];
      
      // Build payload
      const payload: any = {
        api_base_url: creds.api_base_url,
      };

      // Only send if not masked
      if (creds.api_user_id) {
        payload.api_user_id = creds.api_user_id;
      }
      if (creds.api_password && !creds.api_password.includes('•')) {
        payload.api_password = creds.api_password;
      }

      const response = await fetch(`${functionsBase}/save-courier-credentials/${courierId}`, {
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
                    API Base URL
                  </label>
                  <select
                    value={credentials[courier.id]?.api_base_url || ''}
                    onChange={(e) => handleCredentialChange(courier.id, 'api_base_url', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="https://apisandbox.fezdelivery.co/v1">
                      Sandbox (Testing) - https://apisandbox.fezdelivery.co/v1
                    </option>
                    <option value="https://api.fezdelivery.co/v1">
                      Production (Live) - https://api.fezdelivery.co/v1
                    </option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Use Sandbox for testing, Production for live orders
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    User ID
                  </label>
                  <input
                    type="text"
                    value={credentials[courier.id]?.api_user_id || ''}
                    onChange={(e) => handleCredentialChange(courier.id, 'api_user_id', e.target.value)}
                    placeholder="e.g., G-4568-3493"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {courier.api_user_id 
                      ? `Current: ${courier.api_user_id}` 
                      : 'No User ID configured yet.'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={credentials[courier.id]?.api_password || ''}
                    onChange={(e) => handleCredentialChange(courier.id, 'api_password', e.target.value)}
                    placeholder="Enter your API password"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {courier.api_password 
                      ? 'Password is configured. Enter a new value to update.' 
                      : 'No password configured yet.'}
                  </p>
                </div>

                <div className="flex gap-3">
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

                  <button
                    onClick={() => handleTestConnection(courier.id)}
                    disabled={testing === courier.id}
                    className="btn-secondary flex items-center"
                  >
                    {testing === courier.id ? (
                      <>
                        <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin mr-2" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Test Connection
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Instructions for Fez */}
              {courier.code === 'FEZ' && (
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-semibold text-sm text-gray-900 mb-2">
                    📋 How to get Fez Delivery API Credentials:
                  </h4>
                  <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                    <li>Contact Fez support at <a href="mailto:support@fezdelivery.co" className="text-primary-600 hover:underline">support@fezdelivery.co</a></li>
                    <li>Request "Corporate API credentials for integration"</li>
                    <li>They will provide your User ID and Password</li>
                    <li>Enter credentials above</li>
                    <li>Click "Test Connection" to verify</li>
                    <li>Click "Save Credentials" to activate</li>
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
