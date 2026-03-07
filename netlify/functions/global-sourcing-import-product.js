import {
  applyMetaUpdates,
  buildGlobalSourcingMeta,
  computeWooNgnPricing,
  ensureWooProductTag,
  extractMetaValue,
  headers,
  isPlainObject,
  jsonResponse,
  loadGlobalSourcingPricingDefaults,
  normalizeAttributeName,
  normalizeAttributeOption,
  normalizeImages,
  normalizeProductDescription,
  normalizeProductTitle,
  parseJsonBody,
  requestWoo,
  requireAdmin,
  resolveVendorMapping,
  updateWordPressProductAuthor,
  uploadRemoteImageToWordPress,
} from './services/global-sourcing-utils.js';
import {
  buildLandedPricingPreview,
  isUsablePricingPreview,
  resolveReceivingHub,
} from './services/global-sourcing-cj.js';

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

function ensureVariantAttributes(variants) {
  const normalized = Array.isArray(variants) ? variants : [];
  if (normalized.length <= 1) return normalized;

  const hasStructuredAttributes = normalized.some((variant) => variant.attributes.length > 0);
  if (hasStructuredAttributes) return normalized;

  return normalized.map((variant, index) => ({
    ...variant,
    attributes: [
      {
        name: 'Option',
        value:
          String(variant.title || '').trim() ||
          (variant.externalVariantId ? `Variant ${variant.externalVariantId}` : `Variant ${index + 1}`),
      },
    ],
  }));
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
  const uploaded = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
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
    warnings.push(
      `Skipped variation image (${imageUrl}): ${error?.message || 'upload failed'}`
    );
    return null;
  }
}

function buildOwnershipMeta(vendorMapping) {
  const wooVendorId = String(vendorMapping.woocommerce_vendor_id);
  return {
    _woocommerce_vendor_id: wooVendorId,
    _wcfm_vendor_id: wooVendorId,
    wcfm_vendor_id: wooVendorId,
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

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, ['admin']);
  if (auth.errorResponse) return auth.errorResponse;

  const payload = parseJsonBody(event.body);
  if (payload === null || !isPlainObject(payload)) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  const provider = String(payload.provider || 'cj').trim().toLowerCase();
  const externalProductId = String(payload.external_product_id || payload.cj_pid || '').trim();
  const receivingHubId = String(payload.receiving_hub_id || '').trim() || null;
  const fulfillmentMode = String(payload.fulfillment_mode || 'cj_hub').trim() || 'cj_hub';
  const targetVendorId = String(
    payload?.target_vendor_mapping?.vendor_id || payload?.target_vendor_mapping?.id || ''
  ).trim();
  const targetWooVendorId = String(
    payload?.target_vendor_mapping?.woocommerce_vendor_id ||
      payload?.target_vendor_mapping?.woo_vendor_id ||
      payload?.target_vendor_mapping?.wcfm_vendor_id ||
      ''
  ).trim();

  if (provider !== 'cj') {
    return jsonResponse(400, { success: false, error: 'Only provider=cj is supported in this MVP' });
  }

  if (!externalProductId || (!targetVendorId && !targetWooVendorId)) {
    return jsonResponse(400, {
      success: false,
      error:
        'external_product_id and target_vendor_mapping.vendor_id or target_vendor_mapping.woocommerce_vendor_id are required',
    });
  }

  if (fulfillmentMode !== 'cj_hub') {
    return jsonResponse(400, {
      success: false,
      error: 'Global Sourcing imports currently support only fulfillment_mode=cj_hub',
    });
  }

  try {
    const vendorMapping = await resolveVendorMapping(
      auth.adminClient,
      targetVendorId,
      payload?.target_vendor_mapping || {}
    );
    const selectedVariant = normalizeSelectedVariant(payload);
    if (!selectedVariant.externalVariantId) {
      return jsonResponse(400, {
        success: false,
        error: 'A CJ variant selection is required for landed-price import',
      });
    }

    const selectedAttributes = normalizeSelectedAttributes(payload, selectedVariant);
    const importVariants = ensureVariantAttributes(
      buildImportVariants(payload, selectedVariant, selectedAttributes)
    );
    const importableVariants = importVariants.filter(
      (variant) => variant.externalVariantId && variant.sourcePrice !== null
    );
    if (importableVariants.length === 0) {
      return jsonResponse(400, {
        success: false,
        error: 'No importable CJ variants were provided',
      });
    }

    const variantCandidatesWithAttributes = importableVariants.filter(
      (variant) => variant.attributes.length > 0
    );
    if (importableVariants.length > 1 && variantCandidatesWithAttributes.length === 0) {
      return jsonResponse(400, {
        success: false,
        error:
          'CJ returned multiple variants but none included usable attributes for Woo variation creation',
      });
    }
    const sourceCurrency = selectedVariant.currency || String(payload.currency || 'USD').trim().toUpperCase();
    const sourcePrice =
      selectedVariant.sourcePrice ??
      payload.source_price ??
      payload.supplier_price_snapshot ??
      payload.regular_price;
    const receivingHub = await resolveReceivingHub(auth.adminClient, receivingHubId);
    const pricingPreview = isUsablePricingPreview(payload?.pricing_preview, {
      receivingHubId: receivingHub.id,
      externalVariantId: selectedVariant.externalVariantId,
    })
      ? payload.pricing_preview
      : await buildLandedPricingPreview({
          client: auth.adminClient,
          receivingHubId: receivingHub.id,
          externalVariantId: selectedVariant.externalVariantId,
          sourcePrice,
          sourceCurrency,
        });
    const pricingDefaults = await loadGlobalSourcingPricingDefaults(auth.adminClient, provider);
    const variantPricingConfig = {
      importBufferUsd:
        pricingPreview.import_buffer_usd ?? pricingDefaults.values?.import_buffer_usd ?? null,
      markupPercent: pricingPreview.markup_percent ?? pricingDefaults.values?.markup_percent ?? null,
      markupFlatNgn:
        pricingPreview.markup_flat_ngn ?? pricingDefaults.values?.markup_flat_ngn ?? null,
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
        const variantPricingPreview =
          variant.externalVariantId === selectedVariant.externalVariantId
            ? pricingPreview
            : await buildLandedPricingPreview({
                client: auth.adminClient,
                receivingHubId: receivingHub.id,
                externalVariantId: variant.externalVariantId,
                sourcePrice: variant.sourcePrice,
                sourceCurrency: variant.currency,
                importBufferUsd: variantPricingConfig.importBufferUsd,
                markupPercent: variantPricingConfig.markupPercent,
                markupFlatNgn: variantPricingConfig.markupFlatNgn,
                usdToNgnRate: variantPricingConfig.usdToNgnRate,
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
      throw new Error('Unable to calculate landed pricing for any CJ variant on this product');
    }

    const productAttributes = buildProductAttributesMatrix(variationPlans.map((plan) => plan.variant));
    const shouldCreateVariations = productAttributes.length > 0;

    const normalizedTitle = normalizeProductTitle(payload.title || '');
    if (!normalizedTitle) {
      return jsonResponse(400, { success: false, error: 'A valid product title is required' });
    }

    const normalizedDescription = normalizeProductDescription(
      payload.description || '',
      normalizedTitle
    );
    const shortDescription = String(
      payload.sourcing_tag_label_suggestion || 'Ships from Abroad'
    ).trim();
    const sourceProductImages = mapProductImages(payload.images, selectedVariant.image);
    const imageUploadCache = new Map();
    const ownershipMeta = buildOwnershipMeta(vendorMapping);

    let existingProductMeta = [];
    if (payload.woo_product_id) {
      const existingProduct = await requestWoo(`/products/${payload.woo_product_id}`);
      existingProductMeta = Array.isArray(existingProduct?.meta_data) ? existingProduct.meta_data : [];
    }

    const uploadedProductImages = await resolveWooProductImages(sourceProductImages, {
      title: normalizedTitle,
      cache: imageUploadCache,
      warnings: imageWarnings,
    });
    const shouldWriteProductImages = !payload.woo_product_id || imageWarnings.length === 0;

    if (!payload.woo_product_id && sourceProductImages.length > 0 && uploadedProductImages.length === 0) {
      throw new Error(
        [...importWarnings, ...imageWarnings][0] ||
          'No source images could be uploaded to WordPress media for this new Woo product'
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
        const tag = await ensureWooProductTag(tagName);
        if (tag?.id) {
          ensuredTags.push({ id: Number(tag.id) });
        }
      } catch (error) {
        importWarnings.push(
          `Skipped Woo tag "${tagName}": ${error?.message || 'unable to create tag'}`
        );
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
      sourcingTag: shortDescription,
      estimatedInboundDaysMin:
        pricingPreview.estimated_inbound_days_min ?? payload.estimated_inbound_days_min,
      estimatedInboundDaysMax:
        pricingPreview.estimated_inbound_days_max ?? payload.estimated_inbound_days_max,
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
        ? await requestWoo(`/products/${payload.woo_product_id}`, {
            method: 'PUT',
            body: JSON.stringify(productPayload),
          })
        : await requestWoo('/products', {
            method: 'POST',
            body: JSON.stringify(productPayload),
          });

    try {
      const authorUpdate = await updateWordPressProductAuthor(
        product.id,
        vendorMapping.woocommerce_vendor_id
      );
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

    const importedVariationIds = [];
    let selectedVariationId = null;

    if (shouldCreateVariations) {
      const existingVariations = payload.woo_product_id ? await listWooVariations(product.id) : [];
      const lookup = buildExistingVariationLookup(existingVariations);

      for (const plan of variationPlans) {
        const { variant, pricingPreview: variantPricingPreview } = plan;
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

        const existingVariationMeta = matchedVariation?.id
          ? await getExistingVariationMeta(product.id, matchedVariation)
          : [];

        const variationMeta = buildGlobalSourcingMeta({
          provider,
          cjPid: externalProductId,
          cjVid: variant.externalVariantId,
          fulfillmentMode,
          receivingHubId: receivingHub.id,
          sourcingTag: shortDescription,
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
          vendorId: vendorMapping.id,
          woocommerceVendorId: vendorMapping.woocommerce_vendor_id,
        });

        const variationPayload = buildVariationPayload({
          attributes: variant.attributes,
          pricing: {
            regularPriceWoo: variantPricingPreview.final_price_ngn,
            salePriceWoo: variantPricingPreview.sale_price_ngn || null,
          },
          variationImageId: await resolveWooVariationImage(
            variant.image || sourceProductImages[0]?.src || null,
            {
              title: normalizedTitle,
              cache: imageUploadCache,
              warnings: imageWarnings,
            }
          ),
          metaData: applyMetaUpdates(existingVariationMeta, {
            ...variationMeta,
            ...ownershipMeta,
          }),
        });

        const savedVariation = matchedVariation?.id
          ? await requestWoo(`/products/${product.id}/variations/${matchedVariation.id}`, {
              method: 'PUT',
              body: JSON.stringify(variationPayload),
            })
          : await requestWoo(`/products/${product.id}/variations`, {
              method: 'POST',
              body: JSON.stringify(variationPayload),
            });

        importedVariationIds.push(String(savedVariation.id));
        if (variant.externalVariantId === selectedVariant.externalVariantId) {
          selectedVariationId = String(savedVariation.id);
        }
      }
    }

    const effectiveImportedVariantCount = shouldCreateVariations
      ? importedVariationIds.length
      : Math.min(importableVariants.length, 1);
    const skippedVariantCount = Math.max(importVariants.length - effectiveImportedVariantCount, 0);
    const allWarnings = [...importWarnings, ...imageWarnings];

    return jsonResponse(payload.woo_product_id ? 200 : 201, {
      success: true,
      data: {
        provider,
        woo_product_id: String(product.id),
        woo_variation_id: selectedVariationId,
        woo_variation_ids: importedVariationIds,
        imported_variation_count: importedVariationIds.length,
        skipped_variant_count: skippedVariantCount,
        product_name: product.name,
        product_status: product.status,
        product_type: product.type,
        permalink: product.permalink || null,
        vendor_mapping: {
          vendor_id: vendorMapping.id,
          woocommerce_vendor_id: vendorMapping.woocommerce_vendor_id,
          store_name: vendorMapping.store_name,
          store_slug: vendorMapping.store_slug,
        },
        fulfillment_mode: fulfillmentMode,
        receiving_hub_id: receivingHubId,
        pricing: {
          source_currency: sourceCurrency,
          supplier_price_usd: pricingPreview.supplier_price_usd,
          inbound_shipping_quote_usd: pricingPreview.inbound_shipping_quote_usd,
          import_buffer_usd: pricingPreview.import_buffer_usd,
          landed_cost_usd: pricingPreview.landed_cost_usd,
          exchange_rate: pricingPreview.exchange_rate,
          markup_percent: pricingPreview.markup_percent,
          markup_flat_ngn: pricingPreview.markup_flat_ngn,
          regular_price_ngn: pricingPreview.final_price_ngn,
          sale_price_ngn: pricingPreview.sale_price_ngn,
        },
        notes: [
          'WooCommerce remains the source of truth for the imported product record.',
          'Ownership is written using vendor bridge meta and a best-effort WordPress post-author assignment.',
          shouldCreateVariations
            ? `Imported ${importedVariationIds.length} CJ variant(s) into Woo variations using the current landed-pricing rules.`
            : 'The imported item was stored as a Woo simple product.',
          shouldWriteProductImages
            ? `Uploaded ${uploadedProductImages.length} product image(s) into WordPress media before Woo import.`
            : 'One or more product images failed to upload on update, so the existing Woo gallery was preserved.',
          ensuredTags.length > 0
            ? `Applied ${ensuredTags.length} Woo product tag(s), including the sourcing tag.`
            : 'No Woo product tags could be applied during import.',
          ...(allWarnings.length > 0
            ? [`${allWarnings.length} warning(s) were recorded during import.`]
            : []),
        ],
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
      },
    });
  } catch (error) {
    return jsonResponse(error?.statusCode || 500, {
      success: false,
      error: 'Global sourcing import failed',
      message: error?.message || 'Unable to create or update Woo product',
      details: error?.responseBody || error?.details || null,
    });
  }
}
