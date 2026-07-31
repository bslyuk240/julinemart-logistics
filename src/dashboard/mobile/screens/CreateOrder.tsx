import { Calculator, Package, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../../contexts/NotificationContext';
import { supabase } from '../../contexts/AuthContext';
import { formatNaira } from '../lib/orderDisplay';

interface OrderItem {
  id: string;
  productName: string;
  hubId: string;
  quantity: number;
  weight: number;
  price: number;
}

interface Hub {
  id: string;
  name: string;
  code: string;
}

interface ShippingBreakdown {
  hubName: string;
  courierName: string;
  totalWeight: number;
  totalShippingFee: number;
  deliveryTimelineDays: number;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function emptyItem(): OrderItem {
  return { id: Date.now().toString(), productName: '', hubId: '', quantity: 1, weight: 1, price: 0 };
}

// Same /api/hubs, /api/calc-shipping, /api/orders endpoints as CreateOrder.tsx
// (desktop) — the two that needed an admin session were missing their
// Authorization header entirely on desktop too (fixed alongside this build,
// not a mobile-only fix), which is why hub selection never worked before.
export default function MobileCreateOrder() {
  const navigate = useNavigate();
  const notification = useNotification();

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [items, setItems] = useState<OrderItem[]>([emptyItem()]);
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '', address: '', city: '', state: 'Lagos' });
  const [shipping, setShipping] = useState<{ zoneName: string; totalShippingFee: number; subOrders: ShippingBreakdown[] } | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/hubs', { headers: await authHeader() });
        const data = await res.json();
        setHubs(data.data || []);
      } catch {
        // hub list is non-critical to show the rest of the form
      }
    })();
  }, []);

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems((prev) => prev.filter((item) => item.id !== id));
      setShipping(null);
    }
  };
  const updateItem = (id: string, patch: Partial<OrderItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setShipping(null);
  };

  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + (shipping?.totalShippingFee || 0);

  const calculateShipping = async () => {
    if (!customer.state) {
      notification.warning('Missing Information', 'Please enter delivery state');
      return;
    }
    const invalid = items.filter((item) => !item.hubId || item.weight <= 0);
    if (invalid.length > 0) {
      notification.warning('Invalid Items', 'Please assign hubs and weights to all items');
      return;
    }
    setCalculating(true);
    try {
      const res = await fetch('/api/calc-shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryState: customer.state,
          deliveryCity: customer.city,
          items: items.map((item) => ({ hubId: item.hubId, quantity: item.quantity, weight: item.weight })),
          totalOrderValue: subtotal,
        }),
      });
      const result = await res.json();
      if (result.success && result.data) {
        setShipping(result.data);
        notification.success('Shipping Calculated', formatNaira(result.data.totalShippingFee ?? 0));
      } else {
        notification.error('Calculation Failed', result.error || 'Unable to calculate shipping');
      }
    } catch {
      notification.error('Error', 'Failed to calculate shipping');
    } finally {
      setCalculating(false);
    }
  };

  const createOrder = async () => {
    if (!shipping) {
      notification.warning('Calculate Shipping', 'Please calculate shipping first');
      return;
    }
    if (!customer.name || !customer.email || !customer.phone) {
      notification.warning('Missing Information', 'Please fill all customer details');
      return;
    }
    setCreating(true);
    try {
      const orderData = {
        woocommerce_order_id: `TEST-${Date.now()}`,
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
        delivery_address: customer.address,
        delivery_city: customer.city,
        delivery_state: customer.state,
        delivery_country: 'Nigeria',
        delivery_zone: shipping.zoneName,
        subtotal,
        total_amount: total,
        shipping_fee_paid: shipping.totalShippingFee || 0,
        payment_status: 'pending',
        overall_status: 'pending',
        items,
        shipping_breakdown: shipping.subOrders,
      };
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(orderData),
      });
      const data = await res.json();
      if (data.success) {
        notification.success('Order Created!', `Order #${data.data.woocommerce_order_id} created`);
        setTimeout(() => navigate(`/admin/orders/${data.data.id}`), 1200);
      } else {
        notification.error('Creation Failed', data.error || 'Unable to create order');
      }
    } catch {
      notification.error('Error', 'Failed to create order');
    } finally {
      setCreating(false);
    }
  };

  const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm';
  const inputStyle = { fontSize: '16px' } as const;

  return (
    <div className="space-y-4 p-4 pb-8">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Create Order</h1>
        <p className="text-xs text-gray-500">Manual order creation with automatic hub splitting</p>
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3.5">
        <p className="font-mono text-[11px] uppercase tracking-wide text-gray-400">Customer</p>
        <input placeholder="Full name" value={customer.name} onChange={(e) => setCustomer((p) => ({ ...p, name: e.target.value }))} className={inputClass} style={inputStyle} />
        <input placeholder="Email" type="email" value={customer.email} onChange={(e) => setCustomer((p) => ({ ...p, email: e.target.value }))} className={inputClass} style={inputStyle} />
        <input placeholder="Phone" type="tel" value={customer.phone} onChange={(e) => setCustomer((p) => ({ ...p, phone: e.target.value }))} className={inputClass} style={inputStyle} />
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="State" value={customer.state} onChange={(e) => setCustomer((p) => ({ ...p, state: e.target.value }))} className={inputClass} style={inputStyle} />
          <input placeholder="City" value={customer.city} onChange={(e) => setCustomer((p) => ({ ...p, city: e.target.value }))} className={inputClass} style={inputStyle} />
        </div>
        <input placeholder="Delivery address" value={customer.address} onChange={(e) => setCustomer((p) => ({ ...p, address: e.target.value }))} className={inputClass} style={inputStyle} />
      </div>

      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3.5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-wide text-gray-400">Items</p>
          <button type="button" onClick={addItem} className="flex items-center gap-1 text-xs font-semibold text-primary-600">
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        </div>

        {items.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">Item {index + 1}</span>
              {items.length > 1 && (
                <button type="button" onClick={() => removeItem(item.id)} className="text-red-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input placeholder="Product name" value={item.productName} onChange={(e) => updateItem(item.id, { productName: e.target.value })} className={inputClass} style={inputStyle} />
            <select value={item.hubId} onChange={(e) => updateItem(item.id, { hubId: e.target.value })} className={inputClass} style={inputStyle}>
              <option value="">Select hub</option>
              {hubs.map((hub) => (
                <option key={hub.id} value={hub.id}>{hub.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-gray-500">Qty</label>
                <input type="number" min={1} value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: parseInt(e.target.value) || 1 })} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-gray-500">Weight (kg)</label>
                <input type="number" min={0} step={0.1} value={item.weight} onChange={(e) => updateItem(item.id, { weight: parseFloat(e.target.value) || 0 })} className={inputClass} style={inputStyle} />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-gray-500">Price (₦)</label>
                <input type="number" min={0} step={0.01} value={item.price} onChange={(e) => updateItem(item.id, { price: parseFloat(e.target.value) || 0 })} className={inputClass} style={inputStyle} />
              </div>
            </div>
            <p className="text-right font-mono text-xs text-gray-500">Total: {formatNaira(item.price * item.quantity)}</p>
          </div>
        ))}

        <button
          type="button"
          onClick={calculateShipping}
          disabled={calculating}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          <Calculator className="h-4 w-4" />
          {calculating ? 'Calculating…' : 'Calculate shipping'}
        </button>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3.5">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-gray-400">Order Summary</p>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums text-gray-900">{formatNaira(subtotal)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Shipping</span>
            <span className="font-mono tabular-nums text-gray-900">{shipping ? formatNaira(shipping.totalShippingFee) : 'Not calculated'}</span>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-1.5 font-semibold text-gray-900">
            <span>Total</span>
            <span className="font-mono tabular-nums text-primary-600">{formatNaira(total)}</span>
          </div>
        </div>
      </div>

      {shipping && (
        <div className="rounded-lg border border-gray-200 bg-white p-3.5">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-gray-400">Shipping Breakdown — {shipping.zoneName || 'N/A'}</p>
          {shipping.subOrders?.length ? (
            <div className="space-y-2">
              {shipping.subOrders.map((sub, i) => (
                <div key={i} className="rounded-lg bg-gray-50 p-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-gray-900">{sub.hubName || 'Unknown Hub'}</span>
                    <span className="font-mono font-bold text-primary-600">{formatNaira(sub.totalShippingFee)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {sub.courierName || 'N/A'} · {sub.totalWeight}kg · {sub.deliveryTimelineDays ?? 'N/A'} days
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No shipping breakdown available.</p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <button
          type="button"
          onClick={createOrder}
          disabled={!shipping || creating}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Package className="h-4 w-4" />
          {creating ? 'Creating order…' : 'Create order'}
        </button>
        <button type="button" onClick={() => navigate('/admin/orders')} className="w-full rounded-lg border border-gray-200 py-3 text-sm font-semibold text-gray-700">
          Cancel
        </button>
      </div>
    </div>
  );
}
