import { getCjAccessToken, requestCjJson } from './services/cjAuth.js';
import {
  extractDescriptionImageUrls,
  GLOBAL_SOURCING_ALLOWED_ROLES,
  headers,
  jsonResponse,
  normalizeImages,
  normalizeProductDescription,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';

function pickVariantList(payload) {
  const candidates = [
    payload?.data,
    payload?.data?.variants,
    payload?.data?.variantList,
    payload?.data?.skuList,
    payload?.data?.productSkuDTOList,
    payload?.data?.items,
    payload?.result?.variants,
    payload?.result?.variantList,
    payload?.variants,
    payload?.variantList,
    payload?.skuList,
  ];

  return candidates.find((value) => Array.isArray(value)) || [];
}

function toTrimmedString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseJsonValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function asStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(toTrimmedString).filter(Boolean);
  }

  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed.map(toTrimmedString).filter(Boolean);
  }

  return [];
}

function firstNonEmptyString(values) {
  return values.map(toTrimmedString).find(Boolean) || '';
}

function buildVariantAttributes(record) {
  const attributesSource = [
    ...(Array.isArray(record?.attributes) ? record.attributes : []),
    ...(Array.isArray(record?.properties) ? record.properties : []),
    ...(Array.isArray(record?.propertyList) ? record.propertyList : []),
    ...(Array.isArray(record?.variantProperties) ? record.variantProperties : []),
  ];

  const parsedVariantProperty = parseJsonValue(record?.variantProperty);
  if (Array.isArray(parsedVariantProperty)) {
    attributesSource.push(...parsedVariantProperty);
  } else if (parsedVariantProperty && typeof parsedVariantProperty === 'object') {
    attributesSource.push(parsedVariantProperty);
  }

  return attributesSource.reduce((accumulator, entry) => {
    const name =
      entry?.name ??
      entry?.attributeName ??
      entry?.propertyName ??
      entry?.propName ??
      entry?.keyName ??
      entry?.key;
    const value =
      entry?.value ??
      entry?.attributeValue ??
      entry?.propertyValue ??
      entry?.propValue ??
      entry?.keyValue ??
      entry?.val;

    if (name && value) {
      accumulator[String(name)] = String(value);
    }

    return accumulator;
  }, {});
}

function buildVariantTitle(record, product, attributes) {
  const productTitle = toTrimmedString(product?.title);
  const explicitTitle = [
    record?.variantName,
    record?.variantNameEn,
    record?.variantSkuName,
    record?.skuName,
    record?.variantSku,
    record?.variantKey,
    record?.name,
    record?.variant,
  ]
    .map(toTrimmedString)
    .find(Boolean);

  const attributePairs = Object.entries(attributes)
    .map(([name, value]) => `${name}: ${value}`)
    .filter(Boolean);
  const attributeLabel = attributePairs.join(' / ');
  const valueOnlyLabel = Object.values(attributes)
    .map(toTrimmedString)
    .filter(Boolean)
    .join(' / ');

  if (explicitTitle && explicitTitle !== productTitle) {
    return explicitTitle;
  }
  if (attributeLabel) {
    return explicitTitle && explicitTitle !== productTitle
      ? `${explicitTitle} - ${attributeLabel}`
      : attributeLabel;
  }
  if (valueOnlyLabel) {
    return valueOnlyLabel;
  }

  const externalVariantId = toTrimmedString(
    record?.vid ?? record?.variantId ?? record?.skuId ?? record?.id ?? ''
  );
  if (externalVariantId) {
    return `Variant ${externalVariantId}`;
  }

  return explicitTitle || productTitle || '';
}

function normalizeVariant(record, product) {
  const attributes = buildVariantAttributes(record);
  const externalVariantId = toTrimmedString(
    record?.vid ?? record?.variantId ?? record?.skuId ?? record?.id ?? ''
  );
  const imageCandidates = [
    record?.image,
    record?.variantImage,
    record?.variantimage,
    record?.mainImage,
    ...(Array.isArray(record?.images) ? record.images : []),
    ...asStringArray(record?.images),
  ];

  return {
    external_variant_id: externalVariantId || null,
    title: buildVariantTitle(record, product, attributes),
    sku: toTrimmedString(
      record?.variantSku ??
        record?.sku ??
        record?.variantCode ??
        record?.productSku ??
        record?.variantSkuCode ??
        ''
    ) || null,
    image: normalizeImages(imageCandidates)[0] || null,
    source_price:
      record?.sourcePrice ??
      record?.variantSellPrice ??
      record?.variantSugSellPrice ??
      record?.sellPrice ??
      record?.price ??
      record?.productPrice ??
      product?.source_price ??
      null,
    currency: record?.currency || record?.currencyCode || product?.currency || 'USD',
    attributes,
    raw: record,
  };
}

function normalizeProduct(payload, externalProductId) {
  const product =
    payload?.data ||
    payload?.data?.product ||
    payload?.data?.detail ||
    payload?.data?.data ||
    payload?.result?.product ||
    payload?.result ||
    payload?.product ||
    payload;

  const images = normalizeImages([
    ...(Array.isArray(product?.images) ? product.images : []),
    ...asStringArray(product?.images),
    ...(Array.isArray(product?.imageList) ? product.imageList : []),
    ...asStringArray(product?.imageList),
    ...(Array.isArray(product?.productImageList) ? product.productImageList : []),
    ...asStringArray(product?.productImageList),
    ...(Array.isArray(product?.productImageSet) ? product.productImageSet : []),
    ...asStringArray(product?.productImageSet),
    product?.image,
    product?.productImage,
    product?.mainImage,
  ]);

  const productName = firstNonEmptyString([
    product?.productNameEn,
    product?.productName,
    Array.isArray(product?.productNameSet) ? product.productNameSet.join(' ') : '',
    product?.name,
    product?.title,
  ]);
  const sourceDescription =
    product?.description ??
    product?.productDescription ??
    product?.descriptionEn ??
    product?.remark ??
    '';

  const normalized = {
    provider: 'cj',
    external_product_id: String(
      product?.pid ?? product?.productId ?? product?.id ?? externalProductId ?? ''
    ),
    title: productName,
    description: normalizeProductDescription(sourceDescription, productName),
    description_images: extractDescriptionImageUrls(sourceDescription),
    images,
    category: product?.categoryName ?? product?.category ?? null,
    source_price:
      product?.sourcePrice ??
      product?.sellPrice ??
      product?.suggestSellPrice ??
      product?.price ??
      product?.packingPrice ??
      null,
    currency: product?.currency || product?.currencyCode || 'USD',
  };

  const variantsRaw = pickVariantList(payload)
    .map((entry) => normalizeVariant(entry, normalized))
    .filter((entry) => entry.external_variant_id || Object.keys(entry.attributes).length > 0);

  const variants = variantsRaw.slice().sort((left, right) => {
    const a = String(left.external_variant_id || '');
    const b = String(right.external_variant_id || '');
    return a.localeCompare(b, undefined, { numeric: true });
  });

  return {
    ...normalized,
    variants:
      variants.length > 0
        ? variants
        : [
            {
              external_variant_id: null,
              title: normalized.title,
              image: images[0] || null,
              source_price: normalized.source_price,
              currency: normalized.currency,
              attributes: {},
              raw: null,
            },
          ],
    raw: payload,
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Method not allowed' });
  }

  const auth = await requireAdmin(event, GLOBAL_SOURCING_ALLOWED_ROLES);
  if (auth.errorResponse) return auth.errorResponse;

  const payload = event.httpMethod === 'POST' ? parseJsonBody(event.body) : {};
  if (payload === null) {
    return jsonResponse(400, { success: false, error: 'Malformed JSON body' });
  }

  const externalProductId = String(
    payload?.external_product_id ||
      payload?.cj_pid ||
      event.queryStringParameters?.external_product_id ||
      event.queryStringParameters?.cj_pid ||
      ''
  ).trim();

  if (!externalProductId) {
    return jsonResponse(400, { success: false, error: 'external_product_id is required' });
  }

  try {
    const token = await getCjAccessToken();
    const [productResult, variantsResult] = await Promise.all([
      requestCjJson({
        pathCandidates: ['/v1/product/query'],
        method: 'GET',
        accessToken: token.accessToken,
        bodyCandidates: [undefined],
        queryCandidates: [{ pid: externalProductId }],
      }),
      requestCjJson({
        pathCandidates: ['/v1/product/variant/queryByPid', '/v1/product/variant/query'],
        method: 'GET',
        accessToken: token.accessToken,
        bodyCandidates: [undefined],
        queryCandidates: [{ pid: externalProductId }],
      }),
    ]);

    const mergedPayload = {
      ...(productResult.data || {}),
      data: {
        ...(productResult.data?.data || {}),
        variants: pickVariantList(variantsResult.data),
      },
    };

    return jsonResponse(200, {
      success: true,
      data: {
        endpoint: productResult.endpoint,
        variant_endpoint: variantsResult.endpoint,
        product: normalizeProduct(mergedPayload, externalProductId),
      },
    });
  } catch (error) {
    return jsonResponse(502, {
      success: false,
      error: 'CJ product details failed',
      message: error?.message || 'Unable to fetch CJ product details',
      details: error?.details || [],
    });
  }
}
