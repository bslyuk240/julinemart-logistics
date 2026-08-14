/**
 * GET /api/gift-message-card?gift_order_id=<uuid>
 *
 * Printable HTML message card for ops (admin auth required).
 */
import { requireAdmin, adminClient, headers } from './services/global-sourcing-utils.js';

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const auth = await requireAdmin(event, ['admin', 'manager', 'staff']);
  if (auth.errorResponse) return auth.errorResponse;

  const giftOrderId = event.queryStringParameters?.gift_order_id;
  if (!giftOrderId) {
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'gift_order_id required' }),
    };
  }

  const { data, error } = await adminClient
    .from('gift_orders')
    .select(`
      recipient_name, gift_message, sender_visible, occasion,
      orders ( customer_name, order_number ),
      gift_boxes ( name )
    `)
    .eq('id', giftOrderId)
    .maybeSingle();

  if (error || !data) {
    return {
      statusCode: 404,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Gift order not found' }),
    };
  }

  const senderName = data.sender_visible ? data.orders?.customer_name : null;
  const recipient = escapeHtml(data.recipient_name);
  const message = escapeHtml(data.gift_message || '').replace(/\n/g, '<br/>');
  const occasion = escapeHtml(data.occasion || '');
  const boxName = escapeHtml(data.gift_boxes?.name || 'JulineMart Gift');
  const orderNum = escapeHtml(String(data.orders?.order_number || ''));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Gift card — Order #${orderNum}</title>
  <style>
    @page { size: A6 portrait; margin: 12mm; }
    body { font-family: Georgia, 'Times New Roman', serif; margin: 0; padding: 24px; color: #1a1a1a; }
    .card { border: 2px solid #7c3aed; border-radius: 12px; padding: 28px 24px; max-width: 400px; margin: 0 auto; }
    .brand { text-align: center; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: #7c3aed; margin-bottom: 20px; }
    .to { font-size: 13px; color: #666; margin-bottom: 4px; }
    .recipient { font-size: 22px; font-weight: bold; margin-bottom: 20px; }
    .message { font-size: 15px; line-height: 1.6; min-height: 80px; margin-bottom: 20px; white-space: pre-wrap; }
    .from { font-size: 13px; color: #444; text-align: right; }
    .occasion { font-size: 12px; color: #888; text-align: center; margin-top: 16px; }
    .meta { font-size: 10px; color: #aaa; text-align: center; margin-top: 24px; }
    @media print { .no-print { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <p class="no-print" style="text-align:center;font-family:sans-serif;font-size:14px;">
    <button onclick="window.print()" style="padding:8px 16px;cursor:pointer;">Print card</button>
  </p>
  <div class="card">
    <div class="brand">JulineMart Gifts</div>
    <div class="to">For</div>
    <div class="recipient">${recipient}</div>
    <div class="message">${message || '<em>No message</em>'}</div>
    ${senderName ? `<div class="from">— ${escapeHtml(senderName)}</div>` : '<div class="from">— With love</div>'}
    ${occasion ? `<div class="occasion">${occasion}</div>` : ''}
    <div class="meta">${boxName} · Order #${orderNum}</div>
  </div>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
}
