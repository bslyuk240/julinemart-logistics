import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { success: false, error: 'Invalid JSON' }); }

  const online = Boolean(body.online);

  const { error } = await adminClient
    .from('riders')
    .update({ is_online: online, last_online_at: new Date().toISOString() })
    .eq('id', rider.id);

  if (error) {
    console.error('rider-online update error:', error);
    return jsonResponse(500, { success: false, error: 'Failed to update status' });
  }

  return jsonResponse(200, { success: true, data: { online } });
}
