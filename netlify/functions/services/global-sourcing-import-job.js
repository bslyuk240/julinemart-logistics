import {
  buildGlobalSourcingMeta,
  computeWooNgnPricing,
  isPlainObject,
  loadGlobalSourcingPricingDefaults,
  normalizeAttributeName,
  normalizeAttributeOption,
  normalizeImages,
  normalizeProductDescription,
  normalizeProductTitle,
  resolveVendorMapping,
} from './global-sourcing-utils.js';
import {
  buildLandedPricingPreview,
  isUsablePricingPreview,
  resolveReceivingHub,
} from './global-sourcing-cj.js';

const JOB_TABLE = 'global_sourcing_import_jobs';

const MAX_PRODUCT_IMAGE_UPLOADS = Math.max(
  Number(process.env.GLOBAL_SOURCING_MAX_PRODUCT_IMAGES || 6) || 6,
  1
);
const MAX_VARIATIONS_PER_BATCH = Math.max(
  Number(process.env.GLOBAL_SOURCING_MAX_VARIATIONS_PER_BATCH || 20) || 20,
  1
);

function createImportError(message, statusCode = 500, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== null && details !== undefined) error.details = details;
  return error;
}

function normalizeSelectedVariant(payload) {
  const source = isPlainObject(payload?.selected_variant) ? payload.selected_variant : {};
  return {
    externalVariantId: String(
      payload?.external_variant_id || payload?.cj_vid ||
      source.external_variant_id || source.cj_vid || ''
    ).trim() || null,
    title: String(source.title || source.variant_title || payload?.variant_title || '').trim() || null,
    image:
      typeof source.image === 'string' ? source.image.trim()
      : typeof source.image?.src === 'string' ? source.image.src.trim()
      : null,
    sourcePrice: source.source_price ?? payload?.supplier_price_snapshot ?? payload?.regular_price ?? null,
    currency: String(source.currency || payload?.currency || 'USD').trim().toUpperCase(),
    inboundShippingUsd: source.inbound_shipping_usd ?? payload?.inbound_shipping_usd ?? null,
    attributes: source.attributes,
  };
}

function normalizeSelectedAttributes(payload, selectedVariant) {
  const source =
    payload?.selected_attributes || payload?.selectedAttributes ||
    payload?.variant_attributes || payload?.variantAttributes ||
    selectedVariant?.attributes || {};

  const rows = Array.isArray(source)
    ? source
    : isPlainObject(source)
    ? Object.entries(source).map(([name, value]) => ({ name, value }))
    : [];

  const deduped = new Map();
  rows.forEach((entry) => {
    const rawName = String(entry?.name || entry?.attributeName || '').trim();
    const rawValue = String(entry?.value || entry?.option || '').trim();
    const name = normalizeAttributeName(rawName);
    const value = normalizeAttributeOption(rawValue);
    if (!name || !value) return;
    deduped.set(name.toLowerCase(), { name, value });
  });

  return Array.from(deduped.values());
}

function normalizeImportVariant(entry) {
  const source = isPlainObject(entry) ? entry : {};
  return {
    externalVariantId: String(
      source.external_variant_id || source.cj_vid || source.externalVariantId || source.vid || ''
    ).trim() || null,
    title: String(source.title || source.variant_title || source.name || '').trim() || null,
    image:
      typeof source.image === 'string' ? source.image.trim()
      : typeof source.image?.src === 'string' ? source.image.src.trim()
      : null,
    sourcePrice: source.source_price ?? source.supplier_price_snapshot ?? source.price ?? source.regular_price ?? null,
    currency: String(source.currency || 'USD').trim().toUpperCase(),
    inboundShippingUsd: source.inbound_shipping_usd ?? null,
    attributes: normalizeSelectedAttributes({ selected_attributes: source.attributes || {} }, null),
  };
}

function buildImportVariants(payload, selectedVariant, selectedAttributes) {
  const sourceVariants = Array.isArray(payload?.variants) ? payload.variants.map(normalizeImportVariant) : [];
  const fallbackVariant =
    selectedVariant?.externalVariantId || selectedAttributes.length > 0
      ? [{
          externalVariantId: selectedVariant.externalVariantId,
          title: selectedVariant.title,
          image: selectedVariant.image,
          sourcePrice: selectedVariant.sourcePrice,
          currency: selectedVariant.currency,
          inboundShippingUsd: selectedVariant.inboundShippingUsd,
          attributes: selectedAttributes,
        }]
      : [];

  const variants = sourceVariants.length > 0 ? sourceVariants : fallbackVariant;
  const deduped = new Map();
  variants.forEach((variant, index) => {
    const key =
      variant.externalVariantId ||
      `${variant.attributes.map((a) => `${a.name.toLowerCase()}:${a.value.toLowerCase()}`).sort().join('|')}:${index}`;
    if (!deduped.has(key)) deduped.set(key, variant);
  });
  return Array.from(deduped.values());
}

function humanizeVariantTitle(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripTitlePrefix(label, productTitle) {
  const normalizedLabel = humanizeVariantTitle(label);
  const normalizedTitle = humanizeVariantTitle(productTitle);
  if (!normalizedLabel || !normalizedTitle) return normalizedLabel;
  const prefixPattern = new RegExp(`^${escapeRegExp(normalizedTitle)}\\s*`, 'i');
  return normalizedLabel.replace(prefixPattern, '').trim() || normalizedLabel;
}

function removeCommonLeadingTokens(labels) {
  const tokenized = labels
    .map((label) => humanizeVariantTitle(label).split(/\s+/).filter(Boolean))
    .filter((parts) => parts.length > 0);
  if (tokenized.length <= 1) return labels.map((label) => humanizeVariantTitle(label));

  let sharedCount = 0;
  while (sharedCount < tokenized[0].length) {
    const candidate = tokenized[0][sharedCount];
    if (!candidate) break;
    const matchesAll = tokenized.every(
      (parts) => String(parts[sharedCount] || '').toLowerCase() === candidate.toLowerCase()
    );
    if (!matchesAll) break;
    sharedCount += 1;
  }
  if (sharedCount === 0) return labels.map((label) => humanizeVariantTitle(label));
  return tokenized.map((parts, index) => {
    const trimmed = parts.slice(sharedCount).join(' ').trim();
    return trimmed || humanizeVariantTitle(labels[index]);
  });
}

function isSizeLikeToken(token) {
  const normalized = String(token || '').trim();
  return (
    /^\d+(?:\.\d+)?$/.test(normalized) ||
    /^(?:xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl)$/i.test(normalized) ||
    /^(?:one\s*size|free\s*size)$/i.test(normalized)
  );
}

function inferFallbackVariantAttributes(variants, productTitle) {
  const baseVariants = Array.isArray(variants) ? variants : [];
  const strippedLabels = removeCommonLeadingTokens(
    baseVariants.map((variant) =>
      stripTitlePrefix(
        String(variant.title || '').trim() ||
          (variant.externalVariantId ? `Variant ${variant.externalVariantId}` : ''),
        productTitle
      )
    )
  );

  const parsedRows = strippedLabels.map((label) => {
    const parts = humanizeVariantTitle(label).split(/\s+/).filter(Boolean);
    const lastToken = parts[parts.length - 1] || '';
    const hasSizeSuffix = parts.length >= 2 && isSizeLikeToken(lastToken);
    return {
      label: humanizeVariantTitle(label),
      colorValue: hasSizeSuffix ? parts.slice(0, -1).join(' ').trim() : '',
      sizeValue: hasSizeSuffix ? lastToken.trim() : '',
    };
  });

  const tokenizedRows = parsedRows.map((row) => row.label.split(/\s+/).filter(Boolean));
  const sharedModelAnchor = tokenizedRows[0]?.find((token, tokenIndex) => {
    if (tokenIndex === 0) return false;
    return tokenizedRows.every((parts) =>
      parts.some((part, partIndex) => partIndex > 0 && part.toLowerCase() === token.toLowerCase())
    );
  });

  if (sharedModelAnchor) {
    const splitRows = tokenizedRows.map((parts) => {
      const anchorIndex = parts.findIndex(
        (part, index) => index > 0 && part.toLowerCase() === sharedModelAnchor.toLowerCase()
      );
      return {
        colorValue: anchorIndex > 0 ? parts.slice(0, anchorIndex).join(' ').trim() : '',
        modelValue: anchorIndex >= 0 ? parts.slice(anchorIndex).join(' ').trim() : '',
      };
    });
    const colorCount = splitRows.filter((row) => row.colorValue).length;
    const modelCount = splitRows.filter((row) => row.modelValue).length;
    const uniqueColors = new Set(splitRows.map((row) => row.colorValue.toLowerCase()).filter(Boolean));
    const uniqueModels = new Set(splitRows.map((row) => row.modelValue.toLowerCase()).filter(Boolean));
    if (colorCount === baseVariants.length && modelCount === baseVariants.length && uniqueColors.size > 1 && uniqueModels.size > 1) {
      return baseVariants.map((variant, index) => ({
        ...variant,
        attributes: [
          { name: 'Colour', value: splitRows[index].colorValue },
          { name: 'Model', value: splitRows[index].modelValue },
        ],
      }));
    }
  }

  const colorCount = parsedRows.filter((row) => row.colorValue).length;
  const sizeCount = parsedRows.filter((row) => row.sizeValue).length;
  const uniqueColors = new Set(parsedRows.map((row) => row.colorValue.toLowerCase()).filter(Boolean));
  const uniqueSizes = new Set(parsedRows.map((row) => row.sizeValue.toLowerCase()).filter(Boolean));

  if (colorCount === baseVariants.length && sizeCount === baseVariants.length && uniqueColors.size > 1 && uniqueSizes.size > 1) {
    return baseVariants.map((variant, index) => ({
      ...variant,
      attributes: [
        { name: 'Colour', value: parsedRows[index].colorValue },
        { name: 'Size', value: parsedRows[index].sizeValue },
      ],
    }));
  }
  if (sizeCount === baseVariants.length && uniqueSizes.size > 1) {
    return baseVariants.map((variant, index) => ({
      ...variant,
      attributes: [{ name: 'Size', value: parsedRows[index].sizeValue }],
    }));
  }
  if (colorCount === baseVariants.length && uniqueColors.size > 1) {
    return baseVariants.map((variant, index) => ({
      ...variant,
      attributes: [{ name: 'Colour', value: parsedRows[index].colorValue }],
    }));
  }
  return baseVariants.map((variant, index) => ({
    ...variant,
    attributes: [{
      name: 'Option',
      value:
        parsedRows[index].label ||
        String(variant.title || '').trim() ||
        (variant.externalVariantId ? `Variant ${variant.externalVariantId}` : `Variant ${index + 1}`),
    }],
  }));
}

function ensureVariantAttributes(variants, productTitle = '') {
  const normalized = Array.isArray(variants) ? variants : [];
  if (normalized.length <= 1) return normalized;
  const hasStructuredAttributes = normalized.some((variant) => variant.attributes.length > 0);
  if (hasStructuredAttributes) return normalized;
  return inferFallbackVariantAttributes(normalized, productTitle);
}

function mapProductImages(productImages, selectedVariantImage) {
  const normalized = normalizeImages([
    selectedVariantImage,
    ...(Array.isArray(productImages) ? productImages : []),
  ]);
  return normalized.map((src, index) => ({ src, position: index }));
}

function slugifyTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildDescriptionHtml(descriptionText, descriptionImages, title) {
  const blocks = [];
  const lines = String(descriptionText || '').split('\n').map((l) => String(l || '').trim()).filter(Boolean);
  const listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.join('')}</ul>`);
    listItems.length = 0;
  };
  for (const line of lines) {
    if (line.startsWith('- ')) { listItems.push(`<li>${escapeHtml(line.slice(2))}</li>`); continue; }
    flushList();
    blocks.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushList();
  const altText = escapeHtml(title || 'Product detail image');
  for (const imageUrl of descriptionImages) {
    const url = String(imageUrl || '').trim();
    if (!url) continue;
    blocks.push(`<p><img src="${escapeHtml(url)}" alt="${altText}" /></p>`);
  }
  return blocks.join('\n').trim();
}

function buildProductAttributesMatrix(variants) {
  const attributes = new Map();
  variants.forEach((variant) => {
    variant.attributes.forEach((attribute) => {
      const key = attribute.name.toLowerCase();
      if (!attributes.has(key)) attributes.set(key, { name: attribute.name, options: new Map() });
      const bucket = attributes.get(key);
      if (!bucket.options.has(attribute.value.toLowerCase())) {
        bucket.options.set(attribute.value.toLowerCase(), attribute.value);
      }
    });
  });
  return Array.from(attributes.values()).map((attribute) => ({
    name: attribute.name,
    options: Array.from(attribute.options.values()),
  }));
}

function buildAttributeSignature(attributes) {
  return attributes
    .map((a) => ({
      name: String(a?.name || '').trim().toLowerCase(),
      value: String(a?.value || a?.option || '').trim().toLowerCase(),
    }))
    .filter((a) => a.name && a.value)
    .sort((l, r) => l.name.localeCompare(r.name) || l.value.localeCompare(r.value))
    .map((a) => `${a.name}:${a.value}`)
    .join('|');
}

function buildDerivedVariantPricingPreview({ variant, anchorPreview, receivingHubId, receivingHubName, pricingConfig }) {
  const pricing = computeWooNgnPricing({
    sourcePrice: variant.sourcePrice,
    sourceCurrency: variant.currency,
    inboundShippingUsd: anchorPreview.inbound_shipping_quote_usd,
    importBufferUsd: pricingConfig.importBufferUsd,
    markupPercent: pricingConfig.markupPercent,
    markupFlatNgn: pricingConfig.markupFlatNgn,
    usdToNgnRate: pricingConfig.usdToNgnRate,
  });
  return {
    provider: anchorPreview.provider || 'cj',
    pricing_mode: 'landed',
    generated_at: new Date().toISOString(),
    receiving_hub_id: receivingHubId,
    receiving_hub_name: receivingHubName,
    selected_variant_id: variant.externalVariantId,
    supplier_price_usd: Number(pricing.supplierPriceUsd.toFixed(2)),
    inbound_shipping_quote_usd: Number(pricing.inboundShippingUsd.toFixed(2)),
    import_buffer_usd: Number(pricing.importBufferUsd.toFixed(2)),
    landed_cost_usd: Number(pricing.landedCostUsd.toFixed(2)),
    exchange_rate: pricing.exchangeRate,
    usd_to_ngn_rate_used: anchorPreview.usd_to_ngn_rate_used ?? pricing.exchangeRate,
    usd_to_ngn_rate_source: anchorPreview.usd_to_ngn_rate_source || 'cached_api',
    fx_rate_fetched_at: anchorPreview.fx_rate_fetched_at || null,
    fx_rate_note: anchorPreview.fx_rate_note || null,
    markup_percent: pricing.markupPercent,
    markup_flat_ngn: pricing.markupFlatNgn,
    final_price_ngn: pricing.regularPriceWoo,
    sale_price_ngn: pricing.salePriceWoo,
    estimated_inbound_days_min: anchorPreview.estimated_inbound_days_min ?? null,
    estimated_inbound_days_max: anchorPreview.estimated_inbound_days_max ?? null,
    carrier_name: anchorPreview.carrier_name || null,
    freight_endpoint: anchorPreview.freight_endpoint || null,
  };
}

function appendUniqueStrings(existingValues, nextValues) {
  const merged = new Set(
    [...(Array.isArray(existingValues) ? existingValues : []), ...(Array.isArray(nextValues) ? nextValues : [])]
      .map((v) => String(v || '').trim()).filter(Boolean)
  );
  return Array.from(merged.values());
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

/**
 * Ensure a tag exists in the `tags` table by slug. Returns its UUID.
 */
async function ensureSupabaseTag(adminClient, { name, slug }) {
  const { data: existing } = await adminClient.from('tags').select('id').eq('slug', slug).maybeSingle();
  if (existing) return existing.id;
  const { data: inserted } = await adminClient
    .from('tags').insert({ name, slug }).select('id').single();
  return inserted?.id || null;
}

/**
 * Ensure a product_attribute row exists by slug. Returns its UUID.
 */
async function ensureSupabaseAttribute(adminClient, { name, slug }) {
  const { data: existing } = await adminClient
    .from('product_attributes').select('id').eq('slug', slug).maybeSingle();
  if (existing) return existing.id;
  const { data: inserted } = await adminClient
    .from('product_attributes').insert({ name, slug, type: 'select' }).select('id').single();
  return inserted?.id || null;
}

/**
 * Find existing Supabase product by CJ product ID stored in sourcing_meta.
 */
async function findExistingProduct(adminClient, cjProductId) {
  const { data } = await adminClient
    .from('products')
    .select('id, slug, status, type')
    .eq("sourcing_meta->>'cj_product_id'", cjProductId)
    .maybeSingle();
  return data || null;
}

/**
 * Write product images to product_images table. Clears existing first.
 */
async function writeProductImages(adminClient, productId, images) {
  await adminClient.from('product_images').delete().eq('product_id', productId).is('variation_id', null);
  if (images.length === 0) return;
  await adminClient.from('product_images').insert(
    images.map((img, i) => ({
      product_id: productId,
      src: img.src,
      alt: img.alt || '',
      position: img.position ?? i,
      is_thumbnail: i === 0,
    }))
  );
}

/**
 * Write variation image to product_images with variation_id set.
 */
async function writeVariationImage(adminClient, productId, variationId, imageUrl) {
  if (!imageUrl) return;
  await adminClient.from('product_images').delete().eq('variation_id', variationId);
  await adminClient.from('product_images').insert({
    product_id: productId,
    variation_id: variationId,
    src: imageUrl,
    alt: '',
    position: 0,
    is_thumbnail: true,
  });
}

/**
 * Upsert product_attribute_map rows for a product.
 */
async function writeProductAttributes(adminClient, productId, attributesMatrix) {
  await adminClient.from('product_attribute_map').delete().eq('product_id', productId);
  for (let i = 0; i < attributesMatrix.length; i++) {
    const attr = attributesMatrix[i];
    const attrSlug = attr.name.toLowerCase().replace(/\s+/g, '-');
    const attrId = await ensureSupabaseAttribute(adminClient, { name: attr.name, slug: attrSlug });
    if (!attrId) continue;
    await adminClient.from('product_attribute_map').insert({
      product_id: productId,
      attribute_id: attrId,
      options: attr.options,
      is_variation: true,
      display_order: i,
    });
  }
}

// ─── Job state helpers ────────────────────────────────────────────────────────

function shapeJobRow(job) {
  return {
    job_id: String(job.id),
    provider: job.provider || 'cj',
    status: String(job.status || 'queued'),
    progress_stage: job.progress_stage || null,
    progress_current: Number(job.progress_current || 0),
    progress_total: Number(job.progress_total || 0),
    result: isPlainObject(job.result) ? job.result : null,
    error_message: job.error_message || null,
    error_details: isPlainObject(job.error_details) ? job.error_details : null,
    started_at: job.started_at || null,
    completed_at: job.completed_at || null,
    failed_at: job.failed_at || null,
    created_at: job.created_at || null,
    updated_at: job.updated_at || null,
  };
}

async function loadJobRow(adminClient, jobId) {
  const { data, error } = await adminClient.from(JOB_TABLE).select('*').eq('id', jobId).maybeSingle();
  if (error) throw createImportError(error.message || 'Unable to load import job', 500, error);
  if (!data) throw createImportError('Import job not found', 404);
  return data;
}

async function updateJobRow(adminClient, jobId, patch) {
  const { data, error } = await adminClient
    .from(JOB_TABLE).update(patch).eq('id', jobId).select('*').single();
  if (error || !data) throw createImportError(error?.message || 'Unable to update import job', 500, error);
  return data;
}

async function failJob(adminClient, job, stage, error) {
  return updateJobRow(adminClient, job.id, {
    status: 'failed',
    progress_stage: stage || 'failed',
    error_message: error?.message || 'Unable to process import job',
    error_details: { stage: stage || 'unknown', response: error?.responseBody || error?.details || null },
    failed_at: new Date().toISOString(),
  });
}

function buildCompletionResult(cursor) {
  const importedVariationIds = appendUniqueStrings(cursor.importedVariationIds, []);
  const warnings = Array.isArray(cursor.warnings)
    ? cursor.warnings.map((w) => String(w || '').trim()).filter(Boolean)
    : [];
  const effectiveImportedVariantCount = cursor.shouldCreateVariations
    ? importedVariationIds.length
    : Math.min(Number(cursor.importableVariantCount || 0), 1);
  const skippedVariantCount = Math.max(Number(cursor.importVariantCount || 0) - effectiveImportedVariantCount, 0);

  return {
    provider: cursor.provider,
    supabase_product_id: cursor.productSummary?.supabase_id || null,
    product_name: cursor.productSummary?.name || null,
    product_status: cursor.productSummary?.status || null,
    product_type: cursor.productSummary?.type || null,
    imported_variation_count: importedVariationIds.length,
    skipped_variant_count: skippedVariantCount,
    vendor_mapping: {
      vendor_id: cursor.vendorMapping?.id || null,
      woocommerce_vendor_id: cursor.vendorMapping?.woocommerce_vendor_id || null,
      store_name: cursor.vendorMapping?.store_name || null,
    },
    fulfillment_mode: cursor.fulfillmentMode || null,
    receiving_hub_id: cursor.receivingHub?.id || null,
    pricing: {
      source_currency: cursor.sourceCurrency || 'USD',
      supplier_price_usd: cursor.pricingPreview?.supplier_price_usd ?? null,
      inbound_shipping_quote_usd: cursor.pricingPreview?.inbound_shipping_quote_usd ?? null,
      landed_cost_usd: cursor.pricingPreview?.landed_cost_usd ?? null,
      usd_to_ngn_rate_used: cursor.pricingPreview?.usd_to_ngn_rate_used ?? null,
      regular_price_ngn: cursor.pricingPreview?.final_price_ngn ?? null,
      sale_price_ngn: cursor.pricingPreview?.sale_price_ngn ?? null,
    },
    notes: [
      'Product written directly to Supabase catalog.',
      cursor.shouldCreateVariations
        ? `Imported ${importedVariationIds.length} supplier variant(s) as Supabase product_variations.`
        : 'Imported as a simple product.',
      ...(warnings.length > 0 ? [`${warnings.length} warning(s) recorded.`] : []),
    ],
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function completeJob(adminClient, job, cursor) {
  const result = buildCompletionResult(cursor);
  const completed = await updateJobRow(adminClient, job.id, {
    status: 'completed',
    progress_stage: 'completed',
    progress_current: Number(job.progress_total || 0) || Number(cursor.progressTotal || 1),
    progress_total: Number(job.progress_total || 0) || Number(cursor.progressTotal || 1),
    cursor,
    result,
    error_message: null,
    error_details: null,
    completed_at: new Date().toISOString(),
  });
  return completed;
}

// ─── Payload parsing ──────────────────────────────────────────────────────────

function parseImportPayload(payload) {
  const provider = String(payload?.provider || 'cj').trim().toLowerCase();
  const externalProductId = String(payload?.external_product_id || payload?.cj_pid || '').trim();
  const supplierSource = String(payload?.supplier_source || provider || '').trim().toLowerCase() || null;
  const supplierProductId = String(payload?.supplier_product_id || payload?.external_product_id || payload?.cj_pid || '').trim() || null;
  const supplierUrl = String(payload?.supplier_url || '').trim() || null;
  const receivingHubId = String(payload?.receiving_hub_id || '').trim() || null;
  const fulfillmentMode = String(payload?.fulfillment_mode || 'cj_hub').trim() || 'cj_hub';
  const targetVendorId = String(payload?.target_vendor_mapping?.vendor_id || payload?.target_vendor_mapping?.id || '').trim();
  const targetWooVendorId = String(
    payload?.target_vendor_mapping?.woocommerce_vendor_id ||
    payload?.target_vendor_mapping?.woo_vendor_id ||
    payload?.target_vendor_mapping?.wcfm_vendor_id || ''
  ).trim();
  return { provider, externalProductId, supplierSource, supplierProductId, supplierUrl, receivingHubId, fulfillmentMode, targetVendorId, targetWooVendorId };
}

function validateImportPayload(payload) {
  const parsed = parseImportPayload(payload);
  if (!['cj', 'aliexpress'].includes(parsed.provider)) {
    throw createImportError('Only provider=cj and provider=aliexpress are supported', 400);
  }
  if (!parsed.externalProductId || (!parsed.targetVendorId && !parsed.targetWooVendorId)) {
    throw createImportError(
      'external_product_id and target_vendor_mapping.vendor_id or woocommerce_vendor_id are required', 400
    );
  }
  if (parsed.fulfillmentMode !== 'cj_hub') {
    throw createImportError('Global Sourcing imports currently support only fulfillment_mode=cj_hub', 400);
  }
  return parsed;
}

// ─── Job processing stages ────────────────────────────────────────────────────

async function prepareJob(adminClient, job) {
  const payload = isPlainObject(job.payload) ? job.payload : {};
  const existingCursor = isPlainObject(job.cursor) ? job.cursor : {};
  const {
    provider, externalProductId, supplierSource, supplierProductId,
    supplierUrl, receivingHubId, fulfillmentMode, targetVendorId,
  } = validateImportPayload(payload);

  // ── Stage 1: build cursor (prepare) ────────────────────────────────────────
  if (!existingCursor.prepared) {
    const vendorMapping = await resolveVendorMapping(adminClient, targetVendorId, payload?.target_vendor_mapping || {});
    const selectedVariant = normalizeSelectedVariant(payload);
    if (!selectedVariant.externalVariantId) {
      throw createImportError('A supplier variant selection is required for landed-price import', 400);
    }
    const selectedAttributes = normalizeSelectedAttributes(payload, selectedVariant);
    const importVariants = ensureVariantAttributes(
      buildImportVariants(payload, selectedVariant, selectedAttributes),
      payload.title || ''
    );
    const importableVariants = importVariants.filter(
      (v) => v.externalVariantId && v.sourcePrice !== null
    );
    if (importableVariants.length === 0) {
      throw createImportError('No importable supplier variants were provided', 400);
    }
    const variantCandidatesWithAttributes = importableVariants.filter((v) => v.attributes.length > 0);
    if (importableVariants.length > 1 && variantCandidatesWithAttributes.length === 0) {
      throw createImportError(
        'The supplier returned multiple variants but none included usable attributes', 400
      );
    }

    const sourceCurrency = selectedVariant.currency || String(payload.currency || 'USD').trim().toUpperCase();
    const sourcePrice = selectedVariant.sourcePrice ?? payload.source_price ?? payload.supplier_price_snapshot ?? payload.regular_price;
    const receivingHub = await resolveReceivingHub(adminClient, receivingHubId);

    const pricingPreview = isUsablePricingPreview(payload?.pricing_preview, {
      receivingHubId: receivingHub.id,
      externalVariantId: selectedVariant.externalVariantId,
    })
      ? payload.pricing_preview
      : await buildLandedPricingPreview({
          client: adminClient,
          provider,
          receivingHubId: receivingHub.id,
          externalVariantId: selectedVariant.externalVariantId,
          sourcePrice,
          sourceCurrency,
          inboundShippingUsd: selectedVariant.inboundShippingUsd ?? payload?.inbound_shipping_usd ?? null,
          estimatedInboundDaysMin: payload?.estimated_inbound_days_min ?? null,
          estimatedInboundDaysMax: payload?.estimated_inbound_days_max ?? null,
          carrierName: payload?.carrier_name ?? null,
        });

    const pricingDefaults = await loadGlobalSourcingPricingDefaults(adminClient, provider);
    const variantPricingConfig = {
      importBufferUsd: pricingPreview.import_buffer_usd ?? pricingDefaults.values?.import_buffer_usd ?? null,
      markupPercent: pricingPreview.markup_percent ?? pricingDefaults.values?.markup_percent ?? null,
      markupFlatNgn: pricingPreview.markup_flat_ngn ?? pricingDefaults.values?.markup_flat_ngn ?? null,
      usdToNgnRate: pricingPreview.usd_to_ngn_rate_used ?? pricingPreview.exchange_rate ?? pricingDefaults.values?.usd_to_ngn_rate ?? null,
    };

    const importWarnings = [];
    const variationPlans = [];

    for (const variant of importableVariants) {
      if (variant.attributes.length === 0) continue;
      try {
        const variantPricingPreview =
          variant.externalVariantId === selectedVariant.externalVariantId
            ? pricingPreview
            : buildDerivedVariantPricingPreview({
                variant,
                anchorPreview: pricingPreview,
                receivingHubId: receivingHub.id,
                receivingHubName: receivingHub.name,
                pricingConfig: variantPricingConfig,
              });
        variationPlans.push({ variant, pricingPreview: variantPricingPreview });
      } catch (error) {
        importWarnings.push(`Skipped variant ${variant.externalVariantId}: ${error?.message || 'unable to calculate pricing'}`);
      }
    }

    if (variantCandidatesWithAttributes.length > 0 && variationPlans.length === 0) {
      throw createImportError('Unable to calculate landed pricing for any importable variant', 500);
    }

    const productAttributes = buildProductAttributesMatrix(variationPlans.map((p) => p.variant));
    const shouldCreateVariations = productAttributes.length > 0;
    const normalizedTitle = normalizeProductTitle(payload.title || '');
    if (!normalizedTitle) throw createImportError('A valid product title is required', 400);

    const normalizedDescription = normalizeProductDescription(payload.description || '', normalizedTitle);
    const sourceDescriptionImages = (payload.description_images || []).slice(0, 8);
    const shortDescription = String(payload.sourcing_tag_label_suggestion || 'Ships from Abroad').trim();
    const sourceProductImages = mapProductImages(payload.images, selectedVariant.image);

    const parentPricing = shouldCreateVariations
      ? { regularPriceWoo: null, salePriceWoo: null }
      : computeWooNgnPricing({
          sourcePrice,
          sourceCurrency,
          inboundShippingUsd: pricingPreview.inbound_shipping_quote_usd,
          importBufferUsd: variantPricingConfig.importBufferUsd,
          markupPercent: variantPricingConfig.markupPercent,
          markupFlatNgn: variantPricingConfig.markupFlatNgn,
          usdToNgnRate: variantPricingConfig.usdToNgnRate,
        });

    const desiredStatus = String(payload.woo_status || 'draft');
    const progressTotal = shouldCreateVariations
      ? 1 + Math.ceil(variationPlans.length / MAX_VARIATIONS_PER_BATCH)
      : 1;

    return updateJobRow(adminClient, job.id, {
      status: 'processing',
      progress_stage: 'prepared',
      progress_current: 0,
      progress_total: progressTotal,
      cursor: {
        prepared: true,
        provider,
        externalProductId,
        fulfillmentMode,
        receivingHub,
        selectedVariantId: selectedVariant.externalVariantId,
        sourceCurrency,
        pricingPreview,
        vendorMapping,
        normalizedTitle,
        normalizedDescription,
        sourceDescriptionImages,
        shortDescription,
        sourceProductImages,
        shouldCreateVariations,
        productAttributes,
        parentPricing,
        variationPlans,
        desiredStatus,
        warnings: importWarnings,
        importVariantCount: importVariants.length,
        importableVariantCount: importableVariants.length,
        nextVariationIndex: 0,
        importedVariationIds: [],
        progressTotal,
        // fields for re-import
        supplierSource,
        supplierProductId,
        supplierUrl,
      },
      result: null,
      error_message: null,
      error_details: null,
    });
  }

  // ── Stage 2: materialize product in Supabase ──────────────────────────────
  const cursor = existingCursor;
  const warnings = Array.isArray(cursor.warnings) ? [...cursor.warnings] : [];

  const vendorMapping = isPlainObject(cursor.vendorMapping) ? cursor.vendorMapping : {};
  const receivingHub = isPlainObject(cursor.receivingHub) ? cursor.receivingHub : {};
  const pricingPreview = isPlainObject(cursor.pricingPreview) ? cursor.pricingPreview : {};
  const normalizedTitle = String(cursor.normalizedTitle || '').trim();
  const normalizedDescription = String(cursor.normalizedDescription || '').trim();
  const sourceDescriptionImages = Array.isArray(cursor.sourceDescriptionImages) ? cursor.sourceDescriptionImages : [];
  const shortDescription = String(cursor.shortDescription || 'Ships from Abroad').trim();
  const sourceProductImages = (Array.isArray(cursor.sourceProductImages) ? cursor.sourceProductImages : [])
    .slice(0, MAX_PRODUCT_IMAGE_UPLOADS);
  const shouldCreateVariations = Boolean(cursor.shouldCreateVariations);
  const productAttributes = Array.isArray(cursor.productAttributes) ? cursor.productAttributes : [];
  const parentPricing = isPlainObject(cursor.parentPricing) ? cursor.parentPricing : {};
  const variationPlans = Array.isArray(cursor.variationPlans) ? cursor.variationPlans : [];

  // Build description with CJ image URLs embedded directly (no WordPress upload)
  const richDescription = buildDescriptionHtml(normalizedDescription, sourceDescriptionImages, normalizedTitle);

  // Ensure "ships-from-abroad" tag exists
  let shipsTagId = null;
  try {
    shipsTagId = await ensureSupabaseTag(adminClient, { name: 'Ships from Abroad', slug: 'ships-from-abroad' });
  } catch (e) {
    warnings.push(`Could not ensure ships-from-abroad tag: ${e?.message}`);
  }

  // Build sourcing_meta
  const sourcingMeta = buildGlobalSourcingMeta({
    provider: cursor.provider,
    cjPid: externalProductId,
    cjVid: shouldCreateVariations ? null : String(cursor.selectedVariantId || '').trim() || null,
    supplierSource: cursor.supplierSource,
    supplierProductId: cursor.supplierProductId,
    supplierVariantId: shouldCreateVariations ? null : String(cursor.selectedVariantId || '').trim() || null,
    supplierUrl: cursor.supplierUrl,
    fulfillmentMode: cursor.fulfillmentMode,
    receivingHubId: receivingHub.id,
    receivingHubName: receivingHub.name,
    sourcingTag: shortDescription,
    estimatedInboundDaysMin: pricingPreview.estimated_inbound_days_min ?? payload?.estimated_inbound_days_min,
    estimatedInboundDaysMax: pricingPreview.estimated_inbound_days_max ?? payload?.estimated_inbound_days_max,
    landedCostSnapshot: pricingPreview.final_price_ngn,
    supplierPriceSnapshot: pricingPreview.supplier_price_usd,
    exchangeRateSnapshot: pricingPreview.exchange_rate,
    salePriceSnapshot: pricingPreview.sale_price_ngn || undefined,
    supplierPriceSnapshotUsd: pricingPreview.supplier_price_usd,
    inboundShippingSnapshotUsd: pricingPreview.inbound_shipping_quote_usd,
    landedCostSnapshotUsd: pricingPreview.landed_cost_usd,
    usdToNgnRateSnapshot: pricingPreview.usd_to_ngn_rate_used ?? pricingPreview.exchange_rate,
    usdToNgnRateSourceSnapshot: pricingPreview.usd_to_ngn_rate_source,
    fxRateFetchedAtSnapshot: pricingPreview.fx_rate_fetched_at || undefined,
    finalPriceSnapshotNgn: pricingPreview.final_price_ngn,
    pricingMode: 'landed',
    vendorId: vendorMapping.id,
    woocommerceVendorId: vendorMapping.woocommerce_vendor_id,
  });

  // Add wc_vendor_id for backfill compatibility
  if (vendorMapping.woocommerce_vendor_id) {
    sourcingMeta.wc_vendor_id = String(vendorMapping.woocommerce_vendor_id);
  }

  // Generate slug from title + timestamp suffix to avoid collisions
  const baseSlug = slugifyTitle(normalizedTitle);
  const slugSuffix = Date.now().toString(36).slice(-4);
  const productSlug = `${baseSlug}-${slugSuffix}`;

  // Check if product already exists (re-import)
  const existingProduct = externalProductId ? await findExistingProduct(adminClient, externalProductId) : null;

  const productRow = {
    name: normalizedTitle,
    description: richDescription || normalizedDescription,
    short_description: shortDescription,
    status: cursor.desiredStatus || 'draft',
    type: shouldCreateVariations ? 'variable' : 'simple',
    regular_price: shouldCreateVariations ? null : (parentPricing.regularPriceWoo ?? null),
    sale_price: shouldCreateVariations ? null : (parentPricing.salePriceWoo || null),
    stock_status: 'instock',
    manage_stock: false,
    ships_from_abroad: true,
    is_virtual: false,
    vendor_id: vendorMapping.id || null,
    hub_id: receivingHub.id || null,
    sourcing_meta: sourcingMeta,
    updated_at: new Date().toISOString(),
  };

  let productId;
  if (existingProduct) {
    // Update existing
    const { error } = await adminClient.from('products').update(productRow).eq('id', existingProduct.id);
    if (error) throw createImportError(`Failed to update product: ${error.message}`, 500);
    productId = existingProduct.id;
  } else {
    // Insert new
    const { data: inserted, error } = await adminClient
      .from('products')
      .insert({ ...productRow, slug: productSlug })
      .select('id')
      .single();
    if (error) throw createImportError(`Failed to insert product: ${error.message}`, 500);
    productId = inserted.id;
  }

  // Write product images (CJ CDN URLs directly, no upload)
  await writeProductImages(adminClient, productId, sourceProductImages);

  // Write attribute matrix
  if (productAttributes.length > 0) {
    await writeProductAttributes(adminClient, productId, productAttributes);
  }

  // Write tag
  if (shipsTagId) {
    await adminClient.from('product_tag_map').delete().eq('product_id', productId).eq('tag_id', shipsTagId);
    await adminClient.from('product_tag_map').insert({ product_id: productId, tag_id: shipsTagId });
  }

  const baseCursor = {
    ...cursor,
    warnings,
    productSummary: {
      supabase_id: productId,
      name: normalizedTitle,
      status: cursor.desiredStatus || 'draft',
      type: shouldCreateVariations ? 'variable' : 'simple',
    },
    sourceProductPrimaryImage: sourceProductImages[0]?.src || null,
    nextVariationIndex: 0,
    importedVariationIds: [],
    selectedVariationId: null,
    variationPlansPrepared: !shouldCreateVariations,
    productId,
  };

  if (!shouldCreateVariations) {
    return completeJob(adminClient, job, baseCursor);
  }

  return updateJobRow(adminClient, job.id, {
    status: 'processing',
    progress_stage: 'product_materialized',
    progress_current: 1,
    progress_total: Number(cursor.progressTotal || 1),
    cursor: baseCursor,
    result: null,
    error_message: null,
    error_details: null,
  });
}

async function prepareVariationProcessing(adminClient, job) {
  const cursor = isPlainObject(job.cursor) ? job.cursor : {};
  const variationPlans = Array.isArray(cursor.variationPlans) ? cursor.variationPlans : [];
  const productId = cursor.productId;

  if (!productId) throw createImportError('Product was created but job cursor is missing productId', 500);

  // Look up existing variations in Supabase by cj_vid in sourcing_meta
  const { data: existingVariations } = await adminClient
    .from('product_variations')
    .select('id, sourcing_meta, attributes')
    .eq('product_id', productId);

  const byExternalVariantId = new Map();
  (existingVariations || []).forEach((v) => {
    const cjVid = v.sourcing_meta?.cj_variant_id || v.sourcing_meta?.cj_vid;
    if (cjVid) byExternalVariantId.set(String(cjVid), v.id);
  });

  const preparedVariationPlans = variationPlans.map((plan) => ({
    variant: plan.variant,
    pricingPreview: plan.pricingPreview,
    existingVariationId: byExternalVariantId.get(plan.variant.externalVariantId) || null,
  }));

  return updateJobRow(adminClient, job.id, {
    status: 'processing',
    progress_stage: 'variations_pending',
    progress_current: 1,
    progress_total: Number(job.progress_total || cursor.progressTotal || 1),
    cursor: {
      ...cursor,
      variationPlans: preparedVariationPlans,
      variationPlansPrepared: true,
      nextVariationIndex: 0,
      importedVariationIds: Array.isArray(cursor.importedVariationIds) ? cursor.importedVariationIds : [],
    },
    result: null,
    error_message: null,
    error_details: null,
  });
}

async function processVariationBatch(adminClient, job) {
  const cursor = isPlainObject(job.cursor) ? job.cursor : {};
  const variationPlans = Array.isArray(cursor.variationPlans) ? cursor.variationPlans : [];
  const nextVariationIndex = Number(cursor.nextVariationIndex || 0);

  if (variationPlans.length === 0 || nextVariationIndex >= variationPlans.length) {
    return completeJob(adminClient, job, cursor);
  }

  const batchPlans = variationPlans.slice(nextVariationIndex, nextVariationIndex + MAX_VARIATIONS_PER_BATCH);
  const productId = cursor.productId;
  const warnings = Array.isArray(cursor.warnings) ? [...cursor.warnings] : [];
  const importedVariationIds = Array.isArray(cursor.importedVariationIds) ? [...cursor.importedVariationIds] : [];
  const pricingPreview = isPlainObject(cursor.pricingPreview) ? cursor.pricingPreview : {};

  for (const plan of batchPlans) {
    const variant = isPlainObject(plan?.variant) ? plan.variant : {};
    const variantPricingPreview = isPlainObject(plan?.pricingPreview) ? plan.pricingPreview : pricingPreview;

    const variationSourcingMeta = buildGlobalSourcingMeta({
      provider: cursor.provider,
      cjPid: cursor.externalProductId,
      cjVid: variant.externalVariantId,
      supplierSource: cursor.supplierSource,
      supplierProductId: cursor.supplierProductId,
      supplierVariantId: variant.externalVariantId,
      supplierUrl: cursor.supplierUrl,
      fulfillmentMode: cursor.fulfillmentMode,
      receivingHubId: cursor.receivingHub?.id,
      receivingHubName: cursor.receivingHub?.name,
      sourcingTag: cursor.shortDescription,
      estimatedInboundDaysMin: variantPricingPreview.estimated_inbound_days_min,
      estimatedInboundDaysMax: variantPricingPreview.estimated_inbound_days_max,
      landedCostSnapshot: variantPricingPreview.final_price_ngn,
      supplierPriceSnapshot: variantPricingPreview.supplier_price_usd,
      exchangeRateSnapshot: variantPricingPreview.exchange_rate,
      salePriceSnapshot: variantPricingPreview.sale_price_ngn || undefined,
      supplierPriceSnapshotUsd: variantPricingPreview.supplier_price_usd,
      inboundShippingSnapshotUsd: variantPricingPreview.inbound_shipping_quote_usd,
      landedCostSnapshotUsd: variantPricingPreview.landed_cost_usd,
      usdToNgnRateSnapshot: variantPricingPreview.usd_to_ngn_rate_used ?? variantPricingPreview.exchange_rate,
      usdToNgnRateSourceSnapshot: variantPricingPreview.usd_to_ngn_rate_source,
      fxRateFetchedAtSnapshot: variantPricingPreview.fx_rate_fetched_at || undefined,
      finalPriceSnapshotNgn: variantPricingPreview.final_price_ngn,
      pricingMode: 'landed',
      vendorId: cursor.vendorMapping?.id,
      woocommerceVendorId: cursor.vendorMapping?.woocommerce_vendor_id,
    });

    // attributes stored as JSONB array: [{name, value}, ...]
    const attributesJson = (Array.isArray(variant.attributes) ? variant.attributes : []).map((a) => ({
      name: a.name,
      value: a.value,
    }));

    const variationRow = {
      product_id: productId,
      regular_price: variantPricingPreview.final_price_ngn ?? null,
      sale_price: variantPricingPreview.sale_price_ngn || null,
      stock_status: 'instock',
      manage_stock: false,
      attributes: attributesJson,
      vendor_id: cursor.vendorMapping?.id || null,
      hub_id: cursor.receivingHub?.id || null,
      sourcing_meta: variationSourcingMeta,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    try {
      let variationId = plan.existingVariationId;
      if (variationId) {
        await adminClient.from('product_variations').update(variationRow).eq('id', variationId);
      } else {
        const { data: inserted, error } = await adminClient
          .from('product_variations').insert(variationRow).select('id').single();
        if (error) throw new Error(error.message);
        variationId = inserted.id;
      }

      // Write variation image (CJ URL directly)
      const variantImageUrl = String(variant.image || '').trim();
      if (variantImageUrl && variantImageUrl !== cursor.sourceProductPrimaryImage) {
        await writeVariationImage(adminClient, productId, variationId, variantImageUrl);
      }

      importedVariationIds.push(variationId);
    } catch (err) {
      warnings.push(`Skipped variant ${variant.externalVariantId}: ${err?.message || 'write failed'}`);
    }
  }

  const batchNumber = Math.floor(nextVariationIndex / MAX_VARIATIONS_PER_BATCH) + 1;
  const updatedCursor = {
    ...cursor,
    warnings,
    importedVariationIds,
    nextVariationIndex: nextVariationIndex + batchPlans.length,
  };

  if (updatedCursor.nextVariationIndex >= variationPlans.length) {
    return completeJob(adminClient, job, updatedCursor);
  }

  return updateJobRow(adminClient, job.id, {
    status: 'processing',
    progress_stage: `batch_variations:${batchNumber}`,
    progress_current: Math.min(
      Number(job.progress_total || cursor.progressTotal || 1),
      1 + Math.ceil(updatedCursor.nextVariationIndex / MAX_VARIATIONS_PER_BATCH)
    ),
    progress_total: Number(job.progress_total || cursor.progressTotal || 1),
    cursor: updatedCursor,
    result: null,
    error_message: null,
    error_details: null,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function enqueueGlobalSourcingImportJob({ adminClient, requestedBy, payload }) {
  const { provider } = validateImportPayload(payload);
  const { data, error } = await adminClient
    .from(JOB_TABLE)
    .insert({
      provider,
      requested_by: requestedBy || null,
      payload,
      status: 'queued',
      progress_stage: 'queued',
      progress_current: 0,
      progress_total: 0,
      cursor: {},
      result: null,
      error_message: null,
      error_details: null,
    })
    .select('*')
    .single();

  if (error || !data) throw createImportError(error?.message || 'Unable to queue import job', 500, error);
  return shapeJobRow(data);
}

export async function getGlobalSourcingImportJob({ adminClient, jobId }) {
  const job = await loadJobRow(adminClient, jobId);
  return shapeJobRow(job);
}

export async function processGlobalSourcingImportJob({ adminClient, jobId }) {
  let job = await loadJobRow(adminClient, jobId);

  if (job.status === 'completed' || job.status === 'failed') return shapeJobRow(job);

  try {
    if (job.status === 'queued') {
      job = await updateJobRow(adminClient, job.id, {
        status: 'processing',
        progress_stage: 'prepare',
        progress_current: 0,
        progress_total: 0,
        started_at: job.started_at || new Date().toISOString(),
        failed_at: null,
        completed_at: null,
      });
    }

    const cursor = isPlainObject(job.cursor) ? job.cursor : {};
    if (!isPlainObject(cursor.productSummary)) {
      job = await prepareJob(adminClient, job);
      return shapeJobRow(job);
    }
    if (cursor.shouldCreateVariations && !cursor.variationPlansPrepared) {
      job = await prepareVariationProcessing(adminClient, job);
      return shapeJobRow(job);
    }
    job = await processVariationBatch(adminClient, job);
    return shapeJobRow(job);
  } catch (error) {
    const failedJob = await failJob(adminClient, job, job.progress_stage || 'processing', error);
    return shapeJobRow(failedJob);
  }
}
