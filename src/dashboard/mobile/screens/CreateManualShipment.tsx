import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { functionsAuthHeader, functionsBase } from '../lib/functionsAuth';

interface Hub {
  id: string;
  name: string;
  city: string;
}

const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none placeholder:text-gray-400';

export default function MobileCreateManualShipment() {
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
        const response = await fetch('/api/hubs', { headers: await functionsAuthHeader() });
        const data = await response.json();
        setHubs(data.data || []);
      } catch {
        // hubs optional for manual sender
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
        headers: { 'Content-Type': 'application/json', ...(await functionsAuthHeader()) },
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
    } catch {
      notification.error('Error', 'Failed to create shipment');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4 p-4 pb-8">
      <button type="button" onClick={() => navigate('/admin/manual-shipments')} className="inline-flex items-center gap-1 text-sm text-gray-500">
        <ArrowLeft className="h-4 w-4" />
        Manual shipments
      </button>

      <div>
        <h1 className="text-lg font-bold text-gray-900">New manual shipment</h1>
        <p className="mt-0.5 text-xs text-gray-500">Ship outside the normal order flow</p>
      </div>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Sender</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSenderMode('hub')}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold ${senderMode === 'hub' ? 'bg-primary-600 text-white' : 'border border-gray-200 text-gray-600'}`}
          >
            Pick a hub
          </button>
          <button
            type="button"
            onClick={() => setSenderMode('manual')}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold ${senderMode === 'manual' ? 'bg-primary-600 text-white' : 'border border-gray-200 text-gray-600'}`}
          >
            Manual address
          </button>
        </div>
        {senderMode === 'hub' ? (
          <select value={senderHubId} onChange={(e) => setSenderHubId(e.target.value)} className={inputClass} style={{ fontSize: '16px' }}>
            <option value="">Select hub…</option>
            {hubs.map((hub) => (
              <option key={hub.id} value={hub.id}>
                {hub.name} — {hub.city}
              </option>
            ))}
          </select>
        ) : (
          <div className="space-y-2">
            <input className={inputClass} placeholder="Sender name *" value={sender.name} onChange={(e) => setSender({ ...sender, name: e.target.value })} style={{ fontSize: '16px' }} />
            <input className={inputClass} placeholder="Phone" value={sender.phone} onChange={(e) => setSender({ ...sender, phone: e.target.value })} style={{ fontSize: '16px' }} />
            <input className={inputClass} placeholder="Address *" value={sender.address} onChange={(e) => setSender({ ...sender, address: e.target.value })} style={{ fontSize: '16px' }} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inputClass} placeholder="City" value={sender.city} onChange={(e) => setSender({ ...sender, city: e.target.value })} style={{ fontSize: '16px' }} />
              <input className={inputClass} placeholder="State *" value={sender.state} onChange={(e) => setSender({ ...sender, state: e.target.value })} style={{ fontSize: '16px' }} />
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Recipient</p>
        <input className={inputClass} placeholder="Full name *" value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value })} style={{ fontSize: '16px' }} />
        <input className={inputClass} placeholder="Phone *" value={recipient.phone} onChange={(e) => setRecipient({ ...recipient, phone: e.target.value })} style={{ fontSize: '16px' }} />
        <input className={inputClass} type="email" placeholder="Email (optional — tracking updates)" value={recipient.email} onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} style={{ fontSize: '16px' }} />
        <input className={inputClass} placeholder="Delivery address *" value={recipient.address} onChange={(e) => setRecipient({ ...recipient, address: e.target.value })} style={{ fontSize: '16px' }} />
        <div className="grid grid-cols-2 gap-2">
          <input className={inputClass} placeholder="City" value={recipient.city} onChange={(e) => setRecipient({ ...recipient, city: e.target.value })} style={{ fontSize: '16px' }} />
          <input className={inputClass} placeholder="State *" value={recipient.state} onChange={(e) => setRecipient({ ...recipient, state: e.target.value })} style={{ fontSize: '16px' }} />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Item</p>
        <input className={inputClass} placeholder="Description *" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} style={{ fontSize: '16px' }} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">Weight (kg)</label>
            <input type="number" min={0} step={0.1} className={inputClass} value={itemWeight} onChange={(e) => setItemWeight(parseFloat(e.target.value) || 0)} style={{ fontSize: '16px' }} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Value (₦)</label>
            <input type="number" min={0} className={inputClass} value={itemValue} onChange={(e) => setItemValue(parseFloat(e.target.value) || 0)} style={{ fontSize: '16px' }} />
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={createShipment}
        disabled={creating}
        className="w-full rounded-xl bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {creating ? 'Creating…' : 'Create shipment'}
      </button>
    </div>
  );
}
