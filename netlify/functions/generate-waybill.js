// Generate Waybill
// Renders JulineMart's own formal shipping waybill for either a dispatched
// sub-order (?subOrderId=) or a dispatched return pickup (?returnShipmentId=)
// — distinct from generate-label.js's small QR sticker.
// Same server-rendered-HTML + ?print=true pattern as generate-label.js,
// so the frontend can open it the same way (window.open, no fetch/JSON).

import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { resolveSender } from './services/resolveSender.js';
import { assertWaybillAccess } from './services/shipmentAccess.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const JULINEMART_LOGO = 'https://res.cloudinary.com/dupgdbwrt/image/upload/v1759968430/icon-192.png_fukoim.png';

// Courier-agnostic by construction: adding a future lane (e.g. an
// in-house fleet) is one new entry here, not a new branch anywhere else.
const LANE_INFO = {
  fez: (subOrder) => ({
    label: 'Fez Delivery',
    referenceLabel: 'Fez Tracking #',
    referenceValue: subOrder.tracking_number || subOrder.courier_waybill || '—',
    trackingUrl: subOrder.courier_tracking_url || null,
  }),
  local_rider: (subOrder) => ({
    label: 'Local Rider',
    referenceLabel: 'Rider',
    referenceValue: [subOrder.delivery_person_name, subOrder.delivery_person_phone]
      .filter(Boolean)
      .join(' · ') || '—',
    trackingUrl: null,
  }),
};

function getLaneInfo(subOrder) {
  const lane = subOrder?.metadata?.selected_lane === 'local_rider' ? 'local_rider' : 'fez';
  return LANE_INFO[lane](subOrder);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Generate a JLO waybill number for a row if it doesn't have one yet, and
// persist it. Shared self-healing fallback used by both branches below —
// dispatch already generates this eagerly, but this covers anything
// dispatched before this feature shipped, plus any failed eager attempt.
async function ensureWaybillNumber(table, row) {
  let waybillNumber = row.waybill_number || null;
  if (waybillNumber) return waybillNumber;

  const { data: nextNumber, error: rpcError } = await supabase.rpc('next_waybill_number');
  if (rpcError) {
    console.error('waybill number generation failed:', rpcError);
    return null;
  }

  waybillNumber = nextNumber;
  const { error: updateError } = await supabase
    .from(table)
    .update({ waybill_number: waybillNumber })
    .eq('id', row.id)
    .is('waybill_number', null);
  if (updateError) {
    console.error('failed to persist waybill number:', updateError);
  }
  return waybillNumber;
}

async function loadOrderWaybillData(subOrderId) {
  const { data: subOrder, error: subOrderError } = await supabase
    .from('sub_orders')
    .select(`
      *,
      orders (
        order_number,
        customer_name,
        customer_email,
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
        phone,
        is_sub_hub,
        parent_hub_id,
        parent_hub:hubs!parent_hub_id (
          name,
          address,
          city,
          state,
          phone
        )
      ),
      vendors (
        fez_collection_method,
        store_name,
        address,
        city,
        state,
        phone,
        approved_vendor_locations (
          fez_hub_name,
          fez_hub_address,
          courier_hubs ( name, address, city, state, phone )
        )
      ),
      couriers ( name, code )
    `)
    .eq('id', subOrderId)
    .single();

  if (subOrderError || !subOrder) {
    return { error: { statusCode: 404, body: { success: false, error: 'Sub-order not found' } } };
  }

  if (!subOrder.tracking_number) {
    return {
      error: {
        statusCode: 400,
        body: { success: false, error: 'This shipment has not been dispatched yet — dispatch it first.' },
      },
    };
  }

  const waybillNumber = await ensureWaybillNumber('sub_orders', subOrder);
  if (!waybillNumber) {
    return { error: { statusCode: 500, body: { success: false, error: 'Could not generate a waybill number' } } };
  }

  const sender = resolveSender(subOrder);
  const items = subOrder.items || [];
  const totalWeight = items.reduce((sum, i) => sum + (Number(i.weight || 0) * Number(i.quantity || 1)), 0);
  const totalValue = items.reduce((sum, i) => sum + (Number(i.price || 0) * Number(i.quantity || 1)), 0);

  return {
    waybillData: {
      waybill_number: waybillNumber,
      reference_label: 'Order #',
      order_number: subOrder.orders?.order_number ?? '—',
      status: subOrder.status || 'assigned',
      created_date: new Date(subOrder.orders?.created_at || subOrder.created_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      sender,
      recipient: {
        name: subOrder.orders?.customer_name || '',
        address: subOrder.orders?.delivery_address || '',
        city: subOrder.orders?.delivery_city || '',
        state: subOrder.orders?.delivery_state || '',
        phone: subOrder.orders?.customer_phone || '',
      },
      items,
      total_weight: totalWeight,
      total_value: totalValue,
      laneInfo: getLaneInfo(subOrder),
    },
  };
}

// Return pickups are the reverse of an order shipment: the CUSTOMER is the
// sender and the hub/vendor destination (already stored on the row as
// destination_address) is the recipient. A return request is whole-order,
// not itemized, so items come from a separate order_items lookup filtered
// to whichever destination group this shipment belongs to.
async function loadReturnWaybillData(returnShipmentId) {
  const { data: shipment, error: shipmentError } = await supabase
    .from('return_shipments')
    .select(`
      *,
      return_requests (
        customer_name,
        customer_email,
        supabase_order_id
      )
    `)
    .eq('id', returnShipmentId)
    .single();

  if (shipmentError || !shipment) {
    return { error: { statusCode: 404, body: { success: false, error: 'Return shipment not found' } } };
  }

  if (!shipment.fez_tracking) {
    return {
      error: {
        statusCode: 400,
        body: { success: false, error: 'This return has not been dispatched yet.' },
      },
    };
  }

  const waybillNumber = await ensureWaybillNumber('return_shipments', shipment);
  if (!waybillNumber) {
    return { error: { statusCode: 500, body: { success: false, error: 'Could not generate a waybill number' } } };
  }

  const orderId = shipment.return_requests?.supabase_order_id;
  let order = null;
  let items = [];

  if (orderId) {
    const [{ data: orderData }, { data: itemsData }] = await Promise.all([
      supabase
        .from('orders')
        .select('order_number, customer_phone, delivery_address, delivery_city, delivery_state')
        .eq('id', orderId)
        .single(),
      supabase
        .from('order_items')
        .select('product_name, product_sku, quantity, unit_price, vendor_id')
        .eq('order_id', orderId),
    ]);
    order = orderData;

    const wantVendorId = shipment.destination_type === 'vendor' ? shipment.vendor_id : null;
    items = (itemsData || [])
      .filter((i) => (wantVendorId ? i.vendor_id === wantVendorId : !i.vendor_id))
      .map((i) => ({
        sku: i.product_sku,
        name: i.product_name,
        quantity: i.quantity,
        price: i.unit_price,
        weight: 0, // order_items has no weight column — not available for returns
      }));
  }

  const destination = shipment.destination_address || {};
  const totalValue = items.reduce((sum, i) => sum + (Number(i.price || 0) * Number(i.quantity || 1)), 0);

  return {
    waybillData: {
      waybill_number: waybillNumber,
      reference_label: 'Return #',
      order_number: shipment.return_code,
      status: shipment.status || 'pending',
      created_date: new Date(shipment.created_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      sender: {
        name: shipment.return_requests?.customer_name || 'Customer',
        address: order?.delivery_address || '',
        city: order?.delivery_city || '',
        state: order?.delivery_state || '',
        phone: order?.customer_phone || '',
      },
      recipient: {
        name: destination.name || 'JulineMart',
        address: destination.address || '',
        city: destination.city || '',
        state: destination.state || '',
        phone: destination.phone || '',
      },
      items,
      total_weight: 0,
      total_value: totalValue,
      laneInfo: {
        label: 'Fez Delivery (Return Pickup)',
        referenceLabel: 'Fez Tracking #',
        referenceValue: shipment.fez_tracking,
        trackingUrl: `https://web.fezdelivery.co/track-delivery?tracking=${shipment.fez_tracking}`,
      },
    },
  };
}

// Manual shipments — ad-hoc waybills with no order or return behind them.
// Column names deliberately mirror sub_orders, so getLaneInfo() below
// works unchanged, and sender/recipient are already stored in the exact
// {name,address,city,state,phone} shape the renderer expects.
async function loadManualShipmentWaybillData(shipmentId) {
  const { data: shipment, error } = await supabase
    .from('manual_shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  if (error || !shipment) {
    return { error: { statusCode: 404, body: { success: false, error: 'Manual shipment not found' } } };
  }

  if (!shipment.tracking_number) {
    return {
      error: {
        statusCode: 400,
        body: { success: false, error: 'This shipment has not been dispatched yet — dispatch it first.' },
      },
    };
  }

  const waybillNumber = await ensureWaybillNumber('manual_shipments', shipment);
  if (!waybillNumber) {
    return { error: { statusCode: 500, body: { success: false, error: 'Could not generate a waybill number' } } };
  }

  return {
    waybillData: {
      waybill_number: waybillNumber,
      reference_label: 'Shipment #',
      order_number: shipment.shipment_code,
      status: shipment.status || 'pending',
      created_date: new Date(shipment.created_at).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      sender: shipment.sender || { name: 'JulineMart', address: '', city: '', state: '', phone: '' },
      recipient: shipment.recipient || { name: '', address: '', city: '', state: '', phone: '' },
      items: [{
        sku: '—',
        name: shipment.item_description,
        quantity: 1,
        price: shipment.item_value,
        weight: shipment.item_weight,
      }],
      total_weight: Number(shipment.item_weight || 0),
      total_value: Number(shipment.item_value || 0),
      laneInfo: getLaneInfo(shipment),
    },
  };
}

async function generateWaybillHTML(waybillData) {
  const {
    waybill_number,
    reference_label,
    order_number,
    status,
    created_date,
    sender,
    recipient,
    items,
    total_weight,
    total_value,
    laneInfo,
  } = waybillData;

  const qrSvg = await QRCode.toString(waybill_number, {
    type: 'svg',
    margin: 0,
    width: 110,
    errorCorrectionLevel: 'M',
  });

  const itemRows = items.length > 0
    ? items.map((item) => `
        <tr>
          <td>${escapeHtml(item.sku || '—')}</td>
          <td>${escapeHtml(item.name)}</td>
          <td class="num">${escapeHtml(item.quantity)}</td>
          <td class="num">${Number(item.weight || 0).toFixed(1)}kg</td>
          <td class="num">₦${Number(item.price || 0).toLocaleString()}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="empty">No items on record</td></tr>';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Waybill - ${waybill_number}</title>
  <style>
    @page { size: A5; margin: 12mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #0f172a;
      font-size: 12px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 3px solid #0f172a;
      margin-bottom: 14px;
    }
    .logo-section { display: flex; align-items: center; gap: 8px; }
    .logo-img { height: 34px; width: auto; object-fit: contain; }
    .logo-fallback { font-size: 18px; font-weight: bold; display: none; }
    .doc-title { text-align: right; }
    .doc-title h1 {
      font-size: 16px;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .doc-title .order-ref { font-size: 10px; color: #64748b; margin-top: 2px; }

    .waybill-number-block {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      border: 2px solid #0f172a;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 14px;
    }
    .waybill-number-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; }
    .waybill-number-value {
      font-size: 20px;
      font-weight: 800;
      font-family: 'Courier New', monospace;
      letter-spacing: 1.5px;
    }
    .waybill-qr { line-height: 0; }
    .waybill-qr svg { width: 64px; height: 64px; }

    .addresses { display: flex; gap: 12px; margin-bottom: 14px; }
    .address-box { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
    .address-header {
      font-size: 9px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      padding-bottom: 5px;
      border-bottom: 1px solid #e2e8f0;
    }
    .address-header.from { color: #059669; }
    .address-header.to { color: #dc2626; }
    .address-name { font-size: 12px; font-weight: 700; margin-bottom: 3px; }
    .address-detail { font-size: 10px; color: #475569; line-height: 1.4; }
    .address-phone { font-size: 10px; color: #0369a1; font-weight: 600; margin-top: 4px; }

    .lane-block {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f1f5f9;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 14px;
      font-size: 10px;
    }
    .lane-block strong { font-size: 11px; }

    table.items { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    table.items th, table.items td {
      border: 1px solid #e2e8f0;
      padding: 5px 8px;
      font-size: 10px;
      text-align: left;
    }
    table.items th {
      background: #f8fafc;
      text-transform: uppercase;
      font-size: 8px;
      letter-spacing: 0.5px;
      color: #64748b;
    }
    table.items td.num, table.items th.num { text-align: right; }
    table.items td.empty { text-align: center; color: #94a3b8; }
    tfoot td { font-weight: 700; background: #f8fafc; }

    .meta-row { display: flex; justify-content: space-between; font-size: 10px; color: #475569; margin-bottom: 18px; }

    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      font-size: 8px;
      color: #94a3b8;
      line-height: 1.5;
    }
    .signature-row { display: flex; gap: 24px; margin-top: 16px; }
    .signature-line {
      flex: 1;
      border-top: 1px solid #94a3b8;
      padding-top: 4px;
      font-size: 9px;
      color: #64748b;
    }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }

    /* On-screen preview (mobile admin / in-app viewer) */
    @media screen {
      html, body { background: #f1f5f9; min-height: 100%; }
      body {
        max-width: 36rem;
        margin: 0 auto;
        padding: 12px 14px 24px;
        overflow-x: hidden;
      }
      .header { flex-wrap: wrap; gap: 8px; }
      .doc-title { text-align: left; width: 100%; }
      .waybill-number-block { flex-wrap: wrap; gap: 10px; }
      .waybill-number-value { font-size: 17px; word-break: break-word; }
      .addresses { flex-direction: column; }
      .lane-block {
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }
      .items { display: block; width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .signature-row { flex-direction: column; gap: 12px; }
      .footer { font-size: 9px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-section">
      <img src="${JULINEMART_LOGO}" alt="JulineMart" class="logo-img"
        onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
      <span class="logo-fallback">JulineMart</span>
    </div>
    <div class="doc-title">
      <h1>Waybill</h1>
      <div class="order-ref">${escapeHtml(reference_label || 'Order #')}${escapeHtml(order_number)} &middot; ${escapeHtml(created_date)}</div>
    </div>
  </div>

  <div class="waybill-number-block">
    <div>
      <div class="waybill-number-label">Waybill Number</div>
      <div class="waybill-number-value">${escapeHtml(waybill_number)}</div>
    </div>
    <div class="waybill-qr">${qrSvg}</div>
  </div>

  <div class="addresses">
    <div class="address-box">
      <div class="address-header from">From (Sender)</div>
      <div class="address-name">${escapeHtml(sender.name)}</div>
      <div class="address-detail">${escapeHtml(sender.address)}</div>
      <div class="address-detail">${escapeHtml(sender.city)}${sender.state ? ', ' + escapeHtml(sender.state) : ''}</div>
      <div class="address-phone">Tel: ${escapeHtml(sender.phone) || 'N/A'}</div>
    </div>
    <div class="address-box">
      <div class="address-header to">To (Recipient)</div>
      <div class="address-name">${escapeHtml(recipient.name)}</div>
      <div class="address-detail">${escapeHtml(recipient.address)}</div>
      <div class="address-detail">${escapeHtml(recipient.city)}${recipient.state ? ', ' + escapeHtml(recipient.state) : ''}</div>
      <div class="address-phone">Tel: ${escapeHtml(recipient.phone) || 'N/A'}</div>
    </div>
  </div>

  <div class="lane-block">
    <div><strong>${escapeHtml(laneInfo.label)}</strong></div>
    <div>${escapeHtml(laneInfo.referenceLabel)}: <strong>${escapeHtml(laneInfo.referenceValue)}</strong></div>
    <div>Status: <strong>${escapeHtml(status)}</strong></div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>SKU</th>
        <th>Item</th>
        <th class="num">Qty</th>
        <th class="num">Weight</th>
        <th class="num">Value</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3"></td>
        <td class="num">${total_weight.toFixed(1)}kg</td>
        <td class="num">₦${total_value.toLocaleString()}</td>
      </tr>
    </tfoot>
  </table>

  <div class="signature-row">
    <div class="signature-line">Received by (Name &amp; Signature)</div>
    <div class="signature-line">Date</div>
  </div>

  <div class="footer">
    This waybill is issued by JulineMart Logistics as proof of shipment for the goods described above.
    The declared value and weight are as provided at the point of dispatch and have not been independently verified.
    Any discrepancy should be reported before acceptance of delivery.
  </div>

  <script>
    window.onload = function () {
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
    let subOrderId, returnShipmentId, shipmentId;
    if (event.httpMethod === 'GET') {
      const params = new URLSearchParams(event.queryStringParameters || {});
      subOrderId = params.get('subOrderId');
      returnShipmentId = params.get('returnShipmentId');
      shipmentId = params.get('shipmentId');
    } else {
      const body = JSON.parse(event.body || '{}');
      subOrderId = body.subOrderId;
      returnShipmentId = body.returnShipmentId;
      shipmentId = body.shipmentId;
    }

    if (!subOrderId && !returnShipmentId && !shipmentId) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'subOrderId, returnShipmentId, or shipmentId required' }),
      };
    }

    const access = await assertWaybillAccess(event, { subOrderId, returnShipmentId, shipmentId });
    if (!access.ok) {
      return {
        statusCode: access.statusCode,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: access.body,
      };
    }

    const result = subOrderId
      ? await loadOrderWaybillData(subOrderId)
      : returnShipmentId
      ? await loadReturnWaybillData(returnShipmentId)
      : await loadManualShipmentWaybillData(shipmentId);

    if (result.error) {
      return {
        statusCode: result.error.statusCode,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(result.error.body),
      };
    }

    const waybillHTML = await generateWaybillHTML(result.waybillData);

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'text/html' },
      body: waybillHTML,
    };
  } catch (error) {
    console.error('Error generating waybill:', error);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: 'Failed to generate waybill',
        message: error.message,
      }),
    };
  }
};
