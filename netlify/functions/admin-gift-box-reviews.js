/**
 * GET   /.netlify/functions/admin-gift-box-reviews — staff: all gift box reviews (filters).
 * PATCH /.netlify/functions/admin-gift-box-reviews — staff: set status / admin_note.
 */
import {
  headers,
  jsonResponse,
  parseJsonBody,
  requireAdmin,
  GLOBAL_SOURCING_ALLOWED_ROLES,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const { adminClient } = auth;

  if (event.httpMethod === 'GET') {
    const page = Math.max(Number(event.queryStringParameters?.page || 1), 1);
    const perPage = Math.min(Math.max(Number(event.queryStringParameters?.per_page || 30), 1), 200);
    const status = event.queryStringParameters?.status || '';
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    let q = adminClient
      .from('gift_box_reviews')
      .select(
        `
        id,
        created_at,
        updated_at,
        gift_box_id,
        reviewer_name,
        reviewer_email,
        rating,
        body,
        status,
        verified_purchase,
        admin_note,
        gift_boxes ( name, slug )
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      q = q.eq('status', status);
    }

    const { data, error: dbErr, count } = await q;
    if (dbErr) return jsonResponse(500, { success: false, error: dbErr.message });

    return jsonResponse(200, {
      success: true,
      data: data || [],
      meta: {
        page,
        per_page: perPage,
        total: count ?? 0,
        total_pages: count != null ? Math.max(Math.ceil(count / perPage), 1) : 1,
      },
    });
  }

  if (event.httpMethod === 'PATCH') {
    const body = parseJsonBody(event.body);
    if (!body?.id) return jsonResponse(400, { success: false, error: 'id required' });
    const nextStatus = body.status;
    if (nextStatus && !['pending', 'approved', 'rejected'].includes(nextStatus)) {
      return jsonResponse(400, { success: false, error: 'invalid status' });
    }

    const updates = { updated_at: new Date().toISOString() };
    if (nextStatus) updates.status = nextStatus;
    if (body.admin_note !== undefined) updates.admin_note = body.admin_note;

    const { data, error: updErr } = await adminClient
      .from('gift_box_reviews')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();

    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });
    return jsonResponse(200, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
