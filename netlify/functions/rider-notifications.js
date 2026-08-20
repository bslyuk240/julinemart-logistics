/**
 * GET /.netlify/functions/rider-notifications — a rider's own notification
 * history (rider-app-ux-rebuild.md #18), most recent first, plus an
 * unread count for a badge.
 *
 * POST { action: 'mark_read', id } or { action: 'mark_all_read' } —
 * marks one or all of this rider's notifications read.
 */
import { requireActiveRider, jsonResponse, headers } from './services/requireRider.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const session = await requireActiveRider(event);
  if (session.errorResponse) return session.errorResponse;
  const { rider, adminClient } = session;

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { success: false, error: 'Invalid JSON' });
    }

    if (body.action === 'mark_all_read') {
      const { error } = await adminClient
        .from('rider_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('rider_id', rider.id)
        .is('read_at', null);
      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true, data: { marked: true } });
    }

    if (body.action === 'mark_read' && body.id) {
      const { error } = await adminClient
        .from('rider_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', body.id)
        .eq('rider_id', rider.id);
      if (error) return jsonResponse(500, { success: false, error: error.message });
      return jsonResponse(200, { success: true, data: { marked: true } });
    }

    return jsonResponse(400, { success: false, error: 'action must be mark_read (with id) or mark_all_read' });
  }

  if (event.httpMethod !== 'GET') return jsonResponse(405, { success: false, error: 'Method not allowed' });

  const { data, error } = await adminClient
    .from('rider_notifications')
    .select('id, type, title, message, data, read_at, created_at')
    .eq('rider_id', rider.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return jsonResponse(500, { success: false, error: 'Failed to load notifications' });

  const unreadCount = (data || []).filter((n) => !n.read_at).length;

  return jsonResponse(200, { success: true, data: { items: data || [], unread_count: unreadCount } });
}
