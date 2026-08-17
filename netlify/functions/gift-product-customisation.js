/**
 * GET /api/gift-product-customisation?product_id=<uuid>
 *
 * Public schema for gift BYO personalisation (Phase 4 reuse).
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';
import { loadProductCustomisationSchema } from './services/gift-customisation.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });
  if (!adminClient) return jsonResponse(503, { success: false, error: 'Database not configured' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-product-customisation',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  const productId = (event.queryStringParameters?.product_id || '').trim();
  if (!productId) return jsonResponse(400, { success: false, error: 'product_id required' });

  try {
    const schema = await loadProductCustomisationSchema(adminClient, productId);
    if (!schema) {
      return jsonResponse(404, { success: false, error: 'No customisation schema for this product' });
    }

    return jsonResponse(200, {
      success: true,
      data: {
        schema_id: schema.id,
        product_id: schema.product_id,
        vendor_id: schema.vendor_id,
        requires_approval: schema.requires_approval,
        fields: schema.fields,
        production_days_min: schema.production_days_min,
        production_days_max: schema.production_days_max,
      },
    });
  } catch (err) {
    return jsonResponse(500, { success: false, error: err?.message || String(err) });
  }
}
