/**
 * POST /api/vendor-product-upsert          — create product (pending_review)
 * PUT  /api/vendor-product-upsert?id=<uuid> — update own product
 * DELETE /api/vendor-product-upsert?id=<uuid> — delete own draft/pending product
 */
import { corsHeaders, preflightResponse } from './services/cors.js';
import { authenticateVendor, getAdminClient } from './services/vendorAuth.js';

function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

export async function handler(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  if (event.httpMethod === 'OPTIONS') return preflightResponse(origin);

  const ok = ['POST', 'PUT', 'DELETE'];
  if (!ok.includes(event.httpMethod)) return { statusCode: 405, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Method not allowed' }) };

  const { vendor, error } = await authenticateVendor(event);
  if (error) return { statusCode: 401, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error }) };

  const adminClient = getAdminClient();
  const productId = event.queryStringParameters?.id || null;
  const isPost = event.httpMethod === 'POST';
  const isPut = event.httpMethod === 'PUT';
  const isDelete = event.httpMethod === 'DELETE';

  if ((isPut || isDelete) && !productId) return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'id required' }) };

  // DELETE: only allow if vendor owns the product and it's not published
  if (isDelete) {
    const { data: prod } = await adminClient.from('products').select('id, vendor_id, status').eq('id', productId).single();
    if (!prod || prod.vendor_id !== vendor.id) return { statusCode: 403, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Not your product' }) };
    if (prod.status === 'publish' || prod.status === 'published') return { statusCode: 403, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Cannot delete a published product' }) };
    await Promise.all([
      adminClient.from('product_images').delete().eq('product_id', productId),
      adminClient.from('product_category_map').delete().eq('product_id', productId),
      adminClient.from('product_tag_map').delete().eq('product_id', productId),
      adminClient.from('product_attribute_map').delete().eq('product_id', productId),
      adminClient.from('product_variations').delete().eq('product_id', productId),
    ]);
    await adminClient.from('products').delete().eq('id', productId);
    return { statusCode: 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }; }

  const {
    name, slug, description = '', short_description = '',
    status = 'pending_review', type = 'simple',
    regular_price, sale_price, sku = '',
    manage_stock = false, stock_quantity, stock_status = 'instock',
    is_virtual = false, ships_from_abroad = false,
    seo_title = '', seo_description = '',
    images = [], category_ids = [], tag_ids = [],
  } = body;

  const rawAttributes = body.attributes || [];
  const rawVariations = body.variations || [];
  const attributesProvided = 'attributes' in body;
  const variationsProvided = 'variations' in body;

  if (isPost && !name?.trim()) return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'name is required' }) };

  const finalSlug = slug?.trim() || toSlug(name || '');
  if (!finalSlug) return { statusCode: 400, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'slug is required' }) };

  // For PUT: verify ownership
  if (isPut) {
    const { data: existing } = await adminClient.from('products').select('vendor_id').eq('id', productId).single();
    if (!existing || existing.vendor_id !== vendor.id) return { statusCode: 403, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Not your product' }) };
  }

  try {
    const productData = {
      name: name?.trim(),
      slug: finalSlug,
      description, short_description,
      status: ['draft', 'pending_review', 'publish', 'published'].includes(status) ? status : 'pending_review',
      type,
      regular_price: type === 'simple' && regular_price ? Number(regular_price) : null,
      sale_price: type === 'simple' && sale_price ? Number(sale_price) : null,
      sku: sku || null,
      manage_stock: !!manage_stock,
      stock_quantity: manage_stock && stock_quantity ? Number(stock_quantity) : null,
      stock_status,
      is_virtual: !!is_virtual,
      ships_from_abroad: !!ships_from_abroad,
      vendor_id: vendor.id,
      seo_title: seo_title || null,
      seo_description: seo_description || null,
      updated_at: new Date().toISOString(),
    };

    let savedProduct;

    if (isPost) {
      // Check slug uniqueness
      const { data: existing } = await adminClient.from('products').select('id').eq('slug', finalSlug).maybeSingle();
      if (existing) return { statusCode: 409, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'A product with this slug already exists' }) };

      const { data, error: insErr } = await adminClient.from('products').insert(productData).select('id, slug, name, status').single();
      if (insErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: insErr.message }) };
      savedProduct = data;
    } else {
      const { data, error: updErr } = await adminClient.from('products').update(productData).eq('id', productId).select('id, slug, name, status').single();
      if (updErr) return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: updErr.message }) };
      savedProduct = data;
    }

    const pid = savedProduct.id;

    await Promise.all([
      // Images
      (async () => {
        if (images.length === 0 && isPut) return;
        await adminClient.from('product_images').delete().eq('product_id', pid);
        if (images.length > 0) {
          await adminClient.from('product_images').insert(
            images.map((img, i) => ({ product_id: pid, src: img.src, alt: img.alt || '', position: img.position ?? i, is_thumbnail: img.is_thumbnail ?? i === 0 }))
          );
        }
      })(),
      // Categories
      (async () => {
        await adminClient.from('product_category_map').delete().eq('product_id', pid);
        if (category_ids.length > 0) await adminClient.from('product_category_map').insert(category_ids.map(cid => ({ product_id: pid, category_id: cid })));
      })(),
      // Tags
      (async () => {
        await adminClient.from('product_tag_map').delete().eq('product_id', pid);
        if (tag_ids.length > 0) await adminClient.from('product_tag_map').insert(tag_ids.map(tid => ({ product_id: pid, tag_id: tid })));
      })(),
      // Attributes
      (async () => {
        if (!attributesProvided) return;
        await adminClient.from('product_attribute_map').delete().eq('product_id', pid);
        for (let i = 0; i < rawAttributes.length; i++) {
          const attr = rawAttributes[i];
          if (!attr.name?.trim()) continue;
          const attrSlug = attr.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const { data: attrRow } = await adminClient.from('product_attributes').upsert({ name: attr.name.trim(), slug: attrSlug }, { onConflict: 'slug' }).select('id').single();
          if (!attrRow) continue;
          await adminClient.from('product_attribute_map').insert({ product_id: pid, attribute_id: attrRow.id, options: Array.isArray(attr.options) ? attr.options : [], is_variation: attr.is_variation ?? true, display_order: i });
        }
      })(),
      // Variations
      (async () => {
        if (!variationsProvided) return;
        const submittedIds = rawVariations.filter(v => v.id).map(v => v.id);
        if (isPut) {
          let q = adminClient.from('product_variations').update({ is_active: false, updated_at: new Date().toISOString() }).eq('product_id', pid);
          if (submittedIds.length > 0) q = q.not('id', 'in', `(${submittedIds.map(id => `"${id}"`).join(',')})`);
          await q;
        }
        for (const v of rawVariations) {
          const varData = {
            product_id: pid,
            vendor_id: vendor.id,
            sku: v.sku || null,
            regular_price: v.regular_price !== '' ? Number(v.regular_price) : null,
            sale_price: v.sale_price !== '' ? Number(v.sale_price) : null,
            stock_status: v.stock_status || 'instock',
            manage_stock: !!v.manage_stock,
            stock_quantity: v.manage_stock && v.stock_quantity !== '' ? Number(v.stock_quantity) : null,
            attributes: Array.isArray(v.attributes) ? v.attributes : [],
            is_active: true,
            updated_at: new Date().toISOString(),
          };
          let savedVarId = v.id;
          if (v.id) {
            await adminClient.from('product_variations').update(varData).eq('id', v.id).eq('product_id', pid);
          } else {
            const { data: ins } = await adminClient.from('product_variations').insert(varData).select('id').single();
            savedVarId = ins?.id;
          }
          if (savedVarId && v.image_url) {
            await adminClient.from('product_images').delete().eq('variation_id', savedVarId);
            await adminClient.from('product_images').insert({ product_id: pid, variation_id: savedVarId, src: v.image_url, alt: '', position: 0, is_thumbnail: true });
          }
        }
      })(),
    ]);

    return { statusCode: isPost ? 201 : 200, headers: corsHeaders(origin), body: JSON.stringify({ success: true, data: savedProduct }) };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(origin), body: JSON.stringify({ success: false, error: 'Failed to save product', message: err?.message }) };
  }
}
