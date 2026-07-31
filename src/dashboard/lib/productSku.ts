// Shared with the mobile Product Upload screen — these were previously
// defined only inside the desktop ProductUpload.tsx page. Extracted so SKU
// generation can't silently diverge between the two surfaces.

export interface CategoryLike {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
}

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Parse optional dimension/weight field: empty → null, invalid → null. */
export function toNullableDim(value: string): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function decodeBasicHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function skuCodeFromPrimarySegment(rawSeg: string, padSource: string, len = 3): string {
  const alnum = rawSeg.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let core = alnum.slice(0, len);
  if (core.length < len) {
    const pad = toSlug(padSource || 'x').replace(/[^a-z0-9]/gi, '').toUpperCase();
    core = (core + pad).slice(0, len);
  }
  return core.padEnd(len, 'X').slice(0, len);
}

/**
 * Category prefix: prefer the first word of the **name** (slugified).
 * Child Woo slugs often repeat the parent (`electronics-electronics-3` → would wrongly be ELE for every subcategory).
 */
export function categorySkuCode(name: string, slug: string, len = 3): string {
  const clean = decodeBasicHtmlEntities(name || '');
  const nameSeg = toSlug(clean).split('-').filter(Boolean)[0] || '';
  const slugSeg = (slug || '').split('-').filter(Boolean)[0] || '';
  const raw = nameSeg || slugSeg || 'x';
  return skuCodeFromPrimarySegment(raw, clean || slug, len);
}

/** Vendor prefix: prefer **store_slug** first segment (stable store codes), then name. */
export function vendorSkuCode(slug: string, name: string, len = 3): string {
  const slugSeg = (slug || '').split('-').filter(Boolean)[0] || '';
  const nameSeg = toSlug(decodeBasicHtmlEntities(name || '')).split('-').filter(Boolean)[0] || '';
  const raw = slugSeg || nameSeg || 'x';
  return skuCodeFromPrimarySegment(raw, name || slug, len);
}

/** Selected categories in tree order (parent block, then children) for a stable "primary" category. */
export function orderedSelectedCategoryIds(allCategories: CategoryLike[], categoryIds: string[]): string[] {
  const sel = new Set(categoryIds);
  const out: string[] = [];
  const tops = allCategories.filter((c) => !c.parent_id);
  for (const t of tops) {
    if (sel.has(t.id)) out.push(t.id);
    for (const ch of allCategories.filter((c) => c.parent_id === t.id)) {
      if (sel.has(ch.id)) out.push(ch.id);
    }
  }
  return out;
}
