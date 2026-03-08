import { getCjAccessToken } from './services/cjAuth.js';
import { headers, jsonResponse, requireAdmin } from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  const configured = Boolean(process.env.CJ_API_KEY && process.env.CJ_API_BASE_URL);
  const wooConfigured = Boolean(
    (process.env.WOO_BASE_URL || process.env.WOOCOMMERCE_URL) &&
      (process.env.WOO_CONSUMER_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY) &&
      (process.env.WOO_CONSUMER_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET)
  );

  if (event.httpMethod === 'GET') {
    return jsonResponse(200, {
      success: true,
      data: {
        provider: 'cj',
        configured,
        wooConfigured,
        checks: {
          cj_api_key: Boolean(process.env.CJ_API_KEY),
          cj_api_base_url: Boolean(process.env.CJ_API_BASE_URL),
          woo_base_url: Boolean(process.env.WOO_BASE_URL || process.env.WOOCOMMERCE_URL),
          woo_consumer_key: Boolean(
            process.env.WOO_CONSUMER_KEY || process.env.WOOCOMMERCE_CONSUMER_KEY
          ),
          woo_consumer_secret: Boolean(
            process.env.WOO_CONSUMER_SECRET || process.env.WOOCOMMERCE_CONSUMER_SECRET
          ),
        },
      },
    });
  }

  try {
    const token = await getCjAccessToken();
    return jsonResponse(200, {
      success: true,
      data: {
        provider: 'cj',
        authenticated: true,
        cached: token.cached,
        expires_at: token.expiresAt,
      },
    });
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: 'CJ authentication failed',
      message: error?.message || 'Unable to authenticate with CJ',
      details: error?.details || [],
    });
  }
}
