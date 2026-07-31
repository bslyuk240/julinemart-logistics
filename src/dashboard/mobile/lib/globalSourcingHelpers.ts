import { callGlobalSourcing, type ProductDetails, type ProductVariant, type SearchProduct } from './globalSourcingApi';

const cjProductBaseUrl = 'https://cjdropshipping.com/product';

export function slugifyCjProductTitle(value?: string | null) {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCjProductUrl(title?: string | null, externalProductId?: string | null) {
  const productId = String(externalProductId || '').trim();
  const slug = slugifyCjProductTitle(title);
  if (!productId || !slug) return null;
  return `${cjProductBaseUrl}/${slug}-p-${productId}.html`;
}

export function getSearchResultFlags(product: SearchProduct) {
  const flags: Array<{ label: string; tone: 'red' | 'amber' | 'green' }> = [];
  if (!product.title?.trim()) flags.push({ label: 'Missing title', tone: 'red' });
  if (!Array.isArray(product.images) || product.images.length === 0) flags.push({ label: 'Missing image', tone: 'red' });
  if (product.source_price === null) flags.push({ label: 'Missing price', tone: 'red' });
  if (!product.variants_summary?.trim()) flags.push({ label: 'Inspect variants', tone: 'amber' });
  if (flags.length === 0) flags.push({ label: 'Looks usable', tone: 'green' });
  return flags;
}

export function getInspectedProductFlags(product: ProductDetails | null) {
  if (!product) return [];
  const flags: Array<{ label: string; tone: 'red' | 'amber' | 'green' }> = [];
  const validVariants = product.variants.filter((v) => v.external_variant_id && v.source_price !== null);
  if (!product.title?.trim()) flags.push({ label: 'Missing title', tone: 'red' });
  if (!product.images?.length) flags.push({ label: 'Missing image', tone: 'red' });
  if (!product.description?.trim()) flags.push({ label: 'Missing description', tone: 'amber' });
  if (product.variants.length === 0) flags.push({ label: 'No variants', tone: 'red' });
  else if (validVariants.length === 0) flags.push({ label: 'No priced variant', tone: 'red' });
  if (flags.length === 0) flags.push({ label: 'Import ready', tone: 'green' });
  return flags;
}

export function flagToneClasses(tone: 'red' | 'amber' | 'green') {
  if (tone === 'red') return 'border-red-200 bg-red-50 text-red-700';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-green-200 bg-green-50 text-green-700';
}

function humanizeVariantFragment(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getVariantOptionLabel(variant: ProductVariant, index: number, productTitle?: string) {
  const attributeLabel = Object.entries(variant.attributes || {})
    .map(([name, value]) => `${name}: ${value}`)
    .join(' / ');
  const rawTitle = variant.title?.trim() || '';
  const normalizedProductTitle = productTitle?.trim().toLowerCase() || '';
  let condensedTitle = rawTitle;
  if (rawTitle && normalizedProductTitle && rawTitle.toLowerCase().startsWith(normalizedProductTitle)) {
    condensedTitle = rawTitle.slice(productTitle?.trim().length || 0).trim();
  }
  const baseLabel =
    humanizeVariantFragment(condensedTitle) ||
    humanizeVariantFragment(rawTitle) ||
    attributeLabel ||
    (variant.external_variant_id ? `Variant ${variant.external_variant_id}` : `Variant ${index + 1}`);
  return variant.source_price !== null ? `${baseLabel} · ${variant.currency} ${variant.source_price}` : baseLabel;
}

export async function hydrateCjProductForImport({
  product,
  externalProductId,
  fallbackTitle,
  fallbackDescription = '',
  fallbackImages = [],
  fallbackSourcePrice = null,
  fallbackCurrency = 'USD',
}: {
  product?: ProductDetails | null;
  externalProductId: string;
  fallbackTitle?: string;
  fallbackDescription?: string;
  fallbackImages?: string[];
  fallbackSourcePrice?: number | null;
  fallbackCurrency?: string;
}): Promise<ProductDetails> {
  if (product) {
    const candidateImages = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const descriptionImages = Array.isArray(product.description_images) ? product.description_images.filter(Boolean) : [];
    return {
      ...product,
      external_product_id: product.external_product_id || externalProductId,
      title: product.title?.trim() || fallbackTitle || 'CJ product',
      description: product.description?.trim() || fallbackDescription,
      description_images: descriptionImages,
      images: candidateImages.length > 0 ? candidateImages : fallbackImages,
      source_price: product.source_price ?? fallbackSourcePrice,
      currency: product.currency || fallbackCurrency || 'USD',
      supplier_source: product.supplier_source || product.provider,
      supplier_product_id: product.supplier_product_id || product.external_product_id || externalProductId,
      supplier_url: product.supplier_url || buildCjProductUrl(product.title, product.external_product_id),
      inbound_shipping_usd: product.inbound_shipping_usd ?? null,
      variants: Array.isArray(product.variants)
        ? product.variants.map((variant) => ({
            ...variant,
            inbound_shipping_usd: variant.inbound_shipping_usd ?? product.inbound_shipping_usd ?? null,
          }))
        : [],
    };
  }

  const response = await callGlobalSourcing<{ data: { product: ProductDetails } }>('cj-product-details', {
    method: 'POST',
    body: JSON.stringify({ external_product_id: externalProductId }),
  });

  const fetched = response.data.product;
  const candidateImages = Array.isArray(fetched.images) ? fetched.images.filter(Boolean) : [];
  const descriptionImages = Array.isArray(fetched.description_images) ? fetched.description_images.filter(Boolean) : [];

  return {
    ...fetched,
    external_product_id: fetched.external_product_id || externalProductId,
    title: fetched.title?.trim() || fallbackTitle || 'CJ product',
    description: fetched.description?.trim() || fallbackDescription,
    description_images: descriptionImages,
    images: candidateImages.length > 0 ? candidateImages : fallbackImages,
    source_price: fetched.source_price ?? fallbackSourcePrice,
    currency: fetched.currency || fallbackCurrency || 'USD',
    supplier_url: fetched.supplier_url || buildCjProductUrl(fetched.title, fetched.external_product_id),
  };
}

export function pickDefaultInboundHub<T extends { id: string; is_default?: boolean | null; metadata?: Record<string, unknown> | null }>(
  hubs: T[],
): T | undefined {
  return (
    hubs.find((hub) => {
      if (hub.is_default === true) return true;
      const metadata = hub.metadata && typeof hub.metadata === 'object' ? hub.metadata : {};
      return (
        metadata.default_inbound === true ||
        metadata.is_default_inbound === true ||
        metadata.defaultInbound === true ||
        metadata.isDefaultInbound === true
      );
    }) || hubs[0]
  );
}
