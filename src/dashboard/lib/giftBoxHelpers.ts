import { toSlug } from './productSku';

export type PoolPickerProduct = {
  id: string;
  name: string;
  sku?: string;
  gift_program_cost?: number | null;
  available_qty?: number;
  in_pool: boolean;
};

/** URL slug preview — backend applies the same normalisation on save. */
export function giftBoxSlugPreview(name: string): string {
  return toSlug(name) || 'gift-box';
}

/** Normalise admin-gift-pool list (inventory rows) or search (flat products). */
export function normalizePoolPickerItems(raw: unknown[]): PoolPickerProduct[] {
  const mapped = (raw || [])
    .map((row): PoolPickerProduct | null => {
      const r = row as Record<string, unknown>;
      const nested = r.products as Record<string, unknown> | undefined;
      if (nested?.id) {
        return {
          id: String(nested.id),
          name: String(nested.name || 'Product'),
          sku: nested.sku ? String(nested.sku) : undefined,
          gift_program_cost:
            r.gift_program_cost != null ? Number(r.gift_program_cost) : null,
          available_qty: r.available_qty != null ? Number(r.available_qty) : undefined,
          in_pool: r.active !== false,
        };
      }
      if (r.id && r.name) {
        return {
          id: String(r.id),
          name: String(r.name),
          sku: r.sku ? String(r.sku) : undefined,
          in_pool: Boolean(r.in_pool),
        };
      }
      return null;
    });

  return mapped.filter((p): p is PoolPickerProduct => p != null && p.in_pool);
}

export function filterPoolPickerItems(
  items: PoolPickerProduct[],
  query: string,
  excludeProductIds: string[] = [],
): PoolPickerProduct[] {
  const exclude = new Set(excludeProductIds);
  const q = query.trim().toLowerCase();
  return items.filter((p) => {
    if (exclude.has(p.id)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q))
    );
  });
}
