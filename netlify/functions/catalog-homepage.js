/**
 * GET  /api/catalog-homepage         — return all homepage_content rows
 * PUT  /api/catalog-homepage?key=hero_slider — update a specific content block (admin only)
 *
 * This replaces the julinemart-pwa WordPress plugin endpoints:
 *   /wp-json/julinemart-pwa/v1/settings
 *   /wp-json/julinemart-pwa/v1/sliders
 *   /wp-json/julinemart-pwa/v1/banner
 */

import {
  headers,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
  adminClient,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // GET — public, no auth required
  if (event.httpMethod === 'GET') {
    if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

    const q = event.queryStringParameters || {};

    let query = adminClient
      .from('homepage_content')
      .select('id, type, key, content, is_active, display_order, updated_at')
      .order('display_order', { ascending: true });

    if (q.type) query = query.eq('type', q.type);
    if (q.key) query = query.eq('key', q.key);
    if (q.active_only !== 'false') query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) return jsonResponse(500, { success: false, error: error.message });

    return jsonResponse(200, { success: true, data: data || [] });
  }

  // PUT — update content for a specific key (admin only)
  if (event.httpMethod === 'PUT') {
    const auth = await requireAdmin(event, ['admin']);
    if (auth.errorResponse) return auth.errorResponse;

    const key = event.queryStringParameters?.key;
    if (!key) return jsonResponse(400, { error: 'key query param required' });

    const body = parseJsonBody(event.body);
    if (!body) return jsonResponse(400, { error: 'Invalid JSON body' });

    const patch = {};
    if (body.content !== undefined) patch.content = body.content;
    if (body.is_active !== undefined) patch.is_active = !!body.is_active;
    if (body.display_order !== undefined) patch.display_order = Number(body.display_order);
    patch.updated_at = new Date().toISOString();
    patch.updated_by = auth.profile?.id || null;

    if (Object.keys(patch).length === 1) {
      return jsonResponse(400, { error: 'Nothing to update' });
    }

    const { data, error } = await auth.adminClient
      .from('homepage_content')
      .update(patch)
      .eq('key', key)
      .select()
      .single();

    if (error) return jsonResponse(500, { success: false, error: error.message });

    return jsonResponse(200, { success: true, data });
  }

  return jsonResponse(405, { error: 'Method not allowed' });
}
