/**
 * GET  /.netlify/functions/admin-product-reviews — staff: all reviews (filters).
 * PATCH /.netlify/functions/admin-product-reviews — staff: set status / admin_note.
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
    const vendorId = event.queryStringParameters?.vendor_id || '';
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    let q = adminClient
      .from('product_reviews')
      .select(
        `
        id,
        created_at,
        updated_at,
        product_id,
        woo_product_id,
        vendor_id,
        reviewer_name,
        reviewer_email,
        rating,
        body,
        status,
        verified_purchase,
        woo_order_id,
        admin_note,
        products ( name, slug ),
        vendors ( store_name, store_slug )
      `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      q = q.eq('status', status);
    }
    if (vendorId) {
      q = q.eq('vendor_id', vendorId);
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
      .from('product_reviews')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();

    if (updErr) return jsonResponse(500, { success: false, error: updErr.message });
    return jsonResponse(200, { success: true, data });
  }

  return jsonResponse(405, { success: false, error: 'Method not allowed' });
}
