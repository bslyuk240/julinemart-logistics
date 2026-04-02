import {
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  requestWoo,
  requireAdmin,
} from './services/global-sourcing-utils.js';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  try {
    // Fetch all taxonomy data in parallel
    const [categoriesRaw, tagsRaw, shippingClassesRaw] = await Promise.all([
      requestWoo('/products/categories?per_page=100&orderby=name&order=asc').catch(() => []),
      requestWoo('/products/tags?per_page=100&orderby=name&order=asc').catch(() => []),
      requestWoo('/products/shipping_classes?per_page=100').catch(() => []),
    ]);

    const categories = Array.isArray(categoriesRaw)
      ? categoriesRaw.map((c) => ({ id: c.id, name: c.name, slug: c.slug, parent: c.parent || 0 }))
      : [];

    const tags = Array.isArray(tagsRaw)
      ? tagsRaw.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))
      : [];

    const shippingClasses = Array.isArray(shippingClassesRaw)
      ? shippingClassesRaw.map((s) => ({ id: s.id, name: s.name, slug: s.slug }))
      : [];

    return jsonResponse(200, {
      success: true,
      data: { categories, tags, shippingClasses },
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Failed to load product meta',
      message: error?.message,
    });
  }
}
