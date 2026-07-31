import { getCjAccessToken } from './services/cjAuth.js';
import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  requireAdmin,
} from './services/global-sourcing-utils.js';

function credentialChecks() {
  return {
    cj_api_key: Boolean(process.env.CJ_API_KEY),
    cj_api_base_url: Boolean(process.env.CJ_API_BASE_URL),
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const checks = credentialChecks();
  const configured = checks.cj_api_key && checks.cj_api_base_url;

  if (event.httpMethod === 'GET') {
    return jsonResponse(200, {
      success: true,
      data: {
        provider: 'cj',
        configured,
        checks,
        cj_connected: null,
        connection_tested_at: null,
      },
    });
  }

  const data = {
    provider: 'cj',
    configured,
    checks,
    authenticated: false,
    cj_connected: false,
    cj_connection_error: null,
    connection_tested_at: new Date().toISOString(),
  };

  try {
    const token = await getCjAccessToken();
    data.authenticated = true;
    data.cj_connected = true;
    data.cached = token.cached;
    data.expires_at = token.expiresAt;
  } catch (error) {
    data.authenticated = false;
    data.cj_connected = false;
    data.cj_connection_error = error?.message || 'Unable to authenticate with CJ';
  }

  return jsonResponse(200, { success: true, data });
}
