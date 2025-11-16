// Generate Shipping Label PDF
// Creates a branded PDF shipping label with barcode

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Generate simple HTML label (can be converted to PDF using browser print or external service)
function generateLabelHTML(labelData) {
  const {
    tracking_number,
    order_number,
    sender_name,
    sender_address,
    sender_city,
    sender_phone,
    recipient_name,
    recipient_address,
    recipient_city,
    recipient_state,
    recipient_phone,
    items,
    weight,
    created_date,
  } = labelData;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Shipping Label - ${tracking_number}</title>
  <style>
    @page {
      size: A6 landscape;
      margin: 0;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 10px;
      padding: 10mm;
      width: 148mm;
      height: 105mm;
    }
    .label-container {
      border: 2px solid #000;
      padding: 8px;
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 2px solid #000;
      margin-bottom: 8px;
    }
    .logo {
      font-size: 20px;
      font-weight: bold;
      color: #6366f1;
    }
    .fez-logo {
      font-size: 14px;
      color: #f59e0b;
      font-weight: bold;
    }
    .tracking {
      text-align: center;
      margin: 8px 0;
      padding: 8px;
      background: #f3f4f6;
      border-radius: 4px;
    }
    .tracking-number {
      font-size: 24px;
      font-weight: bold;
      font-family: 'Courier New', monospace;
      letter-spacing: 2px;
    }
    .barcode {
      text-align: center;
      margin: 4px 0;
    }
    .barcode-lines {
      display: inline-block;
      background: linear-gradient(90deg, #000 2px, transparent 2px, transparent 4px);
      background-size: 4px 100%;
      width: 200px;
      height: 40px;
      border: 1px solid #000;
    }
    .addresses {
      display: flex;
      gap: 10px;
      margin-top: 8px;
      flex: 1;
    }
    .address-box {
      flex: 1;
      border: 1px solid #000;
      padding: 6px;
    }
    .address-box h3 {
      font-size: 11px;
      font-weight: bold;
      margin-bottom: 4px;
      padding-bottom: 3px;
      border-bottom: 1px solid #ccc;
    }
    .address-box p {
      margin: 2px 0;
      font-size: 9px;
      line-height: 1.3;
    }
    .address-box .name {
      font-weight: bold;
      font-size: 10px;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid #000;
      font-size: 8px;
    }
    .items-list {
      font-size: 8px;
      margin-top: 4px;
    }
    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="label-container">
    <!-- Header -->
    <div class="header">
      <div class="logo">🏪 JulineMart</div>
      <div style="text-align: center;">
        <div style="font-size: 8px; color: #666;">POWERED BY</div>
        <div class="fez-logo">🚚 Fez Delivery</div>
      </div>
      <div style="text-align: right; font-size: 9px;">
        <div><strong>Order:</strong> #${order_number}</div>
        <div>${created_date}</div>
      </div>
    </div>

    <!-- Tracking Number & Barcode -->
    <div class="tracking">
      <div style="font-size: 8px; color: #666; margin-bottom: 2px;">TRACKING NUMBER</div>
      <div class="tracking-number">${tracking_number}</div>
    </div>
    <div class="barcode">
      <div class="barcode-lines"></div>
      <div style="font-size: 7px; margin-top: 2px; font-family: monospace;">${tracking_number}</div>
    </div>

    <!-- Addresses -->
    <div class="addresses">
      <!-- Sender -->
      <div class="address-box">
        <h3>📦 FROM (SENDER)</h3>
        <p class="name">${sender_name}</p>
        <p>${sender_address}</p>
        <p>${sender_city}</p>
        <p>📞 ${sender_phone}</p>
      </div>

      <!-- Recipient -->
      <div class="address-box">
        <h3>📍 TO (RECIPIENT)</h3>
        <p class="name">${recipient_name}</p>
        <p>${recipient_address}</p>
        <p>${recipient_city}, ${recipient_state}</p>
        <p>📞 ${recipient_phone}</p>
      </div>
    </div>

    <!-- Items -->
    <div class="items-list">
      <strong>Items:</strong> ${items}
    </div>

    <!-- Footer -->
    <div class="footer">
      <div><strong>Weight:</strong> ${weight}kg</div>
      <div><strong>Service:</strong> Standard Delivery</div>
      <div><strong>Scan here:</strong> →</div>
    </div>
  </div>

  <script>
    // Auto-print when opened
    window.onload = function() {
      if (window.location.search.includes('print=true')) {
        setTimeout(() => window.print(), 500);
      }
    };
  </script>
</body>
</html>
  `.trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  try {
    // Get sub-order ID from query or body
    let subOrderId;
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      subOrderId = params.get('subOrderId');
    } else {
      const body = JSON.parse(event.body || '{}');
      subOrderId = body.subOrderId;
    }

    if (!subOrderId) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'subOrderId required' }),
      };
    }

    // Get sub-order details
    const { data: subOrder, error: subOrderError } = await supabase
      .from('sub_orders')
      .select(`
        *,
        orders (
          woocommerce_order_id,
          customer_name,
          customer_phone,
          delivery_address,
          delivery_city,
          delivery_state,
          created_at
        ),
        hubs (
          name,
          address,
          city,
          state,
          phone
        )
      `)
      .eq('id', subOrderId)
      .single();

    if (subOrderError || !subOrder) {
      return {
        statusCode: 404,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Sub-order not found' }),
      };
    }

    if (!subOrder.tracking_number) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: 'No tracking number. Create shipment first.',
        }),
      };
    }

    // Prepare label data
    const items = subOrder.items || [];
    const itemsText = items.length > 0
      ? items.map(i => `${i.quantity}x ${i.name}`).join(', ')
      : 'Package';

    const totalWeight = items.reduce((sum, item) => {
      return sum + (Number(item.weight || 0) * Number(item.quantity || 1));
    }, 0);

    const labelData = {
      tracking_number: subOrder.tracking_number,
      order_number: subOrder.orders.woocommerce_order_id,
      sender_name: subOrder.hubs.name,
      sender_address: subOrder.hubs.address,
      sender_city: `${subOrder.hubs.city}, ${subOrder.hubs.state}`,
      sender_phone: subOrder.hubs.phone,
      recipient_name: subOrder.orders.customer_name,
      recipient_address: subOrder.orders.delivery_address,
      recipient_city: subOrder.orders.delivery_city,
      recipient_state: subOrder.orders.delivery_state,
      recipient_phone: subOrder.orders.customer_phone,
      items: itemsText.substring(0, 100) + (itemsText.length > 100 ? '...' : ''),
      weight: totalWeight.toFixed(1),
      created_date: new Date(subOrder.orders.created_at).toLocaleDateString(),
    };

    // Generate HTML
    const labelHTML = generateLabelHTML(labelData);

    // Return HTML (can be printed as PDF by browser)
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'text/html',
      },
      body: labelHTML,
    };
  } catch (error) {
    console.error('Error generating label:', error);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Failed to generate label',
        message: error.message,
      }),
    };
  }
};