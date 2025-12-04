// Netlify Function proxy for WooCommerce refunds-related actions

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

const WC_BASE_URL =
  (process.env.WOOCOMMERCE_URL || '').replace(/\/$/, '') ||
  'https://admin.julinemart.com/wp-json/wc/v3';

const getAuthHeader = () => {
  const key = process.env.WOOCOMMERCE_CONSUMER_KEY;
  const secret = process.env.WOOCOMMERCE_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new Error('WooCommerce credentials not configured');
  }
  return Buffer.from(`${key}:${secret}`).toString('base64');
};

const parsePath = (path) => {
  // path looks like /.netlify/functions/refunds/requests/:orderId/:action?
  const parts = path.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p === 'refunds');
  const after = idx >= 0 ? parts.slice(idx + 1) : [];
  const section = after[0]; // e.g., 'requests'
  const orderId = after.length > 1 ? after[1] : undefined;
  const action = after.length > 2 ? after[2] : undefined;
  return { section, orderId, action };
};

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const auth = getAuthHeader();
    const { section, orderId, action } = parsePath(event.path);

    if (section !== 'requests') {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Not found' }) };
    }

    // GET /api/refunds/requests
    if (event.httpMethod === 'GET' && !orderId) {
      const url = new URL(`${WC_BASE_URL}/orders`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', '1');
      url.searchParams.set('meta_key', '_refund_request_status');

      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('Failed to fetch refund requests from WooCommerce:', response.status, text);
        return {
          statusCode: response.status,
          headers,
          body: JSON.stringify({ success: false, error: `WooCommerce request failed (${response.status})` }),
        };
      }

      const data = await response.json();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    // PUT /api/refunds/requests/:orderId
    if (event.httpMethod === 'PUT' && orderId) {
      const body = JSON.parse(event.body || '{}');
      const refund_request = body.refund_request;
      const status = body.status;

      if (!refund_request) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing refund_request' }) };
      }

      const response = await fetch(`${WC_BASE_URL}/orders/${orderId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meta_data: [
            { key: '_refund_request', value: refund_request },
            { key: '_refund_request_status', value: status || refund_request.status || 'pending' },
          ],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('Failed to update refund meta:', response.status, text);
        return {
          statusCode: response.status,
          headers,
          body: JSON.stringify({ success: false, error: 'Failed to update order' }),
        };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // POST /api/refunds/requests/:orderId/note
    if (event.httpMethod === 'POST' && orderId && action === 'note') {
      const body = JSON.parse(event.body || '{}');
      const note = body.note;

      if (!note) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing note' }) };
      }

      const response = await fetch(`${WC_BASE_URL}/orders/${orderId}/notes`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ note, customer_note: false }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('Failed to add order note:', response.status, text);
        return { statusCode: response.status, headers, body: JSON.stringify({ success: false, error: 'Failed to add note' }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // POST /api/refunds/requests/:orderId/create-refund
    if (event.httpMethod === 'POST' && orderId && action === 'create-refund') {
      const body = JSON.parse(event.body || '{}');
      const amount = body.amount;
      const reason = body.reason;

      if (!amount) {
        return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Missing amount' }) };
      }

      const response = await fetch(`${WC_BASE_URL}/orders/${orderId}/refunds`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount,
          reason,
          api_refund: false,
          api_restock: true,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('Failed to create Woo refund:', response.status, text);
        return { statusCode: response.status, headers, body: JSON.stringify({ success: false, error: 'Failed to create refund' }) };
      }

      const data = await response.json();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ success: false, error: 'Not found' }) };
  } catch (error) {
    console.error('Refunds function error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error?.message || 'Server error' }) };
  }
}
