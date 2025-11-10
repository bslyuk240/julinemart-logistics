import { useState, useEffect } from 'react';
import { Save, Eye, Code, RefreshCw } from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

interface EmailTemplate {
  id: string;
  name: string;
  type: string;
  subject: string;
  html_content: string;
  text_content: string;
  variables: string[];
}

interface TemplateEditorProps {
  template: EmailTemplate;
  onSave: () => void;
}

export function TemplateEditor({ template: initialTemplate, onSave }: TemplateEditorProps) {
  const notification = useNotification();
  const [template, setTemplate] = useState(initialTemplate);
  const [activeView, setActiveView] = useState<'edit' | 'preview'>('edit');
  const [previewHtml, setPreviewHtml] = useState('');
  const [saving, setSaving] = useState(false);
  const [sampleData, setSampleData] = useState<Record<string, string>>({});

  useEffect(() => {
    // Initialize sample data for variables
    const samples: Record<string, string> = {};
    template.variables.forEach((variable) => {
      samples[variable] = getSampleValue(variable);
    });
    setSampleData(samples);
  }, [template.variables]);

  const getSampleValue = (variable: string): string => {
    const samples: Record<string, string> = {
      orderNumber: '12345',
      customerName: 'John Doe',
      customerEmail: 'john@example.com',
      orderDate: new Date().toLocaleDateString(),
      totalAmount: '50,000',
      shippingFee: '3,500',
      trackingNumber: 'FEZ123456789',
      trackingUrl: 'http://localhost:3002?order=12345&email=john@example.com',
      deliveryAddress: '123 Main Street, Lagos',
      deliveryCity: 'Lagos',
      deliveryState: 'Lagos',
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString(),
    };
    return samples[variable] || `Sample ${variable}`;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/email/templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: template.subject,
          html_content: template.html_content,
          text_content: template.text_content,
        }),
      });

      const data = await response.json();
      if (data.success) {
        notification.success('Template Saved', 'Email template updated successfully');
        onSave();
      } else {
        notification.error('Save Failed', data.error);
      }
    } catch (error) {
      notification.error('Error', 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    try {
      const response = await fetch(`/api/email/templates/${template.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleData),
      });

      const data = await response.json();
      if (data.success) {
        setPreviewHtml(data.data.html);
        setActiveView('preview');
      }
    } catch (error) {
      notification.error('Error', 'Failed to generate preview');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">{template.name}</h3>
            <p className="text-sm text-gray-600">Type: {template.type}</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setActiveView('edit')}
              className={`btn-secondary text-sm flex items-center gap-2 ${
                activeView === 'edit' ? 'bg-primary-100 text-primary-700' : ''
              }`}
            >
              <Code className="w-4 h-4" />
              Edit
            </button>

            <button
              onClick={handlePreview}
              className={`btn-secondary text-sm flex items-center gap-2 ${
                activeView === 'preview' ? 'bg-primary-100 text-primary-700' : ''
              }`}
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Editor View */}
      {activeView === 'edit' && (
        <div className="space-y-4">
          {/* Subject Line */}
          <div className="card">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Subject
            </label>
            <input
              type="text"
              value={template.subject}
              onChange={(e) => setTemplate({ ...template, subject: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono"
              placeholder="Order Confirmed - #{{orderNumber}}"
            />
            <p className="text-xs text-gray-500 mt-1">
              Use {'{{variableName}}'} for dynamic content
            </p>
          </div>

          {/* HTML Content */}
          <div className="card">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              HTML Template
            </label>
            <textarea
              value={template.html_content}
              onChange={(e) => setTemplate({ ...template, html_content: e.target.value })}
              rows={20}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
              placeholder="<html>..."
            />
          </div>

          {/* Plain Text Content */}
          <div className="card">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Plain Text Version
            </label>
            <textarea
              value={template.text_content}
              onChange={(e) => setTemplate({ ...template, text_content: e.target.value })}
              rows={10}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
              placeholder="Plain text version..."
            />
            <p className="text-xs text-gray-500 mt-1">
              Fallback for email clients that don't support HTML
            </p>
          </div>

          {/* Available Variables */}
          <div className="card">
            <h4 className="font-semibold mb-3">Available Variables</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {template.variables.map((variable) => (
                <button
                  key={variable}
                  onClick={() => {
                    navigator.clipboard.writeText(`{{${variable}}}`);
                    notification.success('Copied!', `{{${variable}}} copied to clipboard`);
                  }}
                  className="text-left p-2 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200 text-sm"
                >
                  <code className="text-primary-600">{`{{${variable}}}`}</code>
                <div className="text-xs text-gray-500 mt-1">{sampleData[variable]}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Preview View */}
      {activeView === 'preview' && (
        <div className="space-y-4">
          {/* Sample Data Editor */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold">Sample Data</h4>
              <button
                onClick={handlePreview}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Update Preview
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {template.variables.map((variable) => (
                <div key={variable}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    {variable}
                  </label>
                  <input
                    type="text"
                    value={sampleData[variable] || ''}
                    onChange={(e) => setSampleData({ ...sampleData, [variable]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Email Preview */}
          <div className="card">
            <h4 className="font-semibold mb-4">Email Preview</h4>
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              {/* Email Header */}
              <div className="bg-gray-100 border-b border-gray-300 p-3">
                <div className="text-sm">
                  <div className="mb-2">
                    <span className="font-medium">From:</span> {template.subject.replace(/{{.*?}}/g, (match) => {
                      const key = match.slice(2, -2);
                      return sampleData[key] || match;
                    })}
                  </div>
                  <div>
                    <span className="font-medium">Subject:</span> {template.subject.replace(/{{.*?}}/g, (match) => {
                      const key = match.slice(2, -2);
                      return sampleData[key] || match;
                    })}
                  </div>
                </div>
              </div>

              {/* Email Body */}
              <div className="bg-white p-4">
                <iframe
                  srcDoc={previewHtml}
                  className="w-full h-[600px] border-0"
                  title="Email Preview"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
