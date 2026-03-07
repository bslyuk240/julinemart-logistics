import {
  applyMetaUpdates,
  buildGlobalSourcingMeta,
  computeWooNgnPricing,
  ensureWooProductTag,
  extractMetaValue,
  isPlainObject,
  loadGlobalSourcingPricingDefaults,
  normalizeAttributeName,
  normalizeAttributeOption,
  normalizeImages,
  normalizeProductDescription,
  normalizeProductTitle,
  requestWoo,
  resolveVendorMapping,
  updateWordPressProductAuthor,
  uploadRemoteImageToWordPress,
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
const MAX_UNIQUE_VARIATION_IMAGE_UPLOADS = Math.max(
  Number(process.env.GLOBAL_SOURCING_MAX_VARIATION_IMAGES || 3) || 3,
  0
);

function createImportError(message, statusCode = 500, details = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== null && details !== undefined) {
    error.details = details;
  }
  return error;
}

function normalizeSelectedVariant(payload) {
  const source = isPlainObject(payload?.selected_variant) ? payload.selected_variant : {};
  return {
    externalVariantId: String(
      payload?.external_variant_id ||
        payload?.cj_vid ||
        source.external_variant_id ||
        source.cj_vid ||
        ''
    ).trim() || null,
    title: String(source.title || source.variant_title || payload?.variant_title || '').trim() || null,
    image:
      typeof source.image === 'string'
        ? source.image.trim()
        : typeof source.image?.src === 'string'
        ? source.image.src.trim()
        : null,
    sourcePrice: source.source_price ?? payload?.supplier_price_snapshot ?? payload?.regular_price ?? null,
    currency: String(source.currency || payload?.currency || 'USD').trim().toUpperCase(),
    attributes: source.attributes,
  };
}

function normalizeSelectedAttributes(payload, selectedVariant) {
  const source =
    payload?.selected_attributes ||
    payload?.selectedAttributes ||
    payload?.variant_attributes ||
    payload?.variantAttributes ||
    selectedVariant?.attributes ||
    {};

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
      typeof source.image === 'string'
        ? source.image.trim()
        : typeof source.image?.src === 'string'
        ? source.image.src.trim()
        : null,
    sourcePrice:
      source.source_price ??
      source.supplier_price_snapshot ??
      source.price ??
      source.regular_price ??
      null,
    currency: String(source.currency || 'USD').trim().toUpperCase(),
    attributes: normalizeSelectedAttributes({ selected_attributes: source.attributes || {} }, null),
  };
}

function buildImportVariants(payload, selectedVariant, selectedAttributes) {
  const sourceVariants = Array.isArray(payload?.variants) ? payload.variants.map(normalizeImportVariant) : [];
  const fallbackVariant =
    selectedVariant?.externalVariantId || selectedAttributes.length > 0
      ? [
          {
            externalVariantId: selectedVariant.externalVariantId,
            title: selectedVariant.title,
            image: selectedVariant.image,
            sourcePrice: selectedVariant.sourcePrice,
            currency: selectedVariant.currency,
            attributes: selectedAttributes,
          },
        ]
      : [];

  const variants = sourceVariants.length > 0 ? sourceVariants : fallbackVariant;
  const deduped = new Map();

  variants.forEach((variant, index) => {
    const key =
      variant.externalVariantId ||
      `${variant.attributes
        .map((attribute) => `${attribute.name.toLowerCase()}:${attribute.value.toLowerCase()}`)
        .sort()
        .join('|')}:${index}`;
    if (!deduped.has(key)) {
      deduped.set(key, variant);
    }
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
  if (tokenized.length <= 1) {
    return labels.map((label) => humanizeVariantTitle(label));
  }

  let sharedCount = 0;
  while (sharedCount < tokenized[0].length) {
    const candidate = tokenized[0][sharedCount];
    if (!candidate) {
      break;
    }
    const matchesAll = tokenized.every(
      (parts) => String(parts[sharedCount] || '').toLowerCase() === candidate.toLowerCase()
    );
    if (!matchesAll) break;
    sharedCount += 1;
  }

  if (sharedCount === 0) {
    return labels.map((label) => humanizeVariantTitle(label));
  }

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

  const colorCount = parsedRows.filter((row) => row.colorValue).length;
  const sizeCount = parsedRows.filter((row) => row.sizeValue).length;
  const uniqueColors = new Set(
    parsedRows.map((row) => row.colorValue.toLowerCase()).filter(Boolean)
  );
  const uniqueSizes = new Set(
    parsedRows.map((row) => row.sizeValue.toLowerCase()).filter(Boolean)
  );

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
    attributes: [
      {
        name: 'Option',
        value:
          parsedRows[index].label ||
          String(variant.title || '').trim() ||
          (variant.externalVariantId ? `Variant ${variant.externalVariantId}` : `Variant ${index + 1}`),
      },
    ],
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

  return normalized.map((src, index) => ({
    src,
    position: index,
  }));
}

function slugifyTitle(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function uploadWooImage(remoteUrl, { title, slot, cache }) {
  const sourceUrl = String(remoteUrl || '').trim();
  if (!sourceUrl) return null;

  if (cache.has(sourceUrl)) {
    return cache.get(sourceUrl);
  }

  const filenameBase = `${slugifyTitle(title) || 'global-sourcing'}-${slot}`;
  const uploadPromise = uploadRemoteImageToWordPress(sourceUrl, { filenameBase }).catch((error) => {
    cache.delete(sourceUrl);
    throw error;
  });

  cache.set(sourceUrl, uploadPromise);
  return uploadPromise;
}

async function resolveWooProductImages(images, { title, cache, warnings }) {
  const limitedImages = images.slice(0, MAX_PRODUCT_IMAGE_UPLOADS);
  if (images.length > limitedImages.length) {
    warnings.push(
      `Skipped ${images.length - limitedImages.length} extra gallery image(s) to keep import within runtime limits`
    );
  }

  const uploaded = [];

  for (let index = 0; index < limitedImages.length; index += 1) {
    const image = limitedImages[index];
    try {
      const asset = await uploadWooImage(image?.src, {
        title,
        slot: `product-${index + 1}`,
        cache,
      });

      if (asset?.id) {
        uploaded.push({
          id: Number(asset.id),
          position: uploaded.length,
        });
      }
    } catch (error) {
      warnings.push(
        `Skipped product image ${index + 1} (${image?.src || 'unknown source'}): ${
          error?.message || 'upload failed'
        }`
      );
    }
  }

  return uploaded;
}

async function resolveWooVariationImage(imageUrl, { title, cache, warnings }) {
  if (!imageUrl) return null;

  try {
    const asset = await uploadWooImage(imageUrl, {
      title,
      slot: 'variation',
      cache,
    });
    return asset?.id ? Number(asset.id) : null;
  } catch (error) {
    warnings.push(`Skipped variation image (${imageUrl}): ${error?.message || 'upload failed'}`);
    return null;
  }
}

function buildOwnershipMeta(vendorMapping) {
  const wooVendorId = String(vendorMapping.woocommerce_vendor_id);
  return {
    _woocommerce_vendor_id: wooVendorId,
    _wcfm_vendor_id: wooVendorId,
    wcfm_vendor_id: wooVendorId,
    _wcfm_product_author: wooVendorId,
    _vendor_id: vendorMapping.id,
    vendor_id: vendorMapping.id,
    _jlo_vendor_id: vendorMapping.id,
  };
}

function buildProductPayload({
  title,
  description,
  shortDescription,
  images,
  tags,
  metaData,
  attributes,
  pricing,
  wooStatus,
  vendorMapping,
}) {
  return {
    name: title,
    description,
    short_description: shortDescription,
    status: wooStatus,
    type: attributes.length > 0 ? 'variable' : 'simple',
    regular_price: attributes.length === 0 ? pricing.regularPriceWoo : undefined,
    sale_price: attributes.length === 0 ? pricing.salePriceWoo || undefined : undefined,
    images: images.length > 0 ? images : undefined,
    tags: tags.length > 0 ? tags : undefined,
    meta_data: metaData,
    attributes:
      attributes.length > 0
        ? attributes.map((attribute) => ({
            name: attribute.name,
            visible: true,
            variation: true,
            options: attribute.options,
          }))
        : undefined,
    catalog_visibility: 'visible',
    manage_stock: false,
    reviews_allowed: false,
    purchase_note: `Mapped to ${vendorMapping.store_name} via Global Sourcing`,
  };
}

function buildVariationPayload({ attributes, pricing, variationImageId, metaData }) {
  return {
    regular_price: pricing.regularPriceWoo,
    sale_price: pricing.salePriceWoo || undefined,
    image: variationImageId ? { id: variationImageId } : undefined,
    attributes: attributes.map((attribute) => ({
      name: attribute.name,
      option: attribute.value,
    })),
    meta_data: metaData,
  };
}

function buildDerivedVariantPricingPreview({
  variant,
  anchorPreview,
  receivingHubId,
  receivingHubName,
  pricingConfig,
}) {
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

function buildProductAttributesMatrix(variants) {
  const attributes = new Map();

  variants.forEach((variant) => {
    variant.attributes.forEach((attribute) => {
      const key = attribute.name.toLowerCase();
      if (!attributes.has(key)) {
        attributes.set(key, {
          name: attribute.name,
          options: new Map(),
        });
      }

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
    .map((attribute) => ({
      name: String(attribute?.name || '').trim().toLowerCase(),
      value: String(attribute?.value || attribute?.option || '').trim().toLowerCase(),
    }))
    .filter((attribute) => attribute.name && attribute.value)
    .sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value))
    .map((attribute) => `${attribute.name}:${attribute.value}`)
    .join('|');
}

async function listWooVariations(productId) {
  const variations = [];
  let page = 1;

  for (;;) {
    const response = await requestWoo(`/products/${productId}/variations?per_page=100&page=${page}`);
    const pageRows = Array.isArray(response) ? response : [];
    variations.push(...pageRows);
    if (pageRows.length < 100) break;
    page += 1;
  }

  return variations;
}

async function getExistingVariationMeta(productId, variation) {
  if (Array.isArray(variation?.meta_data)) {
    return variation.meta_data;
  }

  if (!variation?.id) return [];
  const detailedVariation = await requestWoo(`/products/${productId}/variations/${variation.id}`);
  return Array.isArray(detailedVariation?.meta_data) ? detailedVariation.meta_data : [];
}

function buildVariationResponseMap(rows, descriptors) {
  const map = new Map();
  const responseRows = Array.isArray(rows) ? rows : [];

  descriptors.forEach((descriptor, index) => {
    const row = responseRows[index];
    if (!row?.id) return;
    map.set(descriptor.variant.externalVariantId, String(row.id));
  });

  return map;
}

function buildExistingVariationLookup(variations) {
  const byCjVid = new Map();
  const byAttributes = new Map();

  variations.forEach((variation) => {
    const cjVid = extractMetaValue(variation?.meta_data, ['_cj_vid', 'cj_vid']);
    if (cjVid) {
      byCjVid.set(String(cjVid), variation);
      return;
    }

    const signature = buildAttributeSignature(
      Array.isArray(variation?.attributes)
        ? variation.attributes.map((attribute) => ({
            name: attribute?.name,
            value: attribute?.option,
          }))
        : []
    );
    if (signature) {
      byAttributes.set(signature, variation);
    }
  });

  return { byCjVid, byAttributes };
}

function pickExistingVariationId(payloadVariationId, selectedVariantId, variant) {
  if (!payloadVariationId) return null;
  if (selectedVariantId && selectedVariantId === variant.externalVariantId) {
    return String(payloadVariationId);
  }
  return null;
}

function parseImportPayload(payload) {
  const provider = String(payload?.provider || 'cj').trim().toLowerCase();
  const externalProductId = String(payload?.external_product_id || payload?.cj_pid || '').trim();
  const receivingHubId = String(payload?.receiving_hub_id || '').trim() || null;
  const fulfillmentMode = String(payload?.fulfillment_mode || 'cj_hub').trim() || 'cj_hub';
  const targetVendorId = String(
    payload?.target_vendor_mapping?.vendor_id || payload?.target_vendor_mapping?.id || ''
  ).trim();
  const targetWooVendorId = String(
    payload?.target_vendor_mapping?.woocommerce_vendor_id ||
      payload?.target_vendor_mapping?.woo_vendor_id ||
      payload?.target_vendor_mapping?.wcfm_vendor_id ||
      ''
  ).trim();

  return {
    provider,
    externalProductId,
    receivingHubId,
    fulfillmentMode,
    targetVendorId,
    targetWooVendorId,
  };
}

function validateImportPayload(payload) {
  const parsed = parseImportPayload(payload);

  if (parsed.provider !== 'cj') {
    throw createImportError('Only provider=cj is supported in this MVP', 400);
  }

  if (!parsed.externalProductId || (!parsed.targetVendorId && !parsed.targetWooVendorId)) {
    throw createImportError(
      'external_product_id and target_vendor_mapping.vendor_id or target_vendor_mapping.woocommerce_vendor_id are required',
      400
    );
  }

  if (parsed.fulfillmentMode !== 'cj_hub') {
    throw createImportError(
      'Global Sourcing imports currently support only fulfillment_mode=cj_hub',
      400
    );
  }

  return parsed;
}

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
  const { data, error } = await adminClient
    .from(JOB_TABLE)
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    throw createImportError(error.message || 'Unable to load import job', 500, error);
  }

  if (!data) {
    throw createImportError('Import job not found', 404);
  }

  return data;
}

async function updateJobRow(adminClient, jobId, patch) {
  const { data, error } = await adminClient
    .from(JOB_TABLE)
    .update(patch)
    .eq('id', jobId)
    .select('*')
    .single();

  if (error || !data) {
    throw createImportError(error?.message || 'Unable to update import job', 500, error);
  }

  return data;
}

function appendUniqueStrings(existingValues, nextValues) {
  const merged = new Set(
    [...(Array.isArray(existingValues) ? existingValues : []), ...(Array.isArray(nextValues) ? nextValues : [])]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  return Array.from(merged.values());
}

function buildCompletionResult(cursor) {
  const importedVariationIds = appendUniqueStrings(cursor.importedVariationIds, []);
  const warnings = Array.isArray(cursor.warnings)
    ? cursor.warnings.map((warning) => String(warning || '').trim()).filter(Boolean)
    : [];
  const effectiveImportedVariantCount = cursor.shouldCreateVariations
    ? importedVariationIds.length
    : Math.min(Number(cursor.importableVariantCount || 0), 1);
  const skippedVariantCount = Math.max(Number(cursor.importVariantCount || 0) - effectiveImportedVariantCount, 0);

  return {
    provider: cursor.provider,
    woo_product_id: String(cursor.productSummary?.id || ''),
    woo_variation_id: cursor.selectedVariationId || null,
    woo_variation_ids: importedVariationIds,
    imported_variation_count: importedVariationIds.length,
    skipped_variant_count: skippedVariantCount,
    product_name: cursor.productSummary?.name || null,
    product_status: cursor.productSummary?.status || null,
    product_type: cursor.productSummary?.type || null,
    permalink: cursor.productSummary?.permalink || null,
    vendor_mapping: {
      vendor_id: cursor.vendorMapping?.id || null,
      woocommerce_vendor_id: cursor.vendorMapping?.woocommerce_vendor_id || null,
      store_name: cursor.vendorMapping?.store_name || null,
      store_slug: cursor.vendorMapping?.store_slug || null,
    },
    fulfillment_mode: cursor.fulfillmentMode || null,
    receiving_hub_id: cursor.receivingHub?.id || null,
    pricing: {
      source_currency: cursor.sourceCurrency || 'USD',
      supplier_price_usd: cursor.pricingPreview?.supplier_price_usd ?? null,
      inbound_shipping_quote_usd: cursor.pricingPreview?.inbound_shipping_quote_usd ?? null,
      import_buffer_usd: cursor.pricingPreview?.import_buffer_usd ?? null,
      landed_cost_usd: cursor.pricingPreview?.landed_cost_usd ?? null,
      exchange_rate: cursor.pricingPreview?.exchange_rate ?? null,
      markup_percent: cursor.pricingPreview?.markup_percent ?? null,
      markup_flat_ngn: cursor.pricingPreview?.markup_flat_ngn ?? null,
      regular_price_ngn: cursor.pricingPreview?.final_price_ngn ?? null,
      sale_price_ngn: cursor.pricingPreview?.sale_price_ngn ?? null,
    },
    notes: [
      'WooCommerce remains the source of truth for the imported product record.',
      'Ownership is written using vendor bridge meta and a best-effort WordPress post-author assignment.',
      cursor.shouldCreateVariations
        ? `Imported ${importedVariationIds.length} CJ variant(s) into Woo variations using the current landed-pricing rules.`
        : 'The imported item was stored as a Woo simple product.',
      cursor.shouldWriteProductImages
        ? `Uploaded ${Number(cursor.uploadedProductImagesCount || 0)} product image(s) into WordPress media before Woo import.`
        : 'One or more product images failed to upload on update, so the existing Woo gallery was preserved.',
      Number(cursor.ensuredTagsCount || 0) > 0
        ? `Applied ${Number(cursor.ensuredTagsCount || 0)} Woo product tag(s), including the sourcing tag.`
        : 'No Woo product tags could be applied during import.',
      ...(warnings.length > 0 ? [`${warnings.length} warning(s) were recorded during import.`] : []),
    ],
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function failJob(adminClient, job, stage, error) {
  return updateJobRow(adminClient, job.id, {
    status: 'failed',
    progress_stage: stage || 'failed',
    error_message: error?.message || 'Unable to process import job',
    error_details: {
      stage: stage || 'unknown',
      response: error?.responseBody || error?.details || null,
    },
    failed_at: new Date().toISOString(),
  });
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

async function prepareJob(adminClient, job) {
  const payload = isPlainObject(job.payload) ? job.payload : {};
  const {
    provider,
    externalProductId,
    receivingHubId,
    fulfillmentMode,
    targetVendorId,
  } = validateImportPayload(payload);

  let importStage = 'resolve_vendor';
  const vendorMapping = await resolveVendorMapping(
    adminClient,
    targetVendorId,
    payload?.target_vendor_mapping || {}
  );

  const selectedVariant = normalizeSelectedVariant(payload);
  if (!selectedVariant.externalVariantId) {
    throw createImportError('A CJ variant selection is required for landed-price import', 400);
  }

  const selectedAttributes = normalizeSelectedAttributes(payload, selectedVariant);
  const importVariants = ensureVariantAttributes(
    buildImportVariants(payload, selectedVariant, selectedAttributes),
    payload.title || ''
  );
  const importableVariants = importVariants.filter(
    (variant) => variant.externalVariantId && variant.sourcePrice !== null
  );
  if (importableVariants.length === 0) {
    throw createImportError('No importable CJ variants were provided', 400);
  }

  const variantCandidatesWithAttributes = importableVariants.filter(
    (variant) => variant.attributes.length > 0
  );
  if (importableVariants.length > 1 && variantCandidatesWithAttributes.length === 0) {
    throw createImportError(
      'CJ returned multiple variants but none included usable attributes for Woo variation creation',
      400
    );
  }

  const sourceCurrency = selectedVariant.currency || String(payload.currency || 'USD').trim().toUpperCase();
  const sourcePrice =
    selectedVariant.sourcePrice ??
    payload.source_price ??
    payload.supplier_price_snapshot ??
    payload.regular_price;

  importStage = 'resolve_receiving_hub';
  const receivingHub = await resolveReceivingHub(adminClient, receivingHubId);

  importStage = 'quote_anchor_variant';
  const pricingPreview = isUsablePricingPreview(payload?.pricing_preview, {
    receivingHubId: receivingHub.id,
    externalVariantId: selectedVariant.externalVariantId,
  })
    ? payload.pricing_preview
    : await buildLandedPricingPreview({
        client: adminClient,
        receivingHubId: receivingHub.id,
        externalVariantId: selectedVariant.externalVariantId,
        sourcePrice,
        sourceCurrency,
      });

  const pricingDefaults = await loadGlobalSourcingPricingDefaults(adminClient, provider);
  const variantPricingConfig = {
    importBufferUsd: pricingPreview.import_buffer_usd ?? pricingDefaults.values?.import_buffer_usd ?? null,
    markupPercent: pricingPreview.markup_percent ?? pricingDefaults.values?.markup_percent ?? null,
    markupFlatNgn: pricingPreview.markup_flat_ngn ?? pricingDefaults.values?.markup_flat_ngn ?? null,
    usdToNgnRate: pricingPreview.exchange_rate ?? pricingDefaults.values?.usd_to_ngn_rate ?? null,
  };
  const importWarnings = [];
  const imageWarnings = [];
  const variationPlans = [];

  for (const variant of importableVariants) {
    if (variant.attributes.length === 0) {
      continue;
    }

    try {
      importStage = `price_variant:${variant.externalVariantId}`;
      const variantPricingPreview =
        variant.externalVariantId === selectedVariant.externalVariantId
          ? pricingPreview
          : buildDerivedVariantPricingPreview({
              variant,
              anchorPreview: pricingPreview,
              receivingHubId: receivingHub.id,
              receivingHubName: receivingHub.name,
              pricingConfig: {
                importBufferUsd: variantPricingConfig.importBufferUsd,
                markupPercent: variantPricingConfig.markupPercent,
                markupFlatNgn: variantPricingConfig.markupFlatNgn,
                usdToNgnRate: variantPricingConfig.usdToNgnRate,
              },
            });

      variationPlans.push({
        variant,
        pricingPreview: variantPricingPreview,
      });
    } catch (error) {
      importWarnings.push(
        `Skipped variant ${variant.externalVariantId}: ${error?.message || 'unable to calculate landed pricing'}`
      );
    }
  }

  if (variantCandidatesWithAttributes.length > 0 && variationPlans.length === 0) {
    throw createImportError('Unable to calculate landed pricing for any CJ variant on this product', 500);
  }

  const productAttributes = buildProductAttributesMatrix(variationPlans.map((plan) => plan.variant));
  const shouldCreateVariations = productAttributes.length > 0;
  const normalizedTitle = normalizeProductTitle(payload.title || '');
  if (!normalizedTitle) {
    throw createImportError('A valid product title is required', 400);
  }

  const normalizedDescription = normalizeProductDescription(payload.description || '', normalizedTitle);
  const shortDescription = String(payload.sourcing_tag_label_suggestion || 'Ships from Abroad').trim();
  const sourceProductImages = mapProductImages(payload.images, selectedVariant.image);
  const imageUploadCache = new Map();
  const ownershipMeta = buildOwnershipMeta(vendorMapping);

  let existingProductMeta = [];
  if (payload.woo_product_id) {
    importStage = 'load_existing_product';
    const existingProduct = await requestWoo(`/products/${payload.woo_product_id}`);
    existingProductMeta = Array.isArray(existingProduct?.meta_data) ? existingProduct.meta_data : [];
  }

  importStage = 'upload_product_images';
  const uploadedProductImages = await resolveWooProductImages(sourceProductImages, {
    title: normalizedTitle,
    cache: imageUploadCache,
    warnings: imageWarnings,
  });
  const shouldWriteProductImages = !payload.woo_product_id || imageWarnings.length === 0;

  if (!payload.woo_product_id && sourceProductImages.length > 0 && uploadedProductImages.length === 0) {
    throw createImportError(
      [...importWarnings, ...imageWarnings][0] ||
        'No source images could be uploaded to WordPress media for this new Woo product',
      500
    );
  }

  const normalizedTagNames = Array.from(
    new Set(
      [shortDescription, 'Ships from Abroad']
        .map((tag) => String(tag || '').trim())
        .filter(Boolean)
    )
  );
  const ensuredTags = [];
  for (const tagName of normalizedTagNames) {
    try {
      importStage = `ensure_tag:${tagName}`;
      const tag = await ensureWooProductTag(tagName);
      if (tag?.id) {
        ensuredTags.push({ id: Number(tag.id) });
      }
    } catch (error) {
      importWarnings.push(`Skipped Woo tag "${tagName}": ${error?.message || 'unable to create tag'}`);
    }
  }

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

  const productMeta = buildGlobalSourcingMeta({
    provider,
    cjPid: externalProductId,
    cjVid: null,
    fulfillmentMode,
    receivingHubId: receivingHub.id,
    receivingHubName: receivingHub.name,
    sourcingTag: shortDescription,
    estimatedInboundDaysMin: pricingPreview.estimated_inbound_days_min ?? payload.estimated_inbound_days_min,
    estimatedInboundDaysMax: pricingPreview.estimated_inbound_days_max ?? payload.estimated_inbound_days_max,
    landedCostSnapshot: pricingPreview.final_price_ngn,
    supplierPriceSnapshot: pricingPreview.supplier_price_usd,
    exchangeRateSnapshot: pricingPreview.exchange_rate,
    salePriceSnapshot: pricingPreview.sale_price_ngn || undefined,
    supplierPriceSnapshotUsd: pricingPreview.supplier_price_usd,
    inboundShippingSnapshotUsd: pricingPreview.inbound_shipping_quote_usd,
    landedCostSnapshotUsd: pricingPreview.landed_cost_usd,
    usdToNgnRateSnapshot: pricingPreview.exchange_rate,
    finalPriceSnapshotNgn: pricingPreview.final_price_ngn,
    pricingMode: 'landed',
    vendorId: vendorMapping.id,
    woocommerceVendorId: vendorMapping.woocommerce_vendor_id,
  });

  const productPayload = buildProductPayload({
    title: normalizedTitle,
    description: normalizedDescription,
    shortDescription,
    images: shouldWriteProductImages ? uploadedProductImages : [],
    tags: ensuredTags,
    metaData: applyMetaUpdates(existingProductMeta, {
      ...productMeta,
      ...ownershipMeta,
    }),
    attributes: productAttributes,
    pricing: {
      regularPriceWoo: parentPricing.regularPriceWoo,
      salePriceWoo: parentPricing.salePriceWoo || null,
    },
    wooStatus: String(payload.woo_status || 'draft'),
    vendorMapping,
  });

  const product =
    payload.woo_product_id
      ? await (async () => {
          importStage = 'update_product';
          return requestWoo(`/products/${payload.woo_product_id}`, {
            method: 'PUT',
            body: JSON.stringify(productPayload),
          });
        })()
      : await (async () => {
          importStage = 'create_product';
          return requestWoo('/products', {
            method: 'POST',
            body: JSON.stringify(productPayload),
          });
        })();

  try {
    importStage = 'assign_product_owner';
    const authorUpdate = await updateWordPressProductAuthor(product.id, vendorMapping.woocommerce_vendor_id);
    if (!authorUpdate) {
      importWarnings.push(
        `Unable to assign WordPress/WCFM product owner ${vendorMapping.woocommerce_vendor_id}: vendor id is not a usable WordPress author id`
      );
    }
  } catch (error) {
    importWarnings.push(
      `Unable to assign WordPress/WCFM product owner ${vendorMapping.woocommerce_vendor_id}: ${
        error?.message || 'author update failed'
      }`
    );
  }

  let preparedVariationPlans = [];
  let allowedVariationImageUrls = [];

  if (shouldCreateVariations) {
    importStage = 'load_existing_variations';
    const existingVariations = payload.woo_product_id ? await listWooVariations(product.id) : [];
    const lookup = buildExistingVariationLookup(existingVariations);
    const allowedVariationImageUrlSet = new Set();

    if (MAX_UNIQUE_VARIATION_IMAGE_UPLOADS > 0) {
      for (const plan of variationPlans) {
        const candidateUrl = String(plan.variant.image || '').trim();
        if (!candidateUrl || candidateUrl === sourceProductImages[0]?.src) continue;
        allowedVariationImageUrlSet.add(candidateUrl);
        if (allowedVariationImageUrlSet.size >= MAX_UNIQUE_VARIATION_IMAGE_UPLOADS) break;
      }
    }

    const uniqueVariationImageCount = new Set(
      variationPlans
        .map((plan) => String(plan.variant.image || '').trim())
        .filter((url) => Boolean(url) && url !== sourceProductImages[0]?.src)
    ).size;
    if (uniqueVariationImageCount > allowedVariationImageUrlSet.size) {
      importWarnings.push(
        `Skipped ${uniqueVariationImageCount - allowedVariationImageUrlSet.size} unique variation image(s) to keep import within runtime limits`
      );
    }

    allowedVariationImageUrls = Array.from(allowedVariationImageUrlSet.values());
    preparedVariationPlans = variationPlans.map((plan) => {
      const { variant } = plan;
      const fallbackVariationId = pickExistingVariationId(
        payload.woo_variation_id,
        selectedVariant.externalVariantId,
        variant
      );
      const signature = buildAttributeSignature(variant.attributes);
      const matchedVariation =
        lookup.byCjVid.get(variant.externalVariantId) ||
        (fallbackVariationId
          ? existingVariations.find((existingVariation) => String(existingVariation.id) === fallbackVariationId)
          : null) ||
        lookup.byAttributes.get(signature) ||
        null;

      return {
        variant,
        pricingPreview: plan.pricingPreview,
        matchedVariationId: matchedVariation?.id ? String(matchedVariation.id) : null,
      };
    });
  }

  const progressTotal = shouldCreateVariations
    ? 1 + Math.ceil(preparedVariationPlans.length / MAX_VARIATIONS_PER_BATCH)
    : 1;
  void importStage;
  const baseCursor = {
    provider,
    externalProductId,
    fulfillmentMode,
    receivingHub,
    selectedVariantId: selectedVariant.externalVariantId,
    sourceCurrency,
    pricingPreview,
    vendorMapping,
    normalizedTitle,
    shortDescription,
    shouldCreateVariations,
    shouldWriteProductImages,
    uploadedProductImagesCount: uploadedProductImages.length,
    ensuredTagsCount: ensuredTags.length,
    warnings: [...importWarnings, ...imageWarnings],
    importVariantCount: importVariants.length,
    importableVariantCount: importableVariants.length,
    productSummary: {
      id: String(product.id),
      name: product.name,
      status: product.status,
      type: product.type,
      permalink: product.permalink || null,
    },
    sourceProductPrimaryImage: sourceProductImages[0]?.src || null,
    allowedVariationImageUrls,
    variationPlans: preparedVariationPlans,
    nextVariationIndex: 0,
    importedVariationIds: [],
    selectedVariationId: null,
    progressTotal,
  };

  if (!shouldCreateVariations) {
    const result = buildCompletionResult(baseCursor);
    const completedJob = await updateJobRow(adminClient, job.id, {
      status: 'completed',
      progress_stage: 'completed',
      progress_current: 1,
      progress_total: 1,
      cursor: baseCursor,
      result,
      error_message: null,
      error_details: null,
      completed_at: new Date().toISOString(),
    });
    return completedJob;
  }

  return updateJobRow(adminClient, job.id, {
    status: 'processing',
    progress_stage: 'variations_pending',
    progress_current: 1,
    progress_total: progressTotal,
    cursor: baseCursor,
    result: null,
    error_message: null,
    error_details: null,
  });
}

async function processVariationBatch(adminClient, job) {
  const payload = isPlainObject(job.payload) ? job.payload : {};
  const cursor = isPlainObject(job.cursor) ? job.cursor : {};
  const variationPlans = Array.isArray(cursor.variationPlans) ? cursor.variationPlans : [];
  const nextVariationIndex = Number(cursor.nextVariationIndex || 0);

  if (variationPlans.length === 0 || nextVariationIndex >= variationPlans.length) {
    return completeJob(adminClient, job, cursor);
  }

  const batchPlans = variationPlans.slice(nextVariationIndex, nextVariationIndex + MAX_VARIATIONS_PER_BATCH);
  const imageUploadCache = new Map();
  const imageWarnings = [];
  const createDescriptors = [];
  const updateDescriptors = [];
  const allowedVariationImageUrls = new Set(
    (Array.isArray(cursor.allowedVariationImageUrls) ? cursor.allowedVariationImageUrls : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  const ownershipMeta = buildOwnershipMeta(cursor.vendorMapping || {});

  for (const plan of batchPlans) {
    const variant = isPlainObject(plan?.variant) ? plan.variant : {};
    const variantPricingPreview = isPlainObject(plan?.pricingPreview) ? plan.pricingPreview : {};
    const existingVariationMeta = plan?.matchedVariationId
      ? await getExistingVariationMeta(cursor.productSummary?.id, { id: plan.matchedVariationId })
      : [];
    const variationMeta = buildGlobalSourcingMeta({
      provider: cursor.provider,
      cjPid: cursor.externalProductId,
      cjVid: variant.externalVariantId,
      fulfillmentMode: cursor.fulfillmentMode,
      receivingHubId: cursor.receivingHub?.id,
      receivingHubName: cursor.receivingHub?.name,
      sourcingTag: cursor.shortDescription,
      estimatedInboundDaysMin:
        variantPricingPreview.estimated_inbound_days_min ?? payload.estimated_inbound_days_min,
      estimatedInboundDaysMax:
        variantPricingPreview.estimated_inbound_days_max ?? payload.estimated_inbound_days_max,
      landedCostSnapshot: variantPricingPreview.final_price_ngn,
      supplierPriceSnapshot: variantPricingPreview.supplier_price_usd,
      exchangeRateSnapshot: variantPricingPreview.exchange_rate,
      salePriceSnapshot: variantPricingPreview.sale_price_ngn || undefined,
      supplierPriceSnapshotUsd: variantPricingPreview.supplier_price_usd,
      inboundShippingSnapshotUsd: variantPricingPreview.inbound_shipping_quote_usd,
      landedCostSnapshotUsd: variantPricingPreview.landed_cost_usd,
      usdToNgnRateSnapshot: variantPricingPreview.exchange_rate,
      finalPriceSnapshotNgn: variantPricingPreview.final_price_ngn,
      pricingMode: 'landed',
      vendorId: cursor.vendorMapping?.id,
      woocommerceVendorId: cursor.vendorMapping?.woocommerce_vendor_id,
    });

    const variationImageSource = allowedVariationImageUrls.has(String(variant.image || '').trim())
      ? variant.image
      : null;

    const variationPayload = buildVariationPayload({
      attributes: Array.isArray(variant.attributes) ? variant.attributes : [],
      pricing: {
        regularPriceWoo: variantPricingPreview.final_price_ngn,
        salePriceWoo: variantPricingPreview.sale_price_ngn || null,
      },
      variationImageId: await resolveWooVariationImage(variationImageSource, {
        title: cursor.normalizedTitle,
        cache: imageUploadCache,
        warnings: imageWarnings,
      }),
      metaData: applyMetaUpdates(existingVariationMeta, {
        ...variationMeta,
        ...ownershipMeta,
      }),
    });

    if (plan?.matchedVariationId) {
      updateDescriptors.push({
        variant,
        payload: {
          id: Number(plan.matchedVariationId),
          ...variationPayload,
        },
      });
    } else {
      createDescriptors.push({
        variant,
        payload: variationPayload,
      });
    }
  }

  const batchNumber = Math.floor(nextVariationIndex / MAX_VARIATIONS_PER_BATCH) + 1;
  const batchResult = await requestWoo(`/products/${cursor.productSummary?.id}/variations/batch`, {
    method: 'POST',
    body: JSON.stringify({
      create: createDescriptors.map((entry) => entry.payload),
      update: updateDescriptors.map((entry) => entry.payload),
    }),
  });

  const variationIdMap = new Map();
  buildVariationResponseMap(batchResult?.create, createDescriptors).forEach((value, key) => {
    variationIdMap.set(key, value);
  });
  buildVariationResponseMap(batchResult?.update, updateDescriptors).forEach((value, key) => {
    variationIdMap.set(key, value);
  });

  const nextImportedVariationIds = appendUniqueStrings(
    cursor.importedVariationIds,
    batchPlans
      .map((plan) => variationIdMap.get(plan.variant.externalVariantId))
      .filter(Boolean)
  );
  const nextSelectedVariationId =
    cursor.selectedVariationId ||
    batchPlans
      .map((plan) =>
        plan.variant.externalVariantId === cursor.selectedVariantId
          ? variationIdMap.get(plan.variant.externalVariantId)
          : null
      )
      .find(Boolean) ||
    null;
  const updatedCursor = {
    ...cursor,
    warnings: [...(Array.isArray(cursor.warnings) ? cursor.warnings : []), ...imageWarnings],
    importedVariationIds: nextImportedVariationIds,
    selectedVariationId: nextSelectedVariationId,
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

  if (error || !data) {
    throw createImportError(error?.message || 'Unable to queue import job', 500, error);
  }

  return shapeJobRow(data);
}

export async function getGlobalSourcingImportJob({ adminClient, jobId }) {
  const job = await loadJobRow(adminClient, jobId);
  return shapeJobRow(job);
}

export async function processGlobalSourcingImportJob({ adminClient, jobId }) {
  let job = await loadJobRow(adminClient, jobId);

  if (job.status === 'completed' || job.status === 'failed') {
    return shapeJobRow(job);
  }

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

    job = await processVariationBatch(adminClient, job);
    return shapeJobRow(job);
  } catch (error) {
    const failedJob = await failJob(
      adminClient,
      job,
      job.progress_stage || 'processing',
      error
    );
    return shapeJobRow(failedJob);
  }
}
