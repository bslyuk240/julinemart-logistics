import { getCjAccessToken, requestCjJson } from './services/cjAuth.js';
import {
  headers,
  isPlainObject,
  jsonResponse,
  normalizeImages,
  parseJsonBody,
  requireAdmin,
} from './services/global-sourcing-utils.js';

function pickProductList(payload) {
  const candidates = [
    payload?.data?.content?.flatMap?.((entry) =>
      Array.isArray(entry?.productList) ? entry.productList : []
    ),
    payload?.data?.list,
    payload?.data?.records,
    payload?.data?.dataList,
    payload?.data?.content,
    payload?.data?.items,
    payload?.result?.list,
    payload?.result?.records,
    payload?.products,
    payload?.list,
    payload?.records,
    payload?.items,
    payload?.data,
  ];

  return candidates.find((value) => Array.isArray(value)) || [];
}

function normalizeProduct(record) {
  const images = normalizeImages([
    ...(Array.isArray(record?.images) ? record.images : []),
    ...(Array.isArray(record?.imageList) ? record.imageList : []),
    ...(Array.isArray(record?.productImageList) ? record.productImageList : []),
    record?.image,
    record?.productImage,
    record?.mainImage,
  ]);

  const sourcePrice =
    record?.nowPrice ??
    record?.sourcePrice ??
    record?.sellPrice ??
    record?.price ??
    record?.variantPrice ??
    record?.packingPrice ??
    null;

  const variantCount =
    Number(record?.variantCount ?? record?.skuCount ?? record?.variantsTotal ?? 0) || 0;

  return {
    provider: 'cj',
    external_product_id: String(
      record?.pid ?? record?.productId ?? record?.id ?? record?.product_id ?? ''
    ),
    title: String(
      record?.productNameEn ?? record?.nameEn ?? record?.productName ?? record?.name ?? record?.title ?? ''
    ).trim(),
    images,
    category: record?.threeCategoryName ?? record?.categoryName ?? record?.category ?? null,
    source_price: sourcePrice !== null && sourcePrice !== undefined ? Number(sourcePrice) : null,
    currency: record?.currency || record?.currencyCode || 'USD',
    variants_summary:
      variantCount > 0
        ? `${variantCount} variant${variantCount === 1 ? '' : 's'}`
        : String(record?.variantsSummary ?? record?.variantName ?? '').trim() || null,
    raw: record,
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

  const query =
    String(payload?.query || payload?.search || event.queryStringParameters?.query || '').trim();
  const page = Math.max(1, Number(payload?.page || event.queryStringParameters?.page || 1) || 1);
  const requestedPageSize = Number(payload?.page_size || payload?.pageSize || 100);
  const pageSize = Math.min(Math.max(requestedPageSize || 100, 1), 100);

  if (!query) {
    return jsonResponse(400, { success: false, error: 'query is required' });
  }

  try {
    const token = await getCjAccessToken();
    const result = await requestCjJson({
      pathCandidates: ['/v1/product/listV2', '/v1/product/list'],
      method: 'GET',
      accessToken: token.accessToken,
      bodyCandidates: [undefined],
      queryCandidates: [
        { keyWord: query, page, size: pageSize },
        { productNameEn: query, pageNum: page, pageSize },
        { productName: query, pageNum: page, pageSize },
      ],
    });

    const results = pickProductList(result.data)
      .map(normalizeProduct)
      .filter((record) => record.external_product_id && record.title);

    return jsonResponse(200, {
      success: true,
      data: {
        provider: 'cj',
        query,
        endpoint: result.endpoint,
        results,
        count: results.length,
        raw_snapshot:
          isPlainObject(result.data) && Array.isArray(result.data?.data) ? undefined : result.data,
      },
    });
  } catch (error) {
    return jsonResponse(502, {
      success: false,
      error: 'CJ product search failed',
      message: error?.message || 'Unable to search CJ products',
      details: error?.details || [],
    });
  }
}
