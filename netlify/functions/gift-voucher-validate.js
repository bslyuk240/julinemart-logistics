/**
 * POST /api/gift-voucher-validate
 *
 * Validate campaign voucher for gift checkout (discount on gift box subtotal).
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import {
  resolveGiftVoucherContext,
  validateGiftCampaignVoucher,
} from './services/gift-voucher.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { success: false, error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-voucher-validate',
    max: 40,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { success: false, error: 'Invalid JSON' });
  }

  const voucherCode = body.voucher_code || body.coupon_code;
  const customerEmail = body.customer_email || body.email;

  if (!voucherCode?.trim()) {
    return jsonResponse(400, { success: false, error: 'voucher_code required' });
  }
  if (!customerEmail?.trim()) {
    return jsonResponse(400, { success: false, error: 'customer_email required' });
  }

  try {
    const giftContext = await resolveGiftVoucherContext(adminClient, body);
    const result = await validateGiftCampaignVoucher(adminClient, {
      code: voucherCode,
      customerEmail: customerEmail.trim(),
      giftContext,
    });

    return jsonResponse(200, {
      success: true,
      data: {
        code: result.code,
        campaign_name: result.campaign_name,
        discount_amount: result.discountAmount,
        order_subtotal: giftContext.customerSubtotal,
        discounted_subtotal: Math.max(giftContext.customerSubtotal - result.discountAmount, 0),
        gift_box_sku: giftContext.boxSku,
      },
    });
  } catch (err) {
    return jsonResponse(400, { success: false, error: err?.message || String(err) });
  }
}
