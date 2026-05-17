import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mail,
  Save,
  TestTube,
  Settings,
  CheckCircle,
  XCircle,
  AlertCircle,
  Send,
  ScrollText,
  RefreshCw,
  Plus,
  Trash2,
  Bell,
  Info,
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';
import { useAuth } from '../contexts/AuthContext';

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
  order_alert_emails: string[];
  /** Present when loaded from API — passwords are never returned; leave fields blank to keep existing secrets */
  secrets_configured?: {
    gmail_password: boolean;
    sendgrid_api_key: boolean;
    smtp_password: boolean;
  };
  /** Server sees a valid EMAIL_SECRETS_ENCRYPTION_KEY — if false, DB will store secrets in plaintext */
  email_secrets_encryption_active?: boolean;
  /** Env var is non-empty but may be wrong length (see banner) */
  email_secrets_key_env_present?: boolean;
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

interface EmailLogRow {
  id: string;
  order_id: string | null;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed';
  error_message: string | null;
  sent_at: string;
  created_at?: string;
  orders?: { order_number: string | number } | null;
}

export function EmailSettingsPage() {
  const notification = useNotification();
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<'config' | 'templates' | 'test' | 'logs'>('config');
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
    order_alert_emails: [],
  });
  const [newAlertEmail, setNewAlertEmail] = useState('');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testTemplateId, setTestTemplateId] = useState('');
  const [testTemplateData, setTestTemplateData] = useState('');
  const [emailLogs, setEmailLogs] = useState<EmailLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsTotal, setLogsTotal] = useState<number | null>(null);

  useEffect(() => {
    fetchConfig();
    fetchTemplates();
  }, []);

  const fetchEmailLogs = useCallback(async () => {
    if (!session?.access_token) {
      setLogsError('Sign in to view email logs.');
      return;
    }
    setLogsLoading(true);
    setLogsError(null);
    try {
      const response = await fetch('/api/email/logs?limit=100', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        setLogsError(json.detail || json.error || 'Failed to load logs');
        setEmailLogs([]);
        setLogsTotal(null);
        return;
      }
      setEmailLogs(json.data || []);
      setLogsTotal(typeof json.total === 'number' ? json.total : null);
    } catch {
      setLogsError('Failed to load logs');
      setEmailLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (activeTab === 'logs') {
      void fetchEmailLogs();
    }
  }, [activeTab, fetchEmailLogs]);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/email/config');
      const data = await response.json();
      if (data.success) {
        setConfig({
          ...data.data,
          order_alert_emails: Array.isArray(data.data.order_alert_emails) ? data.data.order_alert_emails : [],
        });
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
      } else {
        notification.error('Save Failed', data.error);
      }
    } catch (error) {
      notification.error('Error', 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };


  const handleSendTestEmail = async () => {
    if (!testEmail) {
      notification.error('Email Required', 'Please enter an email address');
      return;
    }

    let sampleData: Record<string, unknown> | undefined;
    if (testTemplateId && testTemplateData.trim()) {
      try {
        sampleData = JSON.parse(testTemplateData);
      } catch (error) {
        notification.error('Invalid JSON', 'Template data must be valid JSON');
        return;
      }
    }

    setTesting(true);
    try {
      const response = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          template_id: testTemplateId || undefined,
          sample_data: sampleData,
        }),
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
    { id: 'logs', label: 'Logs', icon: ScrollText },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-primary-600 flex-shrink-0" />
          Email Management
        </h1>
        <p className="text-gray-600 mt-1 text-sm sm:text-base">
          Configure email providers, customize templates, and test delivery
        </p>
      </div>


      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6 -mx-4 sm:mx-0">
        <nav className="flex overflow-x-auto px-4 sm:px-0" style={{ scrollbarWidth: 'none' }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`
                  flex items-center gap-1.5 px-3 sm:px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap flex-shrink-0
                  ${isActive
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                  }
                `}
              >
                <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Configuration Tab */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* SMTP info banner */}
          <div className="card border-blue-200 bg-blue-50">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-blue-900">SMTP managed via server environment</h3>
                <p className="text-sm text-blue-800 mt-1">
                  Email delivery credentials (<code className="text-xs bg-white/70 px-1 rounded">SMTP_HOST</code>,{' '}
                  <code className="text-xs bg-white/70 px-1 rounded">SMTP_USER</code>,{' '}
                  <code className="text-xs bg-white/70 px-1 rounded">SMTP_PASSWORD</code>) are configured as
                  Netlify environment variables. No credentials are stored in the database.
                </p>
              </div>
            </div>
          </div>

          {/* General Settings */}
          <div className="card">
            <h2 className="text-lg sm:text-xl font-bold mb-4">General Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer Portal URL *
                </label>
                <input
                  type="url"
                  value={config.portal_url}
                  onChange={(e) => setConfig({ ...config, portal_url: e.target.value })}
                  placeholder="https://julinemart.com"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
                <p className="text-xs text-gray-500 mt-1">Used for tracking links in emails</p>
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

          {/* Order Alert Recipients */}
          <div className="card">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-5 h-5 text-primary-600 flex-shrink-0" />
              <h2 className="text-lg sm:text-xl font-bold">Order Alert Recipients</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              These email addresses will receive a notification every time a new customer order is placed.
            </p>

            <div className="space-y-2 mb-4">
              {(config.order_alert_emails ?? []).length === 0 && (
                <p className="text-sm text-gray-400 italic">No alert recipients yet — add one below.</p>
              )}
              {(config.order_alert_emails ?? []).map((email, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="flex-1 text-sm font-medium text-gray-800">{email}</span>
                  <button
                    type="button"
                    onClick={() => setConfig(prev => ({
                      ...prev,
                      order_alert_emails: prev.order_alert_emails.filter((_, i) => i !== idx),
                    }))}
                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    aria-label="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="email"
                value={newAlertEmail}
                onChange={e => setNewAlertEmail(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const em = newAlertEmail.trim().toLowerCase();
                    if (em && !config.order_alert_emails.includes(em)) {
                      setConfig(prev => ({ ...prev, order_alert_emails: [...prev.order_alert_emails, em] }));
                      setNewAlertEmail('');
                    }
                  }
                }}
                placeholder="staff@julinemart.com"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              <button
                type="button"
                onClick={() => {
                  const em = newAlertEmail.trim().toLowerCase();
                  if (em && !config.order_alert_emails.includes(em)) {
                    setConfig(prev => ({ ...prev, order_alert_emails: [...prev.order_alert_emails, em] }));
                    setNewAlertEmail('');
                  }
                }}
                className="btn-primary flex items-center gap-1.5 px-4 py-2 text-sm"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">Changes take effect after you click Save below.</p>
          </div>

          {/* Save button */}
          <button
            onClick={handleSaveConfig}
            disabled={saving}
            className="btn-primary flex items-center justify-center gap-2"
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
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <TemplatesTab templates={templates} onRefresh={fetchTemplates} />
      )}

      {/* Test Tab */}
      {activeTab === 'test' && (
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-lg sm:text-xl font-bold mb-4">Send Test Email</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Use Template (optional)
                </label>
                <select
                  value={testTemplateId}
                  onChange={(e) => setTestTemplateId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">Default test email</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>

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

              {testTemplateId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Template Data (JSON)
                  </label>
                  <textarea
                    value={testTemplateData}
                    onChange={(e) => setTestTemplateData(e.target.value)}
                    placeholder='{"customerName":"Jane Doe","orderNumber":"12345"}'
                    className="w-full min-h-[140px] px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                  />
                </div>
              )}

              <button
                onClick={handleSendTestEmail}
                disabled={testing}
                className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
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
            <h2 className="text-lg sm:text-xl font-bold mb-4">Setup Checklist</h2>
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

      {/* Rows from email_logs (transactional + storefront order mail) */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg sm:text-xl font-bold">Email send log</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Recent attempts recorded when the app sends mail via your configured provider. &quot;Sent&quot; means the
                  SMTP server accepted the message; inbox placement is not tracked here. Failed rows include the error
                  returned by the provider or transport.
                </p>
              </div>
              <button
                type="button"
                onClick={() => fetchEmailLogs()}
                disabled={logsLoading || !session?.access_token}
                className="btn-secondary inline-flex items-center gap-2 self-start"
              >
                <RefreshCw className={`w-4 h-4 ${logsLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {logsError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span>{logsError}</span>
              </div>
            )}

            {logsLoading && emailLogs.length === 0 && !logsError ? (
              <p className="text-gray-600 text-sm">Loading…</p>
            ) : emailLogs.length === 0 && !logsLoading ? (
              <p className="text-gray-600 text-sm">No log entries yet.</p>
            ) : (
              <>
                {logsTotal != null && (
                  <p className="text-xs text-gray-500 mb-2">Showing up to 100 of {logsTotal} total</p>
                )}

                {/* Mobile cards */}
                <div className="sm:hidden space-y-3">
                  {emailLogs.map((row) => {
                    const orderNum = row.orders?.order_number;
                    const orderHref = row.order_id ? `/admin/orders/${row.order_id}` : undefined;
                    const isSent = row.status === 'sent';
                    return (
                      <div key={row.id} className="border border-gray-200 rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          {isSent ? (
                            <span className="inline-flex items-center gap-1 text-green-700 text-sm font-medium">
                              <CheckCircle className="w-4 h-4" /> Sent
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-700 text-sm font-medium">
                              <XCircle className="w-4 h-4" /> Failed
                            </span>
                          )}
                          <span className="text-xs text-gray-500">
                            {row.sent_at
                              ? new Date(row.sent_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                              : '—'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 break-all">{row.recipient}</p>
                        <p className="text-xs text-gray-500 leading-snug">{row.subject}</p>
                        {orderHref && (
                          <a href={orderHref} className="text-xs text-primary-600 hover:underline">
                            {orderNum != null ? `Order #${orderNum}` : 'View order'}
                          </a>
                        )}
                        {row.error_message && (
                          <p className="text-xs text-red-700 break-words">{row.error_message}</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto -mx-4 sm:mx-0">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-600">
                        <th className="pb-2 pr-4 font-medium whitespace-nowrap">Time</th>
                        <th className="pb-2 pr-4 font-medium">Status</th>
                        <th className="pb-2 pr-4 font-medium">Recipient</th>
                        <th className="pb-2 pr-4 font-medium min-w-[12rem]">Subject</th>
                        <th className="pb-2 pr-4 font-medium">Order</th>
                        <th className="pb-2 font-medium min-w-[10rem]">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {emailLogs.map((row) => {
                        const orderNum = row.orders?.order_number;
                        const orderHref = row.order_id ? `/admin/orders/${row.order_id}` : undefined;
                        return (
                          <tr key={row.id} className="align-top">
                            <td className="py-2 pr-4 whitespace-nowrap text-gray-700">
                              {row.sent_at
                                ? new Date(row.sent_at).toLocaleString(undefined, {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })
                                : '—'}
                            </td>
                            <td className="py-2 pr-4">
                              {row.status === 'sent' ? (
                                <span className="inline-flex items-center gap-1 text-green-700">
                                  <CheckCircle className="w-4 h-4" /> Sent
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-red-700">
                                  <XCircle className="w-4 h-4" /> Failed
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-4 break-all max-w-[14rem]">{row.recipient}</td>
                            <td className="py-2 pr-4 text-gray-800">{row.subject}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">
                              {orderHref ? (
                                <a href={orderHref} className="text-primary-600 hover:underline">
                                  {orderNum != null ? `#${orderNum}` : 'View order'}
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-2 text-red-700 break-words max-w-md">
                              {row.error_message || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
  const notification = useNotification();
  const [subject, setSubject] = useState(template.subject || '');
  const [htmlContent, setHtmlContent] = useState(template.html_content || '');
  const [textContent, setTextContent] = useState(template.text_content || '');
  const [saving, setSaving] = useState(false);
  const [showHtml, setShowHtml] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSubject(template.subject || '');
    setHtmlContent(template.html_content || '');
    setTextContent(template.text_content || '');
    if (editorRef.current) {
      editorRef.current.innerHTML = template.html_content || '';
    }
  }, [template]);

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setHtmlContent(editorRef.current.innerHTML);
    }
  };

  const handleEditorInput = () => {
    if (editorRef.current) {
      setHtmlContent(editorRef.current.innerHTML);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/email/templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          html_content: htmlContent,
          text_content: textContent,
        }),
      });

      const data = await response.json();
      if (data.success) {
        notification.success('Template Updated', `${template.name} saved`);
        onSave();
      } else {
        notification.error('Save Failed', data.error || 'Failed to update template');
      }
    } catch (error) {
      notification.error('Save Failed', 'Failed to update template');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleHtml = () => {
    const nextShow = !showHtml;
    setShowHtml(nextShow);
    if (!nextShow && editorRef.current) {
      editorRef.current.innerHTML = htmlContent || '';
    }
  };

  const handleCopyTextFromHtml = () => {
    const temp = document.createElement('div');
    temp.innerHTML = htmlContent;
    setTextContent(temp.textContent || '');
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-lg sm:text-xl font-bold">{template.name}</h3>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2 flex-shrink-0"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              Save Template
            </>
          )}
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Email Content</label>
            <button
              onClick={handleToggleHtml}
              className="text-sm text-primary-600 hover:underline"
            >
              {showHtml ? 'Show Editor' : 'Show HTML'}
            </button>
          </div>

          {!showHtml && (
            <div className="border border-gray-300 rounded-lg">
              <div className="flex flex-wrap gap-2 border-b border-gray-200 px-3 py-2 bg-gray-50">
                <button onClick={() => execCommand('bold')} className="btn-secondary text-xs">
                  Bold
                </button>
                <button onClick={() => execCommand('italic')} className="btn-secondary text-xs">
                  Italic
                </button>
                <button onClick={() => execCommand('underline')} className="btn-secondary text-xs">
                  Underline
                </button>
                <button onClick={() => execCommand('formatBlock', 'h2')} className="btn-secondary text-xs">
                  H2
                </button>
                <button onClick={() => execCommand('insertUnorderedList')} className="btn-secondary text-xs">
                  Bullets
                </button>
                <button onClick={() => execCommand('insertOrderedList')} className="btn-secondary text-xs">
                  Numbers
                </button>
                <button
                  onClick={() => {
                    const url = window.prompt('Enter link URL');
                    if (url) execCommand('createLink', url);
                  }}
                  className="btn-secondary text-xs"
                >
                  Link
                </button>
                <button onClick={() => execCommand('removeFormat')} className="btn-secondary text-xs">
                  Clear
                </button>
              </div>
              <div
                ref={editorRef}
                className="min-h-[240px] p-4 focus:outline-none"
                contentEditable
                onInput={handleEditorInput}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </div>
          )}

          {showHtml && (
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              className="w-full min-h-[240px] px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
            />
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">Plain Text</label>
            <button
              onClick={handleCopyTextFromHtml}
              className="text-sm text-primary-600 hover:underline"
            >
              Copy from HTML
            </button>
          </div>
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            className="w-full min-h-[160px] px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
          />
        </div>

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
    </div>
  );
}
