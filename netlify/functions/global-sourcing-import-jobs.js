import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  isPlainObject,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';
import {
  getGlobalSourcingImportJob,
  processGlobalSourcingImportJob,
} from './services/global-sourcing-import-job.js';

function readJobId(event, payload) {
  const queryJobId =
    String(event.queryStringParameters?.job_id || event.queryStringParameters?.jobId || '').trim();
  if (queryJobId) return queryJobId;

  if (isPlainObject(payload)) {
    return String(payload.job_id || payload.jobId || '').trim();
  }

  return '';
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod || '')) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const payload = event.httpMethod === 'POST' ? parseJsonBody(event.body) : null;
  if (event.httpMethod === 'POST' && event.body && payload === null) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  const jobId = readJobId(event, payload);
  if (!jobId) {
    return jsonResponse(400, {
      success: false,
      error: 'job_id is required',
    });
  }

  try {
    const data =
      event.httpMethod === 'GET'
        ? await getGlobalSourcingImportJob({
            adminClient: auth.adminClient,
            jobId,
          })
        : await processGlobalSourcingImportJob({
            adminClient: auth.adminClient,
            jobId,
          });

    return jsonResponse(200, {
      success: true,
      data,
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Global sourcing import job failed',
      message: error?.message || 'Unable to process import job',
      details: error?.details || null,
    });
  }
}
