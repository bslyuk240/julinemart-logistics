/**
 * GET /.netlify/functions/vendor-product-reviews
 * Authenticated vendor: all reviews for products belonging to this vendor (every status).
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  const { vendor, error } = await authenticateVendor(event);
  if (error) {
    return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };
  }

  const page = Math.max(Number(event.queryStringParameters?.page || 1), 1);
  const perPage = Math.min(Math.max(Number(event.queryStringParameters?.per_page || 30), 1), 100);
  const status = event.queryStringParameters?.status || '';
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  const admin = getAdminClient();
  let q = admin
    .from('product_reviews')
    .select(
      `
      id,
      created_at,
      updated_at,
      product_id,
      woo_product_id,
      reviewer_name,
      reviewer_email,
      rating,
      body,
      status,
      verified_purchase,
      woo_order_id,
      admin_note,
      products ( name, slug )
    `,
      { count: 'exact' }
    )
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    q = q.eq('status', status);
  }

  const { data, error: dbErr, count } = await q;
  if (dbErr) {
    return {
      statusCode: 500,
      headers: corsHeaders(origin),
      body: JSON.stringify({ success: false, error: dbErr.message }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(origin),
    body: JSON.stringify({
      success: true,
      data: data || [],
      meta: {
        page,
        per_page: perPage,
        total: count ?? 0,
        total_pages: count != null ? Math.max(Math.ceil(count / perPage), 1) : 1,
      },
    }),
  };
}
