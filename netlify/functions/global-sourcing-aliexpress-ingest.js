import {
  extractDescriptionImageUrls,
  extractImageCandidatesFromHtml,
  extractProductSnapshotFromJsonLd,
  extractTitleFromHtml,
  headers,
  isPlainObject,
  jsonResponse,
  normalizeImages,
  normalizeProductDescription,
  parseJsonBody,
  requireAdmin,
  normalizeSupportedSourceUrl,
} from './services/global-sourcing-utils.js';

function parseHtmlDescription(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function extractBalancedJsonValue(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;

  let startIndex = markerIndex + marker.length;
  while (startIndex < source.length && /\s/.test(source[startIndex])) {
    startIndex += 1;
  }
  if (startIndex < 0) return null;
  if (!['{', '[', '"'].includes(source[startIndex])) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  const opener = source[startIndex];

  if (opener === '"') {
    for (let index = startIndex + 1; index < source.length; index += 1) {
      const character = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        return source.slice(startIndex, index + 1);
      }
    }
    return null;
  }

  const closer = opener === '{' ? '}' : ']';

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === opener) {
      depth += 1;
      continue;
    }

    if (character === closer) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseJsonCandidates(html) {
  const markers = [
    'window.runParams =',
    'window.runParams=',
    'window.__INITIAL_STATE__ =',
    'window.__INITIAL_STATE__=',
    'window.__INITIAL_DATA__ =',
    'window.__INITIAL_DATA__=',
    'window.__INIT_DATA__ =',
    'window.__INIT_DATA__=',
    'window._dida_config_._init_data_ =',
    'window._dida_config_._init_data_=',
    'window.__PRELOADED_STATE__ =',
    'window.__PRELOADED_STATE__=',
    'window.rawData =',
    'window.rawData=',
    'window.detailData =',
    'window.detailData=',
  ];
  const parsed = [];

  for (const marker of markers) {
    const raw = extractBalancedJsonValue(html, marker);
    if (!raw) continue;

    try {
      const value = JSON.parse(raw);
      if (value) parsed.push(value);
    } catch {
      // Ignore malformed candidate blocks.
    }
  }

  const taggedJsonBlocks = html.match(
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  ) || [];
  for (const block of taggedJsonBlocks) {
    const content = block.replace(/<script[^>]*>|<\/script>/gi, '').trim();
    if (!content.startsWith('{') && !content.startsWith('[')) continue;
    try {
      const value = JSON.parse(content);
      if (value) parsed.push(value);
    } catch {
      // Ignore malformed blocks.
    }
  }

  return parsed;
}

function walkValues(value, visitor, path = []) {
  visitor(value, path);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkValues(entry, visitor, [...path, String(index)]));
    return;
  }

  if (!isPlainObject(value)) return;
  Object.entries(value).forEach(([key, entry]) => walkValues(entry, visitor, [...path, key]));
}

function findFirstObject(value, predicate) {
  let found = null;

  walkValues(value, (entry) => {
    if (found || !isPlainObject(entry)) return;
    if (predicate(entry)) found = entry;
  });

  return found;
}

function findFirstArray(value, predicate) {
  let found = null;

  walkValues(value, (entry) => {
    if (found || !Array.isArray(entry)) return;
    if (predicate(entry)) found = entry;
  });

  return found;
}

function pickString(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
}

function parseJsonStringLiteral(value) {
  if (!value) return '';
  try {
    return JSON.parse(`"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return String(value);
  }
}

function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const normalized = String(value).replace(/[^0-9.]/g, '').trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPriceValue(value) {
  if (!value) return null;

  const direct = [
    value?.skuVal?.skuActivityAmount?.value,
    value?.skuVal?.skuCalPrice,
    value?.skuVal?.skuAmount?.value,
    value?.offerSellPrice?.value,
    value?.price?.value,
    value?.price,
    value?.salePrice,
    value?.skuActivityAmount?.value,
    value?.formatedPrice,
  ];

  for (const candidate of direct) {
    const parsed = parseAmount(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
}

function extractCurrency(value, fallback = 'USD') {
  const direct = pickString(
    value?.skuVal?.skuCurrencyCode,
    value?.offerSellPrice?.currencyCode,
    value?.price?.currencyCode,
    value?.currency,
    value?.currencyCode
  );
  return (direct || fallback || 'USD').trim().toUpperCase();
}

function extractProductIdFromUrl(url) {
  const normalized = String(url || '');
  const match = normalized.match(/\/item\/(\d+)\.html/i);
  return match?.[1] ? match[1] : null;
}

function extractFirstMatch(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return parseJsonStringLiteral(match[1]).trim();
    }
  }
  return '';
}

function isMeaningfulTitle(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  return !/^ali\s*express\s*product$/i.test(normalized);
}

function extractFallbackTitleFromHtml(html) {
  return extractFirstMatch(html, [
    /"subject"\s*:\s*"([^"]+)"/i,
    /"productTitle"\s*:\s*"([^"]+)"/i,
    /"title"\s*:\s*"([^"]+)"/i,
  ]);
}

function extractFallbackDescriptionFromHtml(html) {
  const raw = extractFirstMatch(html, [
    /"description"\s*:\s*"([^"]+)"/i,
    /"productDesc"\s*:\s*"([^"]+)"/i,
    /"detailDesc"\s*:\s*"([^"]+)"/i,
  ]);
  return String(raw || '').replace(/\\n/g, '\n').trim();
}

function extractFallbackPriceFromHtml(html) {
  const candidates = [
    extractFirstMatch(html, [
      /"formatedPrice"\s*:\s*"([^"]+)"/i,
      /"price"\s*:\s*"([^"]+)"/i,
      /"salePrice"\s*:\s*"([^"]+)"/i,
      /"minActivityAmount"\s*:\s*"([^"]+)"/i,
    ]),
  ];

  for (const candidate of candidates) {
    const parsed = parseAmount(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
}

function buildAttributeValueLookup(propertyRows) {
  const lookup = new Map();

  for (const property of Array.isArray(propertyRows) ? propertyRows : []) {
    const propertyName = pickString(
      property?.skuPropertyName,
      property?.propertyName,
      property?.attrName,
      property?.name
    );
    const values = Array.isArray(property?.skuPropertyValues)
      ? property.skuPropertyValues
      : Array.isArray(property?.values)
      ? property.values
      : [];

    for (const value of values) {
      const propertyId = pickString(
        property?.skuPropertyIdLong,
        property?.skuPropertyId,
        property?.propertyId,
        property?.attrId
      );
      const valueId = pickString(
        value?.propertyValueIdLong,
        value?.propertyValueId,
        value?.valueId,
        value?.id
      );
      const label = pickString(
        value?.propertyValueDisplayName,
        value?.propertyValueDefinitionName,
        value?.propertyValueName,
        value?.skuPropertyValue,
        value?.attrValueName,
        value?.name
      );
      const image = pickString(
        value?.skuPropertyImagePath,
        value?.propertyValueImagePath,
        value?.image,
        value?.imageUrl
      );
      if (!propertyName || !valueId) continue;

      const key = propertyId ? `${propertyId}:${valueId}` : valueId;
      lookup.set(key, {
        name: propertyName,
        value: label || valueId,
        image: image || null,
      });
      lookup.set(valueId, {
        name: propertyName,
        value: label || valueId,
        image: image || null,
      });
    }
  }

  return lookup;
}

function resolveVariantAttributes(row, valueLookup) {
  const rawPairs = pickString(
    row?.skuAttr,
    row?.skuPropIds,
    row?.skuProperties,
    row?.skuPropertyValueIds
  );
  const rawNames = pickString(row?.skuAttrName, row?.skuPropNames, row?.skuPropertyNames);
  const attributes = {};
  let image = null;

  if (rawPairs) {
    rawPairs
      .split(/;|,/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const lookup = valueLookup.get(pair) || valueLookup.get(pair.split(':').pop());
        if (!lookup) return;
        attributes[lookup.name] = lookup.value;
        image = image || lookup.image;
      });
  }

  if (Object.keys(attributes).length === 0 && rawNames) {
    rawNames
      .split(/;|,/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry, index) => {
        const parts = entry.split(':').map((part) => part.trim()).filter(Boolean);
        if (parts.length >= 2) {
          attributes[parts[0]] = parts.slice(1).join(': ');
        } else {
          attributes[`Option ${index + 1}`] = entry;
        }
      });
  }

  return { attributes, image };
}

function buildVariantTitle(attributes, fallbackTitle, externalVariantId) {
  const labels = Object.entries(attributes).map(([name, value]) => `${name}: ${value}`);
  if (labels.length > 0) return labels.join(' / ');
  if (fallbackTitle) return fallbackTitle;
  if (externalVariantId) return `Variant ${externalVariantId}`;
  return 'Default';
}

function extractAliExpressRoot(candidates) {
  for (const candidate of candidates) {
    const match = findFirstObject(candidate, (entry) =>
      Boolean(
        entry?.skuModule ||
          entry?.imageModule ||
          entry?.productInfoComponent ||
          entry?.productSKUPropertyList ||
          entry?.skuPriceList
      )
    );
    if (match) return match;
  }

  return candidates[0] || {};
}

function extractAliExpressImages(root, html, finalUrl) {
  const imageModule = findFirstObject(root, (entry) => Array.isArray(entry?.imagePathList)) || {};
  return normalizeImages([
    ...(Array.isArray(imageModule.imagePathList) ? imageModule.imagePathList : []),
    ...(Array.isArray(imageModule.skuImageList) ? imageModule.skuImageList : []),
    ...(html.match(/https?:\/\/[^"'\\\s<>]+alicdn[^"'\\\s<>]+?\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi) || []),
    ...extractImageCandidatesFromHtml(html, finalUrl),
    extractProductSnapshotFromJsonLd(html, finalUrl)?.image,
  ]);
}

function extractAliExpressShippingUsd(root) {
  const shippingModule =
    findFirstObject(root, (entry) =>
      Boolean(
        entry?.shippingModule ||
          entry?.generalFreightInfo ||
          entry?.shippingFreight ||
          entry?.deliveryModule
      )
    ) || {};

  const candidates = [
    shippingModule?.shippingModule?.generalFreightInfo?.originalLayoutResultList?.[0]?.bizData?.shippingFreight?.amount?.value,
    shippingModule?.generalFreightInfo?.originalLayoutResultList?.[0]?.bizData?.shippingFreight?.amount?.value,
    shippingModule?.shippingFreight?.amount?.value,
    shippingModule?.deliveryModule?.displayFreight?.amount?.value,
  ];

  for (const candidate of candidates) {
    const parsed = parseAmount(candidate);
    if (parsed !== null) return parsed;
  }

  return null;
}

function extractAliExpressVariants(root, productTitle, fallbackPrice, fallbackCurrency, fallbackImage, productId) {
  const propertyRows =
    findFirstArray(root, (entry) =>
      entry.some((row) => isPlainObject(row) && (row?.skuPropertyValues || row?.skuPropertyName))
    ) || [];
  const priceRows =
    findFirstArray(root, (entry) =>
      entry.some((row) => isPlainObject(row) && (row?.skuId || row?.skuAttr || row?.skuVal))
    ) || [];
  const valueLookup = buildAttributeValueLookup(propertyRows);

  const variants = priceRows
    .map((row, index) => {
      const externalVariantId = pickString(
        row?.skuId,
        row?.skuIdStr,
        row?.skuAttr,
        row?.skuPropIds,
        row?.id
      );
      const { attributes, image } = resolveVariantAttributes(row, valueLookup);
      const sourcePrice = extractPriceValue(row);

      return {
        external_variant_id:
          externalVariantId ||
          `${productId || 'aliexpress'}-${index + 1}`,
        title: buildVariantTitle(attributes, pickString(row?.skuAttrName, row?.skuPropNames), externalVariantId),
        image: normalizeImages([image, row?.skuImage, row?.image, fallbackImage])[0] || null,
        source_price: sourcePrice ?? fallbackPrice ?? null,
        currency: extractCurrency(row, fallbackCurrency),
        attributes,
        inbound_shipping_usd: null,
      };
    })
    .filter((variant) => variant.external_variant_id && variant.source_price !== null);

  if (variants.length > 0) {
    return variants;
  }

  return [
    {
      external_variant_id: `${productId || 'aliexpress'}-default`,
      title: productTitle || 'Default',
      image: fallbackImage || null,
      source_price: fallbackPrice ?? null,
      currency: fallbackCurrency,
      attributes: {},
      inbound_shipping_usd: null,
    },
  ];
}

function normalizeAliExpressProduct({ productUrl, html, finalUrl, root }) {
  const snapshot = extractProductSnapshotFromJsonLd(html, finalUrl) || {};
  const productInfo =
    findFirstObject(root, (entry) =>
      Boolean(entry?.productInfoComponent || entry?.subject || entry?.productId || entry?.id)
    ) || {};
  const productId =
    pickString(
      productInfo?.productInfoComponent?.id,
      productInfo?.productInfoComponent?.productId,
      productInfo?.productId,
      productInfo?.id
    ) || extractProductIdFromUrl(finalUrl) || extractProductIdFromUrl(productUrl);
  const title =
    pickString(
      productInfo?.productInfoComponent?.subject,
      productInfo?.subject,
      snapshot.title,
      extractFallbackTitleFromHtml(html),
      extractTitleFromHtml(html)
    ) || 'AliExpress product';
  const rawDescription =
    parseHtmlDescription(
      pickString(
        productInfo?.descriptionModule?.description,
        productInfo?.productDescComponent?.description,
        productInfo?.description,
        extractFallbackDescriptionFromHtml(html),
        ''
      )
    ) || '';
  const description = normalizeProductDescription(rawDescription, title);
  const descriptionImages = extractDescriptionImageUrls(rawDescription);
  const images = extractAliExpressImages(root, html, finalUrl);
  const primaryImage = images[0] || snapshot.image || null;
  const fallbackPrice = parseAmount(snapshot.price) ?? extractFallbackPriceFromHtml(html);
  const fallbackCurrency =
    pickString(
      productInfo?.productInfoComponent?.currencyCode,
      productInfo?.currencyCode,
      productInfo?.currency
    ) || 'USD';
  const inboundShippingUsd = extractAliExpressShippingUsd(root);
  const variants = extractAliExpressVariants(
    root,
    title,
    fallbackPrice,
    fallbackCurrency,
    primaryImage,
    productId
  ).map((variant) => ({
    ...variant,
    inbound_shipping_usd: variant.inbound_shipping_usd ?? inboundShippingUsd,
  }));

  const hasUsableVariant = variants.some((variant) => variant.source_price !== null);
  const hasUsableImages = images.length > 0;
  const hasUsableTitle = isMeaningfulTitle(title);

  if (!hasUsableTitle || !hasUsableVariant || !hasUsableImages) {
    throw new Error(
      'AliExpress returned an incomplete product page. The page did not expose enough title, image, or price data to import safely.'
    );
  }

  return {
    provider: 'aliexpress',
    supplier_source: 'aliexpress',
    external_product_id: productId || extractProductIdFromUrl(finalUrl) || finalUrl,
    supplier_product_id: productId || extractProductIdFromUrl(finalUrl) || finalUrl,
    supplier_url: finalUrl,
    title,
    description,
    description_images: descriptionImages,
    images,
    source_price: variants[0]?.source_price ?? fallbackPrice ?? null,
    currency: variants[0]?.currency || fallbackCurrency,
    inbound_shipping_usd: inboundShippingUsd,
    variants,
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

  try {
    const normalizedUrl = normalizeSupportedSourceUrl(payload.product_url);
    if (normalizedUrl.sourceDomain !== 'aliexpress') {
      return jsonResponse(400, {
        success: false,
        error: 'Only AliExpress product URLs are supported by this ingestion endpoint',
      });
    }

    const response = await fetch(normalizedUrl.sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'JulineMart-Global-Sourcing/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to fetch AliExpress product URL (${response.status})`);
    }

    const html = await response.text();
    const finalUrl = response.url || normalizedUrl.sourceUrl;
    const root = extractAliExpressRoot(parseJsonCandidates(html));
    const product = normalizeAliExpressProduct({
      productUrl: normalizedUrl.sourceUrl,
      html,
      finalUrl,
      root,
    });

    return jsonResponse(200, {
      success: true,
      data: {
        product,
      },
    });
  } catch (error) {
    return jsonResponse(502, {
      success: false,
      error: 'AliExpress ingestion failed',
      message: error?.message || 'Unable to ingest AliExpress product',
    });
  }
}
