import {
  applyMetaUpdates,
  buildGlobalSourcingMeta,
  headers,
  isPlainObject,
  jsonResponse,
  normalizeAttributeName,
  normalizeAttributeOption,
  normalizeImages,
  normalizeProductDescription,
  normalizeProductTitle,
  parseJsonBody,
  requestWoo,
  requireAdmin,
  resolveVendorMapping,
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
    images,
    meta_data: metaData,
    attributes:
      attributes.length > 0
        ? attributes.map((attribute) => ({
            name: attribute.name,
            visible: true,
            variation: true,
            options: [attribute.value],
          }))
        : undefined,
    catalog_visibility: 'visible',
    manage_stock: false,
    reviews_allowed: false,
    purchase_note: `Mapped to ${vendorMapping.store_name} via Global Sourcing`,
  };
}

function buildVariationPayload({ attributes, pricing, variationImage, metaData }) {
  return {
    regular_price: pricing.regularPriceWoo,
    sale_price: pricing.salePriceWoo || undefined,
    image: variationImage ? { src: variationImage } : undefined,
    attributes: attributes.map((attribute) => ({
      name: attribute.name,
      option: attribute.value,
    })),
    meta_data: metaData,
  };
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

    const attributes = normalizeSelectedAttributes(payload, selectedVariant);
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
    const productImages = mapProductImages(payload.images, selectedVariant.image);
    const ownershipMeta = buildOwnershipMeta(vendorMapping);

    let existingProductMeta = [];
    if (payload.woo_product_id) {
      const existingProduct = await requestWoo(`/products/${payload.woo_product_id}`);
      existingProductMeta = Array.isArray(existingProduct?.meta_data) ? existingProduct.meta_data : [];
    }

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
      images: productImages,
      metaData: applyMetaUpdates(existingProductMeta, {
        ...productMeta,
        ...ownershipMeta,
      }),
      attributes,
      pricing: {
        regularPriceWoo: pricingPreview.final_price_ngn,
        salePriceWoo: pricingPreview.sale_price_ngn || null,
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

    let variation = null;
    if (attributes.length > 0) {
      let existingVariationMeta = [];
      if (payload.woo_variation_id) {
        const existingVariation = await requestWoo(
          `/products/${product.id}/variations/${payload.woo_variation_id}`
        );
        existingVariationMeta = Array.isArray(existingVariation?.meta_data)
          ? existingVariation.meta_data
          : [];
      }

      const variationMeta = buildGlobalSourcingMeta({
        provider,
        cjPid: externalProductId,
        cjVid: selectedVariant.externalVariantId,
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

      const variationPayload = buildVariationPayload({
        attributes,
        pricing: {
          regularPriceWoo: pricingPreview.final_price_ngn,
          salePriceWoo: pricingPreview.sale_price_ngn || null,
        },
        variationImage: selectedVariant.image || productImages[0]?.src || null,
        metaData: applyMetaUpdates(existingVariationMeta, {
          ...variationMeta,
          ...ownershipMeta,
        }),
      });

      variation = payload.woo_variation_id
        ? await requestWoo(`/products/${product.id}/variations/${payload.woo_variation_id}`, {
            method: 'PUT',
            body: JSON.stringify(variationPayload),
          })
        : await requestWoo(`/products/${product.id}/variations`, {
            method: 'POST',
            body: JSON.stringify(variationPayload),
          });
    }

    return jsonResponse(payload.woo_product_id ? 200 : 201, {
      success: true,
      data: {
        provider,
        woo_product_id: String(product.id),
        woo_variation_id: variation?.id ? String(variation.id) : null,
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
          'Ownership is written using the existing vendor bridge meta plus WCFM-compatible vendor ID meta.',
          attributes.length > 0
            ? 'The selected CJ variant was stored as a Woo variation with its own image and sourcing meta.'
            : 'The imported item was stored as a Woo simple product.',
        ],
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
