import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../contexts/NotificationContext';
import { supabase } from '../contexts/AuthContext';

const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

interface Hub {
  id: string;
  name: string;
  city: string;
}

const inputClass = 'w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500';

// Ad-hoc waybills with no order or return behind them — e.g. shipping a
// sample or an item to someone who isn't a customer. Dispatched via the
// same Fez/Local Rider lanes as orders, but not tied to the orders table.
export function CreateManualShipmentPage() {
  const navigate = useNavigate();
  const notification = useNotification();

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [senderMode, setSenderMode] = useState<'hub' | 'manual'>('hub');
  const [senderHubId, setSenderHubId] = useState('');
  const [sender, setSender] = useState({ name: '', address: '', city: '', state: 'Lagos', phone: '' });
  const [recipient, setRecipient] = useState({ name: '', address: '', city: '', state: 'Lagos', phone: '', email: '' });
  const [itemDescription, setItemDescription] = useState('');
  const [itemWeight, setItemWeight] = useState(1);
  const [itemValue, setItemValue] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch('/api/hubs', { headers: await authHeader() });
        const data = await response.json();
        setHubs(data.data || []);
      } catch (error) {
        console.error('Error fetching hubs:', error);
      }
    })();
  }, []);

  const createShipment = async () => {
    if (senderMode === 'hub' && !senderHubId) {
      notification.warning('Missing Information', 'Please select a sender hub');
      return;
    }
    if (senderMode === 'manual' && (!sender.name || !sender.address || !sender.state)) {
      notification.warning('Missing Information', 'Please fill sender name, address and state');
      return;
    }
    if (!recipient.name || !recipient.phone || !recipient.address || !recipient.state) {
      notification.warning('Missing Information', 'Please fill all required recipient details');
      return;
    }
    if (!itemDescription) {
      notification.warning('Missing Information', 'Please describe the item being shipped');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch(`${functionsBase}/manual-shipments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          sender_hub_id: senderMode === 'hub' ? senderHubId : undefined,
          sender: senderMode === 'manual' ? sender : undefined,
          recipient,
          item_description: itemDescription,
          item_weight: itemWeight,
          item_value: itemValue,
        }),
      });

      const data = await response.json();
      if (data.success) {
        notification.success('Shipment Created', `${data.data.shipment_code} — ready to dispatch`);
        navigate(`/admin/manual-shipments/${data.data.id}`);
      } else {
        notification.error('Creation Failed', data.error || 'Unable to create shipment');
      }
    } catch (error) {
      console.error('Manual shipment creation error:', error);
      notification.error('Error', 'Failed to create shipment');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Create Manual Shipment</h1>
        <p className="text-gray-600 mt-2">
          Ship an item that isn't tied to a customer order — dispatched via Fez or Local Rider, same as orders.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Sender</h2>
            <div className="flex gap-2 text-sm">
              <button
                onClick={() => setSenderMode('hub')}
                className={senderMode === 'hub' ? 'btn-primary px-3 py-1' : 'btn-secondary px-3 py-1'}
              >
                Pick a hub
              </button>
              <button
                onClick={() => setSenderMode('manual')}
                className={senderMode === 'manual' ? 'btn-primary px-3 py-1' : 'btn-secondary px-3 py-1'}
              >
                Type an address
              </button>
            </div>
          </div>

          {senderMode === 'hub' ? (
            <select value={senderHubId} onChange={(e) => setSenderHubId(e.target.value)} className={inputClass}>
              <option value="">Select hub…</option>
              {hubs.map((hub) => (
                <option key={hub.id} value={hub.id}>{hub.name} — {hub.city}</option>
              ))}
            </select>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                <input value={sender.name} onChange={(e) => setSender({ ...sender, name: e.target.value })} className={inputClass} placeholder="JulineMart Office" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                <input value={sender.phone} onChange={(e) => setSender({ ...sender, phone: e.target.value })} className={inputClass} placeholder="+234 800 000 0000" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Address *</label>
                <input value={sender.address} onChange={(e) => setSender({ ...sender, address: e.target.value })} className={inputClass} placeholder="Pickup address" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
                <input value={sender.city} onChange={(e) => setSender({ ...sender, city: e.target.value })} className={inputClass} placeholder="Ikeja" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">State *</label>
                <input value={sender.state} onChange={(e) => setSender({ ...sender, state: e.target.value })} className={inputClass} placeholder="Lagos" />
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Recipient</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
              <input value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} className={inputClass} placeholder="Recipient's name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone *</label>
              <input value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} className={inputClass} placeholder="+234 800 000 0000" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Email <span className="text-gray-400 font-normal">(optional — tracking updates)</span></label>
              <input type="email" value={recipient.email} onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} className={inputClass} placeholder="recipient@example.com" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Delivery Address *</label>
              <input value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} className={inputClass} placeholder="Where the item is going" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">City</label>
              <input value={recipient.city} onChange={(e) => setRecipient({ ...recipient, city: e.target.value })} className={inputClass} placeholder="Ikeja" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">State *</label>
              <input value={recipient.state} onChange={(e) => setRecipient({ ...recipient, state: e.target.value })} className={inputClass} placeholder="Lagos" />
            </div>
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h2 className="text-xl font-semibold mb-4">Item</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Description *</label>
              <input value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} className={inputClass} placeholder="What's being shipped" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Weight (kg)</label>
              <input type="number" min={0} step={0.1} value={itemWeight} onChange={(e) => setItemWeight(parseFloat(e.target.value) || 0)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Declared Value (₦)</label>
              <input type="number" min={0} step={1} value={itemValue} onChange={(e) => setItemValue(parseFloat(e.target.value) || 0)} className={inputClass} />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={createShipment}
          disabled={creating}
          className="btn-primary flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5 mr-2" />
          {creating ? 'Creating…' : 'Create Shipment'}
        </button>
        <button onClick={() => navigate('/admin/manual-shipments')} className="btn-secondary">
          Cancel
        </button>
      </div>
    </div>
  );
}
