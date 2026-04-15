/**
 * ProductModeration caches catalog list pages in sessionStorage under this prefix.
 * Clear after mutations (delete, etc.) so other pages don't show stale rows.
 */
const PRODUCT_LIST_CACHE_PREFIX = 'jlo_products_';

export function clearProductListSessionCache(): void {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(PRODUCT_LIST_CACHE_PREFIX))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
