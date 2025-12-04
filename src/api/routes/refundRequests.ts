import { Request, Response } from 'express';

const WC_BASE_URL = (process.env.WOOCOMMERCE_URL || '').replace(/\/$/, '') || 'https://admin.julinemart.com/wp-json/wc/v3';
const WC_KEY = process.env.WOOCOMMERCE_CONSUMER_KEY;
const WC_SECRET = process.env.WOOCOMMERCE_CONSUMER_SECRET;

const authHeader = () => {
  if (!WC_KEY || !WC_SECRET) {
    throw new Error('WooCommerce credentials not configured');
  }
  return Buffer.from(`${WC_KEY}:${WC_SECRET}`).toString('base64');
};

/**
 * Proxy WooCommerce refund requests to avoid browser CORS.
 * GET /api/refunds/requests?page=1&per_page=100
 */
export async function getRefundRequests(req: Request, res: Response) {
  try {
    const auth = authHeader();

    const page = typeof req.query.page === 'string' ? req.query.page : '1';
    const perPage = typeof req.query.per_page === 'string' ? req.query.per_page : '100';

    const url = new URL(`${WC_BASE_URL}/orders`);
    url.searchParams.set('per_page', perPage);
    url.searchParams.set('page', page);
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
      return res.status(response.status).json({
        success: false,
        error: `WooCommerce request failed (${response.status})`,
      });
    }

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching refund requests:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Failed to fetch refund requests',
    });
  }
}

/**
 * Update refund request meta on an order
 * PUT /api/refunds/requests/:orderId
 * body: { refund_request: object, status: string }
 */
export async function updateRefundRequestMeta(req: Request, res: Response) {
  try {
    const auth = authHeader();
    const { orderId } = req.params;
    const { refund_request, status } = req.body as { refund_request: unknown; status?: string };

    if (!orderId || !refund_request) {
      return res.status(400).json({ success: false, error: 'Missing orderId or refund_request' });
    }

    const url = `${WC_BASE_URL}/orders/${orderId}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        meta_data: [
          {
            key: '_refund_request',
            value: refund_request,
          },
          {
            key: '_refund_request_status',
            value: status || (typeof refund_request === 'object' && (refund_request as any).status) || 'pending',
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Failed to update refund meta:', response.status, text);
      return res.status(response.status).json({ success: false, error: 'Failed to update order' });
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error('Error updating refund meta:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to update refund meta' });
  }
}

/**
 * Add WooCommerce order note
 * POST /api/refunds/requests/:orderId/note
 * body: { note: string }
 */
export async function addRefundOrderNote(req: Request, res: Response) {
  try {
    const auth = authHeader();
    const { orderId } = req.params;
    const { note } = req.body as { note?: string };

    if (!orderId || !note) {
      return res.status(400).json({ success: false, error: 'Missing orderId or note' });
    }

    const url = `${WC_BASE_URL}/orders/${orderId}/notes`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        note,
        customer_note: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Failed to add order note:', response.status, text);
      return res.status(response.status).json({ success: false, error: 'Failed to add order note' });
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error('Error adding order note:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to add order note' });
  }
}

/**
 * Create WooCommerce refund
 * POST /api/refunds/requests/:orderId/create-refund
 * body: { amount: string, reason: string }
 */
export async function createWooRefund(req: Request, res: Response) {
  try {
    const auth = authHeader();
    const { orderId } = req.params;
    const { amount, reason } = req.body as { amount?: string; reason?: string };

    if (!orderId || !amount) {
      return res.status(400).json({ success: false, error: 'Missing orderId or amount' });
    }

    const url = `${WC_BASE_URL}/orders/${orderId}/refunds`;
    const response = await fetch(url, {
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
      return res.status(response.status).json({ success: false, error: 'Failed to create refund' });
    }

    const data = await response.json();
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error creating Woo refund:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Failed to create Woo refund' });
  }
}
