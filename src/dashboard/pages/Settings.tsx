import { useState } from 'react';
import { 
  Settings, Book, Webhook, Key, Database, Server, Code, 
  ExternalLink, Copy, Check, FileText, Zap
} from 'lucide-react';
import { useNotification } from '../contexts/NotificationContext';

type TabType = 'documentation' | 'webhooks' | 'api' | 'database';

export function SettingsPage() {
  const notification = useNotification();
  const [activeTab, setActiveTab] = useState<TabType>('documentation');
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(label);
    notification.success('Copied!', `${label} copied to clipboard`);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  const tabs = [
    { id: 'documentation', label: 'Documentation', icon: Book },
    { id: 'webhooks', label: 'Webhooks', icon: Webhook },
    { id: 'api', label: 'API Reference', icon: Key },
    { id: 'database', label: 'Database', icon: Database },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Settings className="w-8 h-8 text-primary-600" />
          System Settings & Documentation
        </h1>
        <p className="text-gray-600 mt-2">
          API documentation, webhooks, and system configuration
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-4">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`
                  flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors
                  ${isActive 
                    ? 'border-primary-600 text-primary-600' 
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
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

      {/* Tab Content */}
      <div>
        {activeTab === 'documentation' && <DocumentationTab copyToClipboard={copyToClipboard} copiedItem={copiedItem} />}
        {activeTab === 'webhooks' && <WebhooksTab copyToClipboard={copyToClipboard} copiedItem={copiedItem} />}
        {activeTab === 'api' && <APIReferenceTab copyToClipboard={copyToClipboard} copiedItem={copiedItem} />}
        {activeTab === 'database' && <DatabaseTab copyToClipboard={copyToClipboard} copiedItem={copiedItem} />}
      </div>
    </div>
  );
}

// Documentation Tab Component
function DocumentationTab({ copyToClipboard, copiedItem }: any) {
  return (
    <div className="space-y-6">
      {/* Quick Start */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
          <Zap className="w-6 h-6 text-yellow-500" />
          Quick Start Guide
        </h2>
        
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-lg mb-2">1. System Overview</h3>
            <p className="text-gray-700 mb-3">
              JulineMart Logistics Orchestrator (JLO) is a multi-hub logistics management system 
              that automatically splits orders by fulfillment hub, calculates shipping rates, 
              and integrates with courier partners.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-2">2. Core Features</h3>
            <ul className="list-disc list-inside space-y-2 text-gray-700 ml-4">
              <li>Automatic order splitting across multiple hubs (Warri, Lagos, Abuja)</li>
              <li>Weight-based shipping calculation with VAT</li>
              <li>Live courier API integration (Fez, GIGL, Kwik)</li>
              <li>Real-time tracking and status updates</li>
              <li>Role-based access control (Admin, Manager, Viewer)</li>
              <li>Activity logging and audit trails</li>
              <li>WooCommerce webhook integration</li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-2">3. Workflow</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <pre className="text-sm text-gray-800 whitespace-pre-wrap font-mono">
{`Order Received (WooCommerce)
    ↓
Split by Hub (Automatic)
    ↓
Calculate Shipping (Weight-based + VAT)
    ↓
Create Sub-Orders (One per hub)
    ↓
Assign Couriers (Based on rates)
    ↓
Create Shipment (via Courier API)
    ↓
Live Tracking (Real-time updates)
    ↓
Delivery Confirmation`}
              </pre>
            </div>
          </div>
        </div>
      </div>

      {/* Key Concepts */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Key Concepts</h2>
        
        <div className="space-y-4">
          <div className="border-l-4 border-blue-500 pl-4">
            <h3 className="font-semibold text-lg">Orders & Sub-Orders</h3>
            <p className="text-gray-700 mt-2">
              When a customer places an order, the system automatically splits it into sub-orders 
              based on which hub fulfills each item. Each sub-order is assigned its own courier 
              and tracking number.
            </p>
          </div>

          <div className="border-l-4 border-green-500 pl-4">
            <h3 className="font-semibold text-lg">Shipping Zones</h3>
            <p className="text-gray-700 mt-2">
              Nigeria is divided into 6 shipping zones (South-South, South-West, South-East, 
              North-Central, North-West, North-East). Rates are configured per hub-zone-courier combination.
            </p>
          </div>

          <div className="border-l-4 border-purple-500 pl-4">
            <h3 className="font-semibold text-lg">Courier Integration</h3>
            <p className="text-gray-700 mt-2">
              API integration allows automatic shipment creation on courier platforms, real-time 
              tracking updates, and shipping label generation. Configure credentials in Courier Settings.
            </p>
          </div>
        </div>
      </div>

      {/* Environment Setup */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Environment Variables</h2>
        <div className="bg-gray-900 text-gray-100 p-4 rounded-lg">
          <pre className="text-sm font-mono whitespace-pre-wrap">
{`# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Server Configuration
PORT=3001
NODE_ENV=production

# Optional: Courier API Keys (configured in UI)
# FEZ_API_KEY=configured_in_courier_settings
# GIGL_API_KEY=configured_in_courier_settings`}
          </pre>
        </div>
      </div>

      {/* Links */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">External Resources</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
            <a
            href="https://github.com/yourusername/julinemart-logistics"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
          >
            <Code className="w-6 h-6 text-gray-600" />
            <div>
              <div className="font-semibold">GitHub Repository</div>
              <div className="text-sm text-gray-600">View source code</div>
            </div>
            <ExternalLink className="w-4 h-4 ml-auto text-gray-400" />
          </a>

          
            <a
            href="https://docs.supabase.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
          >
            <Database className="w-6 h-6 text-gray-600" />
            <div>
              <div className="font-semibold">Supabase Docs</div>
              <div className="text-sm text-gray-600">Database documentation</div>
            </div>
            <ExternalLink className="w-4 h-4 ml-auto text-gray-400" />
          </a>

          
            <a
            href="https://fezdispatch.com/api-docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
          >
            <FileText className="w-6 h-6 text-gray-600" />
            <div>
              <div className="font-semibold">Fez API Docs</div>
              <div className="text-sm text-gray-600">Courier API reference</div>
            </div>
            <ExternalLink className="w-4 h-4 ml-auto text-gray-400" />
          </a>

          
            <a
            href="/COURIER_INTEGRATION_GUIDE.md"
            target="_blank"
            className="flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-colors"
          >
            <Book className="w-6 h-6 text-gray-600" />
            <div>
              <div className="font-semibold">Integration Guide</div>
              <div className="text-sm text-gray-600">Courier setup guide</div>
            </div>
            <ExternalLink className="w-4 h-4 ml-auto text-gray-400" />
          </a>
        </div>
      </div>
    </div>
  );
}

// Webhooks Tab Component
function WebhooksTab({ copyToClipboard, copiedItem }: any) {
  const webhookUrl = `${window.location.origin.replace('3000', '3001')}/api/webhooks/woocommerce`;

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">WooCommerce Webhook Configuration</h2>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-900">
            Configure this webhook in your WooCommerce store to automatically sync orders to JLO.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Webhook URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={webhookUrl}
                readOnly
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"
              />
              <button
                onClick={() => copyToClipboard(webhookUrl, 'Webhook URL')}
                className="btn-secondary flex items-center gap-2"
              >
                {copiedItem === 'Webhook URL' ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Topic
              </label>
              <input
                type="text"
                value="order.created"
                readOnly
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Delivery Method
              </label>
              <input
                type="text"
                value="POST"
                readOnly
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Setup Instructions */}
      <div className="card">
        <h2 className="text-xl font-bold mb-4">Setup Instructions</h2>
        
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold">
              1
            </div>
            <div>
              <p className="font-medium">Log in to WooCommerce Admin</p>
              <p className="text-sm text-gray-600">Navigate to WooCommerce → Settings → Advanced → Webhooks</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold">
              2
            </div>
            <div>
              <p className="font-medium">Create New Webhook</p>
              <p className="text-sm text-gray-600">Click "Add webhook" button</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold">
              3
            </div>
            <div>
              <p className="font-medium">Configure Settings</p>
              <ul className="text-sm text-gray-600 list-disc list-inside ml-4">
                <li>Name: JulineMart Logistics Orchestrator</li>
                <li>Status: Active</li>
                <li>Topic: Order created</li>
                <li>Delivery URL: Copy URL from above</li>
                <li>API Version: WP REST API v3</li>
              </ul>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center font-bold">
              4
            </div>
            <div>
              <p className="font-medium">Save & Test</p>
              <p className="text-sm text-gray-600">Click "Save webhook" and test by creating a test order</p>
            </div>
          </div>
        </div>
      </div>

      {/* Webhook Payload Example */}
      <div className="card">
        <h2 className="text-xl font-bold mb-4">Expected Webhook Payload</h2>
        <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
          <pre className="text-xs font-mono">
{`{
  "id": 12345,
  "number": "12345",
  "status": "processing",
  "customer": {
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe"
  },
  "billing": {
    "phone": "+234 800 000 0000",
    "address_1": "123 Main Street",
    "city": "Lagos",
    "state": "Lagos"
  },
  "shipping": {
    "address_1": "123 Main Street",
    "city": "Lagos",
    "state": "Lagos"
  },
  "line_items": [
    {
      "id": 1,
      "product_id": 101,
      "name": "Product Name",
      "quantity": 2,
      "total": "5000.00"
    }
  ],
  "total": "7500.00",
  "shipping_total": "2500.00"
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

// API Reference Tab Component
function APIReferenceTab({ copyToClipboard, copiedItem }: any) {
  const baseUrl = window.location.origin.replace('3000', '3001');

  const endpoints = [
    {
      category: 'Orders',
      items: [
        { method: 'GET', path: '/api/orders', description: 'List all orders' },
        { method: 'GET', path: '/api/orders/:id', description: 'Get order details' },
        { method: 'POST', path: '/api/orders', description: 'Create new order' },
        { method: 'PUT', path: '/api/orders/:id/status', description: 'Update order status' },
      ]
    },
    {
      category: 'Shipping',
      items: [
        { method: 'POST', path: '/api/calc-shipping', description: 'Calculate shipping cost' },
        { method: 'GET', path: '/api/zones/:state', description: 'Get zone for state' },
        { method: 'GET', path: '/api/shipping-rates', description: 'List shipping rates' },
      ]
    },
    {
      category: 'Courier Integration',
      items: [
        { method: 'POST', path: '/api/courier/create-shipment', description: 'Create shipment on courier platform' },
        { method: 'GET', path: '/api/courier/tracking/:subOrderId', description: 'Get live tracking' },
        { method: 'GET', path: '/api/courier/label/:subOrderId', description: 'Generate shipping label' },
      ]
    },
    {
      category: 'Admin',
      items: [
        { method: 'GET', path: '/api/hubs', description: 'List fulfillment hubs' },
        { method: 'GET', path: '/api/couriers', description: 'List courier partners' },
        { method: 'GET', path: '/api/stats', description: 'Get dashboard statistics' },
        { method: 'GET', path: '/api/users', description: 'List users (admin only)' },
        { method: 'GET', path: '/api/activity-logs', description: 'Get activity logs (admin/manager)' },
      ]
    },
  ];

  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: 'bg-blue-100 text-blue-800',
      POST: 'bg-green-100 text-green-800',
      PUT: 'bg-yellow-100 text-yellow-800',
      DELETE: 'bg-red-100 text-red-800',
    };
    return colors[method] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">API Base URL</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={baseUrl}
            readOnly
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 font-mono"
          />
          <button
            onClick={() => copyToClipboard(baseUrl, 'Base URL')}
            className="btn-secondary flex items-center gap-2"
          >
            {copiedItem === 'Base URL' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {endpoints.map((category) => (
        <div key={category.category} className="card">
          <h2 className="text-xl font-bold mb-4">{category.category}</h2>
          <div className="space-y-2">
            {category.items.map((endpoint, index) => (
              <div
                key={index}
                className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <span className={`px-3 py-1 rounded text-xs font-bold ${getMethodColor(endpoint.method)}`}>
                  {endpoint.method}
                </span>
                <code className="flex-1 text-sm font-mono text-gray-700">{endpoint.path}</code>
                <span className="text-sm text-gray-600">{endpoint.description}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Example Request */}
      <div className="card">
        <h2 className="text-xl font-bold mb-4">Example API Call</h2>
        <div className="bg-gray-900 text-gray-100 p-4 rounded-lg">
          <pre className="text-sm font-mono whitespace-pre-wrap">
{`// Calculate Shipping
fetch('${baseUrl}/api/calc-shipping', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    deliveryState: 'Lagos',
    deliveryCity: 'Ikeja',
    items: [
      {
        productId: 'PROD-001',
        vendorId: 'VENDOR-1',
        hubId: 'hub-uuid',
        quantity: 2,
        weight: 1.5
      }
    ],
    totalOrderValue: 50000
  })
})
.then(res => res.json())
.then(data => console.log(data));`}
          </pre>
        </div>
      </div>
    </div>
  );
}

// Database Tab Component
function DatabaseTab({ copyToClipboard, copiedItem }: any) {
  const tables = [
    { name: 'orders', description: 'Main orders table', records: 'Customer orders from WooCommerce' },
    { name: 'sub_orders', description: 'Split orders by hub', records: 'One per hub per order' },
    { name: 'hubs', description: 'Fulfillment centers', records: 'Warri, Lagos, Abuja' },
    { name: 'couriers', description: 'Delivery partners', records: 'Fez, GIGL, Kwik' },
    { name: 'zones', description: 'Shipping zones', records: '6 zones across Nigeria' },
    { name: 'shipping_rates', description: 'Rate configurations', records: 'Hub-Zone-Courier combinations' },
    { name: 'users', description: 'System users', records: 'Admin, Manager, Viewer roles' },
    { name: 'activity_logs', description: 'Audit trail', records: 'All system actions logged' },
    { name: 'tracking_events', description: 'Shipment tracking', records: 'Status updates per sub-order' },
  ];

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Database Schema</h2>
        <div className="space-y-3">
          {tables.map((table) => (
            <div
              key={table.name}
              className="p-4 border border-gray-200 rounded-lg hover:border-primary-300"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-mono font-semibold text-lg text-gray-900">{table.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{table.description}</p>
                  <p className="text-xs text-gray-500 mt-1">{table.records}</p>
                </div>
                <Database className="w-5 h-5 text-gray-400" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connection Info */}
      <div className="card">
        <h2 className="text-xl font-bold mb-4">Database Connection</h2>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-900">
            Database connection details are configured via environment variables. 
            Never expose your SUPABASE_SERVICE_ROLE_KEY publicly.
          </p>
        </div>
      </div>

      {/* Backup Instructions */}
      <div className="card">
        <h2 className="text-xl font-bold mb-4">Backup & Restore</h2>
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold mb-2">Create Backup</h3>
            <p className="text-sm text-gray-700 mb-2">Via Supabase Dashboard:</p>
            <ol className="text-sm text-gray-600 list-decimal list-inside ml-4 space-y-1">
              <li>Go to Supabase Dashboard</li>
              <li>Select your project</li>
              <li>Navigate to Database → Backups</li>
              <li>Click "Create backup"</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
