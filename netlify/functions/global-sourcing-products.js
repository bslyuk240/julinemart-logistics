import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  requireAdmin,
} from './services/global-sourcing-utils.js';

function normalizeProduct(row) {
  const meta = row.sourcing_meta ?? {};
  const provider =
    meta.provider ??
    (meta.cj_pid || meta.cjPid || row.ships_from_abroad ? 'cj' : null);
  if (!provider) return null;

  return {
    id: row.id,
    name: row.name,
    status: row.status,
    image: row._thumbnail?.src ?? null,
    provider,
    external_product_id: meta.cj_pid ?? meta.cjPid ?? null,
    external_variant_id: meta.cj_vid ?? meta.cjVid ?? null,
    fulfillment_mode: meta.fulfillment_mode ?? meta.fulfillmentMode ?? null,
    receiving_hub_id: row.hub_id ?? null,
    receiving_hub: row.hubs ?? null,
    vendor_id: row.vendor_id ?? null,
    vendor: row.vendors ?? null,
    global_sourcing_tag: meta.global_sourcing_tag ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'DELETE'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;
  const client = auth.adminClient;

  try {
    if (event.httpMethod === 'DELETE') {
      const productId = String(event.queryStringParameters?.id || '').trim();
      if (!productId) {
        return jsonResponse(400, { success: false, error: 'id is required' });
      }

      // Verify product exists and is managed by Global Sourcing before deleting
      const { data: existing, error: fetchErr } = await client
        .from('products')
        .select('id, sourcing_meta, ships_from_abroad')
        .eq('id', productId)
        .maybeSingle();

      if (fetchErr || !existing) {
        return jsonResponse(404, { success: false, error: 'Product not found' });
      }

      const meta = existing.sourcing_meta ?? {};
      const isGlobalSourcing =
        existing.ships_from_abroad ||
        meta.provider === 'cj' ||
        !!(meta.cj_pid || meta.cjPid);

      if (!isGlobalSourcing) {
        return jsonResponse(400, {
          success: false,
          error: 'Product is not managed by Global Sourcing',
          message: 'Only imported Global Sourcing products can be deleted from this screen',
        });
      }

      const { error: deleteErr } = await client
        .from('products')
        .delete()
        .eq('id', productId);

      if (deleteErr) throw deleteErr;

      return jsonResponse(200, {
        success: true,
        data: { id: productId },
        message: 'Imported product deleted',
      });
    }

    // GET — list CJ / global-sourcing products from Supabase
    const page = Math.max(Number(event.queryStringParameters?.page || 1), 1);
    const perPage = Math.min(Math.max(Number(event.queryStringParameters?.per_page || 50), 1), 100);
    const offset = (page - 1) * perPage;

    const { data: rows, error: listErr } = await client
      .from('products')
      .select(`
        id, name, status, ships_from_abroad, sourcing_meta, hub_id, vendor_id, updated_at,
        product_images(src, alt, is_thumbnail),
        hubs(id, name, code),
        vendors(id, store_name)
      `)
      .or("ships_from_abroad.eq.true,sourcing_meta->>provider.eq.cj")
      .order('updated_at', { ascending: false })
      .range(offset, offset + perPage - 1);

    if (listErr) throw listErr;

    const list = Array.isArray(rows) ? rows : [];

    const normalized = list
      .map((row) => {
        const images = Array.isArray(row.product_images) ? row.product_images : [];
        const thumbnail =
          images.find((img) => img.is_thumbnail) ?? images[0] ?? null;
        return normalizeProduct({ ...row, _thumbnail: thumbnail });
      })
      .filter(Boolean);

    return jsonResponse(200, {
      success: true,
      data: normalized,
      meta: {
        page,
        per_page: perPage,
        imported_count: normalized.length,
      },
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Unable to load imported products',
      message: error?.message || 'Supabase query failed',
    });
  }
}
