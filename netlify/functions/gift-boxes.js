/**
 * GET /api/gift-boxes?gfc=warri
 * GET /api/gift-boxes?slug=birthday-surprise
 *
 * Public ready-made gift boxes for storefront.
 */
import { headers, jsonResponse, adminClient } from './services/global-sourcing-utils.js';
import { checkRateLimit } from './services/rate-limit.js';

const BOX_SELECT =
  'id, slug, name, description, image_url, list_price, recipient_types, occasion_types, sort_order, gift_fulfilment_centre_id';

async function resolveGfc(qs) {
  const code = (qs.gfc || qs.code || '').trim().toLowerCase();
  const gfcIdParam = qs.gfc_id;

  let gfcQuery = adminClient
    .from('gift_fulfilment_centres')
    .select('id, name, code, city, state, is_default')
    .eq('active', true);

  if (gfcIdParam) gfcQuery = gfcQuery.eq('id', gfcIdParam);
  else if (code) gfcQuery = gfcQuery.eq('code', code);
  else gfcQuery = gfcQuery.eq('is_default', true);

  const { data, error } = await gfcQuery.maybeSingle();
  if (error) throw error;
  return data;
}

async function boxWithItems(box) {
  const { data: items, error } = await adminClient
    .from('gift_box_items')
    .select(`
      id, quantity, sort_order,
      products!inner ( id, name, gift_eligible, status,
        product_images ( src, alt, position, is_thumbnail )
      )
    `)
    .eq('gift_box_id', box.id)
    .order('sort_order', { ascending: true });

  if (error) throw error;

  const contents = (items || [])
    .filter((row) => row.products?.gift_eligible && ['publish', 'published'].includes(row.products?.status))
    .map((row) => {
      const images = (row.products.product_images || []).sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );
      const thumb = images.find((i) => i.is_thumbnail) || images[0];
      return {
        product_id: row.products.id,
        name: row.products.name,
        quantity: row.quantity,
        image: thumb?.src || null,
      };
    });

  return {
    id: box.id,
    slug: box.slug,
    name: box.name,
    description: box.description,
    image_url: box.image_url,
    list_price: Number(box.list_price),
    recipient_types: box.recipient_types || [],
    occasion_types: box.occasion_types || [],
    item_count: contents.reduce((s, i) => s + i.quantity, 0),
    contents,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const { limited, response } = await checkRateLimit(event, {
    name: 'gift-boxes',
    max: 60,
    window: '1 m',
    retryAfterSeconds: 60,
  });
  if (limited) return response;

  if (!adminClient) return jsonResponse(503, { error: 'Database not configured' });

  const qs = event.queryStringParameters || {};
  const slug = (qs.slug || '').trim().toLowerCase();

  try {
    const gfc = await resolveGfc(qs);
    if (!gfc) return jsonResponse(404, { success: false, error: 'Gift fulfilment centre not found' });

    if (slug) {
      const { data: box, error } = await adminClient
        .from('gift_boxes')
        .select(BOX_SELECT)
        .eq('slug', slug)
        .eq('gift_fulfilment_centre_id', gfc.id)
        .eq('active', true)
        .maybeSingle();

      if (error) return jsonResponse(500, { success: false, error: error.message });
      if (!box) return jsonResponse(404, { success: false, error: 'Gift box not found' });

      const detail = await boxWithItems(box);
      return jsonResponse(200, {
        success: true,
        data: detail,
        gfc: { id: gfc.id, code: gfc.code, name: gfc.name, city: gfc.city, state: gfc.state },
      });
    }

    const { data: boxes, error } = await adminClient
      .from('gift_boxes')
      .select(BOX_SELECT)
      .eq('gift_fulfilment_centre_id', gfc.id)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) return jsonResponse(500, { success: false, error: error.message });

    const list = await Promise.all((boxes || []).map(boxWithItems));

    return jsonResponse(200, {
      success: true,
      data: list,
      gfc: { id: gfc.id, code: gfc.code, name: gfc.name, city: gfc.city, state: gfc.state },
    });
  } catch (err) {
    return jsonResponse(500, { success: false, error: err?.message || String(err) });
  }
}
