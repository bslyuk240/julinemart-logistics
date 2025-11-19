import { Calculator, Package, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../contexts/NotificationContext';

interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  vendorId: string;
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
  hubId: string;
  hubName: string;
  courierId: string;
  courierName: string;
  totalWeight: number;
  baseRate: number;
  additionalWeightCharge: number;
  subtotal: number;
  vat: number;
  totalShippingFee: number;
  deliveryTimelineDays: number;
  items?: any[];
}

export function CreateOrderPage() {
  const navigate = useNavigate();
  const notification = useNotification();

  const [hubs, setHubs] = useState<Hub[]>([]);
  const [items, setItems] = useState<OrderItem[]>([
    {
      id: '1',
      productId: '',
      productName: '',
      vendorId: '',
      hubId: '',
      quantity: 1,
      weight: 1,
      price: 0,
    },
  ]);

  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: 'Lagos',
    country: 'Nigeria',
  });

  const [shippingCalculation, setShippingCalculation] = useState<{
    zoneName: string;
    totalShippingFee: number;
    subOrders: ShippingBreakdown[];
  } | null>(null);

  const [calculating, setCalculating] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchHubs();
  }, []);

  const fetchHubs = async () => {
    try {
      const response = await fetch('/api/hubs');
      const data = await response.json();
      setHubs(data.data || []);
    } catch (error) {
      console.error('Error fetching hubs:', error);
    }
  };

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        productId: '',
        productName: '',
        vendorId: '',
        hubId: '',
        quantity: 1,
        weight: 1,
        price: 0,
      },
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(item => item.id !== id));
      setShippingCalculation(null);
    }
  };

  const updateItem = (id: string, field: keyof OrderItem, value: any) => {
    setItems(
      items.map(item => (item.id === id ? { ...item, [field]: value } : item))
    );
    setShippingCalculation(null);
  };

  const calculateSubtotal = () => {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  };

  // ✅ Safe helper function to format currency
  const formatCurrency = (value: any): string => {
    const num = Number(value);
    return isNaN(num)
      ? '0'
      : num.toLocaleString('en-NG', { minimumFractionDigits: 0 });
  };

  const calculateShipping = async () => {
    if (!customerInfo.state) {
      notification.warning(
        'Missing Information',
        'Please enter delivery state'
      );
      return;
    }

    const invalidItems = items.filter(item => !item.hubId || item.weight <= 0);
    if (invalidItems.length > 0) {
      notification.warning(
        'Invalid Items',
        'Please assign hubs and weights to all items'
      );
      return;
    }

    setCalculating(true);

    try {
      const response = await fetch('/api/calc-shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryState: customerInfo.state,
          deliveryCity: customerInfo.city,
          items: items.map(item => ({
            productId: item.productId,
            vendorId: item.vendorId,
            hubId: item.hubId,
            quantity: item.quantity,
            weight: item.weight,
          })),
          totalOrderValue: calculateSubtotal(),
        }),
      });

      const result = await response.json();
      console.log('Shipping API response:', result);

      if (result.success && result.data) {
        setShippingCalculation(result.data);
        const shippingTotal = result.data.totalShippingFee ?? 0;
        notification.success(
          'Shipping Calculated',
          `Total: ₦${formatCurrency(shippingTotal)}`
        );
      } else {
        notification.error(
          'Calculation Failed',
          result.error || 'Unable to calculate shipping'
        );
      }
    } catch (error) {
      console.error('Shipping calculation error:', error);
      notification.error('Error', 'Failed to calculate shipping');
    } finally {
      setCalculating(false);
    }
  };

  const createOrder = async () => {
    if (!shippingCalculation) {
      notification.warning(
        'Calculate Shipping',
        'Please calculate shipping first'
      );
      return;
    }

    if (!customerInfo.name || !customerInfo.email || !customerInfo.phone) {
      notification.warning(
        'Missing Information',
        'Please fill all customer details'
      );
      return;
    }

    setCreating(true);

    try {
      const orderData = {
        woocommerce_order_id: `TEST-${Date.now()}`,
        customer_name: customerInfo.name,
        customer_email: customerInfo.email,
        customer_phone: customerInfo.phone,
        delivery_address: customerInfo.address,
        delivery_city: customerInfo.city,
        delivery_state: customerInfo.state,
        delivery_country: customerInfo.country,
        delivery_zone: shippingCalculation.zoneName,
        subtotal: calculateSubtotal(),
        total_amount:
          calculateSubtotal() + (shippingCalculation.totalShippingFee || 0),
        shipping_fee_paid: shippingCalculation.totalShippingFee || 0,
        payment_status: 'pending',
        overall_status: 'pending',
        items: items,
        shipping_breakdown: shippingCalculation.subOrders,
      };

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
      });

      const data = await response.json();

      if (data.success) {
        notification.success(
          'Order Created!',
          `Order #${data.data.woocommerce_order_id} created successfully`
        );
        setTimeout(() => {
          navigate(`/admin/orders/${data.data.id}`);
        }, 1500);
      } else {
        notification.error(
          'Creation Failed',
          data.error || 'Unable to create order'
        );
      }
    } catch (error) {
      console.error('Order creation error:', error);
      notification.error('Error', 'Failed to create order');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Create Order</h1>
        <p className="text-gray-600 mt-2">
          Manual order creation with automatic hub splitting
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Order Items & Customer Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Information */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Customer Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={customerInfo.name}
                  onChange={e =>
                    setCustomerInfo({ ...customerInfo, name: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={customerInfo.email}
                  onChange={e =>
                    setCustomerInfo({ ...customerInfo, email: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone *
                </label>
                <input
                  type="tel"
                  value={customerInfo.phone}
                  onChange={e =>
                    setCustomerInfo({ ...customerInfo, phone: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="+234 800 000 0000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  State *
                </label>
                <input
                  type="text"
                  value={customerInfo.state}
                  onChange={e =>
                    setCustomerInfo({ ...customerInfo, state: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Lagos"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  City
                </label>
                <input
                  type="text"
                  value={customerInfo.city}
                  onChange={e =>
                    setCustomerInfo({ ...customerInfo, city: e.target.value })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="Ikeja"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Delivery Address *
                </label>
                <input
                  type="text"
                  value={customerInfo.address}
                  onChange={e =>
                    setCustomerInfo({
                      ...customerInfo,
                      address: e.target.value,
                    })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder="123 Main Street"
                />
              </div>
            </div>
          </div>

          {/* Order Items */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Order Items</h2>
              <button
                onClick={addItem}
                className="btn-secondary flex items-center text-sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </button>
            </div>

            <div className="space-y-4">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="p-4 border border-gray-200 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-gray-900">
                      Item {index + 1}
                    </span>
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Product Name
                      </label>
                      <input
                        type="text"
                        value={item.productName}
                        onChange={e =>
                          updateItem(item.id, 'productName', e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                        placeholder="Product name"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Fulfillment Hub *
                      </label>
                      <select
                        value={item.hubId}
                        onChange={e =>
                          updateItem(item.id, 'hubId', e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      >
                        <option value="">Select Hub</option>
                        {hubs.map(hub => (
                          <option key={hub.id} value={hub.id}>
                            {hub.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Quantity
                      </label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={e =>
                          updateItem(
                            item.id,
                            'quantity',
                            parseInt(e.target.value) || 1
                          )
                        }
                        min="1"
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Weight (kg) *
                      </label>
                      <input
                        type="number"
                        value={item.weight}
                        onChange={e =>
                          updateItem(
                            item.id,
                            'weight',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        min="0"
                        step="0.1"
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Price (₦)
                      </label>
                      <input
                        type="number"
                        value={item.price}
                        onChange={e =>
                          updateItem(
                            item.id,
                            'price',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        min="0"
                        step="0.01"
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                      />
                    </div>

                    <div className="flex items-end">
                      <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm">
                        Total: ₦{formatCurrency(item.price * item.quantity)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={calculateShipping}
              disabled={calculating}
              className="w-full mt-4 btn-primary flex items-center justify-center"
            >
              <Calculator className="w-5 h-5 mr-2" />
              {calculating ? 'Calculating...' : 'Calculate Shipping'}
            </button>
          </div>
        </div>

        {/* Right Column - Order Summary */}
        <div className="space-y-6">
          {/* Pricing Summary */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Order Summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">
                  ₦{formatCurrency(calculateSubtotal())}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Shipping</span>
                <span className="font-medium">
                  {shippingCalculation
                    ? `₦${formatCurrency(shippingCalculation.totalShippingFee)}`
                    : 'Not calculated'}
                </span>
              </div>
              <div className="pt-3 border-t flex justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-bold text-lg text-primary-600">
                  ₦
                  {formatCurrency(
                    calculateSubtotal() +
                      (shippingCalculation?.totalShippingFee || 0)
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Shipping Breakdown */}
          {shippingCalculation && (
            <div className="card">
              <h2 className="text-xl font-semibold mb-4">Shipping Breakdown</h2>
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="text-gray-600">Destination Zone:</span>
                  <span className="ml-2 font-medium">
                    {shippingCalculation.zoneName || 'N/A'}
                  </span>
                </div>

                {shippingCalculation.subOrders &&
                shippingCalculation.subOrders.length > 0 ? (
                  shippingCalculation.subOrders.map((sub, index) => (
                    <div key={index} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">
                          {sub.hubName || 'Unknown Hub'}
                        </span>
                        <span className="text-sm font-bold text-primary-600">
                          ₦{formatCurrency(sub.totalShippingFee)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 space-y-1">
                        <div>Courier: {sub.courierName || 'N/A'}</div>
                        <div>Weight: {formatCurrency(sub.totalWeight)}kg</div>
                        <div>
                          Delivery: {sub.deliveryTimelineDays || 'N/A'} days
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-gray-500">
                    No shipping breakdown available
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={createOrder}
              disabled={!shippingCalculation || creating}
              className="w-full btn-primary flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Package className="w-5 h-5 mr-2" />
              {creating ? 'Creating Order...' : 'Create Order'}
            </button>
            <button
              onClick={() => navigate('/admin/orders')}
              className="w-full btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
