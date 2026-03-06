import { getCjAccessToken, requestCjJson } from './services/cjAuth.js';
import {
  headers,
  jsonResponse,
  normalizeImages,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';

function pickVariantList(payload) {
  const candidates = [
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

function normalizeVariant(record, product) {
  const attributesSource =
    Array.isArray(record?.attributes) ? record.attributes : Array.isArray(record?.properties) ? record.properties : [];
  const attributes = attributesSource.reduce((accumulator, entry) => {
    const name = entry?.name ?? entry?.attributeName ?? entry?.propertyName;
    const value = entry?.value ?? entry?.attributeValue ?? entry?.propertyValue;
    if (name && value) {
      accumulator[String(name)] = String(value);
    }
    return accumulator;
  }, {});

  return {
    external_variant_id: String(
      record?.vid ?? record?.variantId ?? record?.skuId ?? record?.id ?? ''
    ),
    title: String(record?.variantName ?? record?.name ?? product?.title ?? '').trim(),
    image:
      normalizeImages([
        record?.image,
        record?.variantImage,
        record?.mainImage,
        ...(Array.isArray(record?.images) ? record.images : []),
      ])[0] || null,
    source_price:
      record?.sourcePrice ?? record?.sellPrice ?? record?.price ?? product?.source_price ?? null,
    currency: record?.currency || record?.currencyCode || product?.currency || 'USD',
    attributes,
    raw: record,
  };
}

function normalizeProduct(payload, externalProductId) {
  const product =
    payload?.data?.product ||
    payload?.data?.detail ||
    payload?.data?.data ||
    payload?.result?.product ||
    payload?.result ||
    payload?.product ||
    payload;

  const images = normalizeImages([
    ...(Array.isArray(product?.images) ? product.images : []),
    ...(Array.isArray(product?.imageList) ? product.imageList : []),
    ...(Array.isArray(product?.productImageList) ? product.productImageList : []),
    product?.image,
    product?.productImage,
    product?.mainImage,
  ]);

  const normalized = {
    provider: 'cj',
    external_product_id: String(
      product?.pid ?? product?.productId ?? product?.id ?? externalProductId ?? ''
    ),
    title: String(product?.productName ?? product?.name ?? product?.title ?? '').trim(),
    description: String(
      product?.description ?? product?.productDescription ?? product?.remark ?? ''
    ).trim(),
    images,
    category: product?.categoryName ?? product?.category ?? null,
    source_price:
      product?.sourcePrice ?? product?.sellPrice ?? product?.price ?? product?.packingPrice ?? null,
    currency: product?.currency || product?.currencyCode || 'USD',
  };

  const variants = pickVariantList(payload)
    .map((entry) => normalizeVariant(entry, normalized))
    .filter((entry) => entry.external_variant_id || Object.keys(entry.attributes).length > 0);

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

  const auth = await requireAdmin(event, ['admin']);
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
    const result = await requestCjJson({
      pathCandidates: ['/product/queryByPid', '/product/detail', '/products/detail'],
      method: 'POST',
      accessToken: token.accessToken,
      bodyCandidates: [{ pid: externalProductId }, { productId: externalProductId }],
      query: { pid: externalProductId },
    });

    return jsonResponse(200, {
      success: true,
      data: {
        endpoint: result.endpoint,
        product: normalizeProduct(result.data, externalProductId),
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
