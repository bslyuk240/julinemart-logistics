import {
  headers,
  isPlainObject,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import { enqueueGlobalSourcingImportJob } from './services/global-sourcing-import-job.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  const payload = parseJsonBody(event.body);
  if (payload === null || !isPlainObject(payload)) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  try {
    const job = await enqueueGlobalSourcingImportJob({
      adminClient: auth.adminClient,
      requestedBy: auth.profile?.id || auth.authUser?.id || null,
      payload,
    });

    return jsonResponse(202, {
      success: true,
      data: job,
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Global sourcing import failed',
      message: error?.message || 'Unable to queue import job',
      details: error?.details || null,
    });
  }
}
