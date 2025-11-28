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

// Logo URLs - Replace with your actual logo URLs
const JULINEMART_LOGO = 'https://res.cloudinary.com/dupgdbwrt/image/upload/v1759968430/icon-192.png_fukoim.png';
const FEZ_LOGO = 'https://res.cloudinary.com/dupgdbwrt/image/upload/v1764293124/icon-512x512.png_2_er5opu.png';

// Generate simple HTML label
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
      size: 4in 6in;
      margin: 0;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      width: 4in;
      min-height: 6in;
      padding: 8px;
      background: #fff;
    }
    .label-container {
      border: 3px solid #000;
      border-radius: 8px;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%);
      color: white;
    }
    .logo-section {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .logo-img {
      height: 32px;
      width: auto;
      object-fit: contain;
    }
    .logo-fallback {
      font-size: 18px;
      font-weight: bold;
      color: #fff;
    }
    .powered-by {
      text-align: center;
      font-size: 8px;
      color: rgba(255,255,255,0.8);
    }
    .powered-by img {
      height: 20px;
      margin-top: 2px;
    }
    .powered-by-text {
      color: #fbbf24;
      font-weight: bold;
      font-size: 11px;
    }
    .order-info {
      text-align: right;
      font-size: 10px;
    }
    .order-info strong {
      font-size: 12px;
    }
    
    /* Tracking Section */
    .tracking-section {
      background: #f8fafc;
      padding: 12px;
      text-align: center;
      border-bottom: 2px dashed #cbd5e1;
    }
    .tracking-label {
      font-size: 9px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .tracking-number {
      font-size: 28px;
      font-weight: 800;
      font-family: 'Courier New', monospace;
      letter-spacing: 3px;
      color: #0f172a;
      background: #fff;
      padding: 8px 16px;
      border: 2px solid #0f172a;
      border-radius: 4px;
      display: inline-block;
    }
    
    /* Barcode Section */
    .barcode-section {
      padding: 8px 12px;
      text-align: center;
      border-bottom: 2px solid #e2e8f0;
    }
    .barcode {
      display: inline-block;
      background: repeating-linear-gradient(
        90deg,
        #000 0px,
        #000 2px,
        #fff 2px,
        #fff 4px,
        #000 4px,
        #000 5px,
        #fff 5px,
        #fff 8px,
        #000 8px,
        #000 10px,
        #fff 10px,
        #fff 11px
      );
      width: 220px;
      height: 50px;
      border: 1px solid #000;
    }
    .barcode-text {
      font-size: 10px;
      font-family: monospace;
      margin-top: 4px;
      color: #374151;
    }
    
    /* Addresses Section */
    .addresses {
      display: flex;
      flex: 1;
      border-bottom: 2px solid #e2e8f0;
    }
    .address-box {
      flex: 1;
      padding: 12px;
    }
    .address-box:first-child {
      border-right: 2px dashed #cbd5e1;
    }
    .address-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
    }
    .address-header.from {
      color: #059669;
    }
    .address-header.to {
      color: #dc2626;
    }
    .address-icon {
      font-size: 14px;
    }
    .address-name {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .address-detail {
      font-size: 11px;
      color: #475569;
      line-height: 1.4;
      margin-bottom: 2px;
    }
    .address-phone {
      font-size: 11px;
      color: #0369a1;
      font-weight: 600;
      margin-top: 6px;
    }
    
    /* Items Section */
    .items-section {
      padding: 8px 12px;
      background: #f1f5f9;
      border-bottom: 2px solid #e2e8f0;
    }
    .items-label {
      font-size: 9px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .items-text {
      font-size: 11px;
      font-weight: 600;
      color: #334155;
      margin-top: 2px;
    }
    
    /* Footer */
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      background: #f8fafc;
      font-size: 10px;
      color: #475569;
    }
    .footer-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .footer-item strong {
      color: #0f172a;
    }
    .service-badge {
      background: #059669;
      color: white;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: bold;
    }
    
    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
      .label-container {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="label-container">
    <!-- Header -->
    <div class="header">
      <div class="logo-section">
        <img 
          src="${JULINEMART_LOGO}" 
          alt="JulineMart" 
          class="logo-img"
          onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
        />
        <span class="logo-fallback" style="display:none;">JulineMart</span>
      </div>
      
      <div class="powered-by">
        <div>POWERED BY</div>
        <div class="powered-by-text">Fez Delivery</div>
        <img 
          src="${FEZ_LOGO}" 
          alt="Fez Delivery Logo" 
          onerror="this.style.display='none';"
        />
      </div>

      <div class="order-info">
        <div><strong>Order #${order_number}</strong></div>
        <div>${created_date}</div>
      </div>
    </div>

    <!-- Tracking Number -->
    <div class="tracking-section">
      <div class="tracking-label">Tracking Number</div>
      <div class="tracking-number">${tracking_number}</div>
    </div>
    
    <!-- Barcode -->
    <div class="barcode-section">
      <div class="barcode"></div>
      <div class="barcode-text">${tracking_number}</div>
    </div>

    <!-- Addresses -->
    <div class="addresses">
      <!-- Sender -->
      <div class="address-box">
        <div class="address-header from">
          <span class="address-icon">ðŸ“¦</span>
          <span>From (Sender)</span>
        </div>
        <div class="address-name">${sender_name}</div>
        <div class="address-detail">${sender_address}</div>
        <div class="address-detail">${sender_city}</div>
        <div class="address-phone">ðŸ“ž ${sender_phone || 'N/A'}</div>
      </div>

      <!-- Recipient -->
      <div class="address-box">
        <div class="address-header to">
          <span class="address-icon">ðŸ“</span>
          <span>To (Recipient)</span>
        </div>
        <div class="address-name">${recipient_name}</div>
        <div class="address-detail">${recipient_address}</div>
        <div class="address-detail">${recipient_city}, ${recipient_state}</div>
        <div class="address-phone">ðŸ“ž ${recipient_phone}</div>
      </div>
    </div>
    
    <!-- Items -->
    <div class="items-section">
      <div class="items-label">Package Contents</div>
      <div class="items-text">${items}</div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="footer-item">
        <span>âš–ï¸</span>
        <strong>${weight}kg</strong>
      </div>
      <div class="service-badge">STANDARD DELIVERY</div>
      <div class="footer-item">
        <span>ðŸ“…</span>
        <span>Ship Date: ${created_date}</span>
      </div>
    </div>
  </div>

  <script>
    // Auto-print when opened with print=true parameter
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
      sender_phone: subOrder.hubs.phone || '',
      recipient_name: subOrder.orders.customer_name,
      recipient_address: subOrder.orders.delivery_address,
      recipient_city: subOrder.orders.delivery_city,
      recipient_state: subOrder.orders.delivery_state,
      recipient_phone: subOrder.orders.customer_phone,
      items: itemsText.substring(0, 100) + (itemsText.length > 100 ? '...' : ''),
      weight: totalWeight.toFixed(1),
      created_date: new Date(subOrder.orders.created_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
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
