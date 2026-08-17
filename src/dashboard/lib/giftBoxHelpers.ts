import { toSlug } from './productSku';

export type PoolPickerProduct = {
  id: string;
  name: string;
  sku?: string;
  gift_program_cost?: number | null;
  catalog_price?: number | null;
  available_qty?: number;
  in_pool: boolean;
  line_source?: 'vendor_catalog' | 'jlo_sourced';
};

export type GiftCommercialSettings = {
  packaging_markup: number;
  profit_margin_percent: number;
  profit_margin_fixed: number;
};

export function catalogDisplayPrice(
  product?: { sale_price?: unknown; regular_price?: unknown } | null,
): number | null {
  const sale = Number(product?.sale_price);
  if (Number.isFinite(sale) && sale > 0) return sale;
  const regular = Number(product?.regular_price);
  if (Number.isFinite(regular) && regular > 0) return regular;
  return null;
}

/** Same stack as BYO checkout (packaging fee 0 for ready-made). */
export function computeGiftCustomerPrice(
  componentCostTotal: number,
  settings: GiftCommercialSettings,
): number {
  const costBase = Number(componentCostTotal || 0);
  const packagingMarkup = Number(settings.packaging_markup || 0);
  const marginPct = Number(settings.profit_margin_percent || 0);
  const marginFixed = Number(settings.profit_margin_fixed || 0);
  return Math.round((costBase + packagingMarkup) * (1 + marginPct / 100) + marginFixed);
}

export function normalizeSourcedPickerItems(raw: unknown[]): PoolPickerProduct[] {
  return (raw || [])
    .map((row): PoolPickerProduct | null => {
      const r = row as Record<string, unknown>;
      if (!r.id || !r.name || r.active === false) return null;
      const cost = r.gift_program_cost != null ? Number(r.gift_program_cost) : 0;
      return {
        id: String(r.id),
        name: String(r.name),
        sku: r.sku ? String(r.sku) : undefined,
        gift_program_cost: cost,
        catalog_price: cost,
        available_qty: r.available_qty != null ? Number(r.available_qty) : undefined,
        in_pool: true,
        line_source: 'jlo_sourced',
      };
    })
    .filter((p): p is PoolPickerProduct => p != null);
}

/** URL slug preview — backend applies the same normalisation on save. */
export function giftBoxSlugPreview(name: string): string {
  return toSlug(name) || 'gift-box';
}

/** GBX SKU prefix — sync with netlify/functions/services/gift-box-sku.js */
export function slugToGiftSkuSegment(slug: string | undefined | null): string {
  const raw = String(slug || '').trim().toLowerCase();
  if (!raw || raw === 'any') return 'ANY';
  const normalized = raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'ANY';
}

export function buildGiftBoxSkuPrefix(occasionSlugs: string[] = [], recipientSlugs: string[] = []): string {
  const occ = slugToGiftSkuSegment(occasionSlugs[0] || 'any');
  const rec = slugToGiftSkuSegment(recipientSlugs[0] || 'any');
  return `GBX-${occ}-${rec}-`;
}

/** Normalise admin-gift-pool list (inventory rows) or search (flat products). */
export function normalizePoolPickerItems(raw: unknown[]): PoolPickerProduct[] {
  const mapped = (raw || [])
    .map((row): PoolPickerProduct | null => {
      const r = row as Record<string, unknown>;
      const nested = r.products as Record<string, unknown> | undefined;
      if (nested?.id) {
        const catalog = catalogDisplayPrice(nested);
        const program =
          r.gift_program_cost != null && r.gift_program_cost !== ''
            ? Number(r.gift_program_cost)
            : catalog;
        return {
          id: String(nested.id),
          name: String(nested.name || 'Product'),
          sku: nested.sku ? String(nested.sku) : undefined,
          gift_program_cost: program,
          catalog_price: catalog,
          available_qty: r.available_qty != null ? Number(r.available_qty) : undefined,
          in_pool: r.active !== false,
          line_source: 'vendor_catalog',
        };
      }
      if (r.id && r.name) {
        const catalog = catalogDisplayPrice(r);
        return {
          id: String(r.id),
          name: String(r.name),
          sku: r.sku ? String(r.sku) : undefined,
          gift_program_cost: catalog,
          catalog_price: catalog,
          in_pool: Boolean(r.in_pool),
          line_source: 'vendor_catalog',
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
