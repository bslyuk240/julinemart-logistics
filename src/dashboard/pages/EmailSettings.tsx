import { useState, useEffect } from 'react';
import { 
  Mail, Save, TestTube, Settings, Eye, Code, 
  CheckCircle, XCircle, AlertCircle, Send
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface EmailConfig {
  provider: 'gmail' | 'sendgrid' | 'smtp';
  gmail_user: string;
  gmail_password: string;
  sendgrid_api_key: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  email_from: string;
  email_enabled: boolean;
  portal_url: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  type: string;
  subject: string;
  html_content: string;
  text_content: string;
  variables: string[];
  last_updated: string;
}

export function EmailSettingsPage() {
  const notification = useNotification();
  const [activeTab, setActiveTab] = useState<'config' | 'templates' | 'test'>('config');
  const [config, setConfig] = useState<EmailConfig>({
    provider: 'gmail',
    gmail_user: '',
    gmail_password: '',
    sendgrid_api_key: '',
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_password: '',
    email_from: '',
    email_enabled: true,
    portal_url: 'http://localhost:3002',
  });
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');

  useEffect(() => {
    fetchConfig();
    fetchTemplates();
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/email/config');
      const data = await response.json();
      if (data.success) {
        setConfig(data.data);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await fetch('/api/email/templates');
      const data = await response.json();
      if (data.success) {
        setTemplates(data.data);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await response.json();
      if (data.success) {
        notification.success('Configuration Saved', 'Email settings updated successfully');
        setConnectionStatus('unknown');
      } else {
        notification.error('Save Failed', data.error);
      }
    } catch (error) {
      notification.error('Error', 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/email/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await response.json();
      if (data.success) {
        setConnectionStatus('connected');
        notification.success('Connection Successful', 'Email provider is properly configured');
      } else {
        setConnectionStatus('error');
        notification.error('Connection Failed', data.error);
      }
    } catch (error) {
      setConnectionStatus('error');
      notification.error('Connection Failed', 'Unable to connect to email provider');
    } finally {
      setTesting(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmail) {
      notification.error('Email Required', 'Please enter an email address');
      return;
    }

    setTesting(true);
    try {
      const response = await fetch('/api/emails/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      });

      const data = await response.json();
      if (data.success) {
        notification.success('Test Email Sent!', `Check your inbox at ${testEmail}`);
      } else {
        notification.error('Send Failed', data.error);
      }
    } catch (error) {
      notification.error('Error', 'Failed to send test email');
    } finally {
      setTesting(false);
    }
  };

  const tabs = [
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'templates', label: 'Email Templates', icon: Mail },
    { id: 'test', label: 'Test & Verify', icon: TestTube },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Mail className="w-8 h-8 text-primary-600" />
          Email Management
        </h1>
        <p className="text-gray-600 mt-2">
          Configure email providers, customize templates, and test delivery
        </p>
      </div>

      {/* Connection Status Banner */}
      {connectionStatus !== 'unknown' && (
        <div className={`card mb-6 ${
          connectionStatus === 'connected' 
            ? 'bg-green-50 border-green-200' 
            : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center gap-3">
            {connectionStatus === 'connected' ? (
              <>
                <CheckCircle className="w-5 h-5 text-green-600" />
                <div>
                  <h3 className="font-semibold text-green-900">Email System Connected</h3>
                  <p className="text-sm text-green-800">Your email provider is properly configured and ready to send emails</p>
                </div>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-red-600" />
                <div>
                  <h3 className="font-semibold text-red-900">Connection Error</h3>
                  <p className="text-sm text-red-800">Unable to connect to email provider. Check your configuration.</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`
                  flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors
                  ${isActive 
                    ? 'border-primary-600 text-primary-600' 
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                  }
                `}
              >
                <Icon className="w-5 h-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Configuration Tab */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Provider Selection */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Email Provider</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {['gmail', 'sendgrid', 'smtp'].map((provider) => (
                <button
                  key={provider}
                  onClick={() => setConfig({ ...config, provider: provider as any })}
                  className={`p-4 border-2 rounded-lg text-left transition-colors ${
                    config.provider === provider
                      ? 'border-primary-600 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-lg capitalize mb-1">{provider}</div>
                  <div className="text-sm text-gray-600">
                    {provider === 'gmail' && 'Best for testing & small businesses'}
                    {provider === 'sendgrid' && 'Recommended for production'}
                    {provider === 'smtp' && 'Use your own SMTP server'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Gmail Configuration */}
          {config.provider === 'gmail' && (
            <div className="card">
              <h2 className="text-xl font-bold mb-4">Gmail Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Gmail Address *
                  </label>
                  <input
                    type="email"
                    value={config.gmail_user}
                    onChange={(e) => setConfig({ ...config, gmail_user: e.target.value })}
                    placeholder="your-email@gmail.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    App Password *
                  </label>
                  <input
                    type="password"
                    value={config.gmail_password}
                    onChange={(e) => setConfig({ ...config, gmail_password: e.target.value })}
                    placeholder="16-character app password"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Generate at: <a href="https://myaccount.google.com/apppasswords" target="_blank" className="text-primary-600 hover:underline">myaccount.google.com/apppasswords</a>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SendGrid Configuration */}
          {config.provider === 'sendgrid' && (
            <div className="card">
              <h2 className="text-xl font-bold mb-4">SendGrid Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SendGrid API Key *
                  </label>
                  <input
                    type="password"
                    value={config.sendgrid_api_key}
                    onChange={(e) => setConfig({ ...config, sendgrid_api_key: e.target.value })}
                    placeholder="SG.xxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Get your API key from: <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" className="text-primary-600 hover:underline">SendGrid Dashboard</a>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SMTP Configuration */}
          {config.provider === 'smtp' && (
            <div className="card">
              <h2 className="text-xl font-bold mb-4">Custom SMTP Configuration</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Host *
                  </label>
                  <input
                    type="text"
                    value={config.smtp_host}
                    onChange={(e) => setConfig({ ...config, smtp_host: e.target.value })}
                    placeholder="smtp.example.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Port *
                  </label>
                  <input
                    type="number"
                    value={config.smtp_port}
                    onChange={(e) => setConfig({ ...config, smtp_port: parseInt(e.target.value) })}
                    placeholder="587"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Username *
                  </label>
                  <input
                    type="text"
                    value={config.smtp_user}
                    onChange={(e) => setConfig({ ...config, smtp_user: e.target.value })}
                    placeholder="username"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMTP Password *
                  </label>
                  <input
                    type="password"
                    value={config.smtp_password}
                    onChange={(e) => setConfig({ ...config, smtp_password: e.target.value })}
                    placeholder="password"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {/* General Settings */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">General Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  From Email Address *
                </label>
                <input
                  type="text"
                  value={config.email_from}
                  onChange={(e) => setConfig({ ...config, email_from: e.target.value })}
                  placeholder='JulineMart <noreply@julinemart.com>'
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Format: Display Name &lt;email@domain.com&gt;
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer Portal URL *
                </label>
                <input
                  type="url"
                  value={config.portal_url}
                  onChange={(e) => setConfig({ ...config, portal_url: e.target.value })}
                  placeholder="https://track.julinemart.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Used for tracking links in emails
                </p>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="email_enabled"
                  checked={config.email_enabled}
                  onChange={(e) => setConfig({ ...config, email_enabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <label htmlFor="email_enabled" className="text-sm font-medium">
                  Enable Email Notifications
                </label>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="btn-secondary flex items-center gap-2"
            >
              {testing ? (
                <>
                  <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <TestTube className="w-5 h-5" />
                  Test Connection
                </>
              )}
            </button>

            <button
              onClick={handleSaveConfig}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Save Configuration
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <TemplatesTab templates={templates} onRefresh={fetchTemplates} />
      )}

      {/* Test Tab */}
      {activeTab === 'test' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Send Test Email</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Test Email Address
                </label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="your-email@example.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>

              <button
                onClick={handleSendTestEmail}
                disabled={testing}
                className="btn-primary flex items-center gap-2"
              >
                {testing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Test Email
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Setup Checklist */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Setup Checklist</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${
                  config.provider ? 'text-green-600' : 'text-gray-300'
                }`} />
                <div>
                  <p className="font-medium">Email provider selected</p>
                  <p className="text-sm text-gray-600">Choose Gmail, SendGrid, or SMTP</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${
                  config.email_from ? 'text-green-600' : 'text-gray-300'
                }`} />
                <div>
                  <p className="font-medium">From address configured</p>
                  <p className="text-sm text-gray-600">Set your sender email address</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${
                  connectionStatus === 'connected' ? 'text-green-600' : 'text-gray-300'
                }`} />
                <div>
                  <p className="font-medium">Connection tested</p>
                  <p className="text-sm text-gray-600">Verify email provider connection works</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle className={`w-5 h-5 flex-shrink-0 ${
                  config.email_enabled ? 'text-green-600' : 'text-gray-300'
                }`} />
                <div>
                  <p className="font-medium">Email notifications enabled</p>
                  <p className="text-sm text-gray-600">Turn on automatic email sending</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Templates Tab Component
function TemplatesTab({ templates, onRefresh }: { templates: EmailTemplate[]; onRefresh: () => void }) {
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Template List */}
      <div className="lg:col-span-1 space-y-3">
        <h3 className="font-semibold text-gray-900">Available Templates</h3>
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => setSelectedTemplate(template)}
            className={`w-full text-left p-4 border-2 rounded-lg transition-colors ${
              selectedTemplate?.id === template.id
                ? 'border-primary-600 bg-primary-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="font-medium">{template.name}</div>
            <div className="text-sm text-gray-600">{template.type}</div>
          </button>
        ))}
      </div>

      {/* Template Editor */}
      <div className="lg:col-span-2">
        {selectedTemplate ? (
          <TemplateEditor template={selectedTemplate} onSave={onRefresh} />
        ) : (
          <div className="card text-center py-12">
            <Mail className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600">Select a template to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Template Editor Component (Preview in next phase)
function TemplateEditor({ template, onSave }: { template: EmailTemplate; onSave: () => void }) {
  return (
    <div className="card">
      <h3 className="text-xl font-bold mb-4">{template.name}</h3>
      <p className="text-gray-600 mb-6">Template editing coming in next phase...</p>
      <div className="bg-gray-50 p-4 rounded-lg">
        <p className="text-sm font-medium mb-2">Available Variables:</p>
        <div className="flex flex-wrap gap-2">
          {template.variables.map((variable) => (
            <code key={variable} className="text-xs bg-white px-2 py-1 rounded border">
              {`{{${variable}}}`}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}
