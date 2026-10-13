/**
 * Private storage buckets and signed links.
 *
 * Files in these buckets can't be loaded by URL. The database keeps each
 * file's storage URL (public-style, `/object/public/<bucket>/<path>`) as a
 * stable reference, and anything that hands files to a browser or partner
 * swaps them for short-lived signed URLs here. URLs for any other bucket (or
 * external links) pass through unchanged, so callers can sign mixed lists.
 */
export const PRIVATE_BUCKETS = new Set(['rider-kyc', 'vendor-kyc', 'admin-documents', 'return-images']);
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

// Pulls { bucket, path } out of a Supabase Storage object URL.
export function parseStorageUrl(url) {
  const match = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?#]+)/.exec(url || '');
  return match ? { bucket: match[1], path: decodeURIComponent(match[2]) } : null;
}

/** The stored reference for a file in a private bucket. */
export function storageReferenceUrl(bucket, path) {
  const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

export async function signStorageUrl(adminClient, url, ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  if (typeof url !== 'string') return url;
  const ref = parseStorageUrl(url);
  if (!ref || !PRIVATE_BUCKETS.has(ref.bucket)) return url;
  const { data, error } = await adminClient.storage.from(ref.bucket).createSignedUrl(ref.path, ttlSeconds);
  if (error) {
    console.warn('[privateStorage] could not sign', ref.bucket, ref.path, error.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * Returns a copy of `obj` with the named fields signed. A field may hold one
 * URL or an array of URLs.
 */
export async function signFields(adminClient, obj, fields, ttlSeconds) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const field of fields) {
    const value = out[field];
    if (Array.isArray(value)) {
      out[field] = await Promise.all(value.map((v) => signStorageUrl(adminClient, v, ttlSeconds)));
    } else if (value) {
      out[field] = await signStorageUrl(adminClient, value, ttlSeconds);
    }
  }
  return out;
}

/** Return-request photos live in the private return-images bucket. */
export const RETURN_IMAGE_FIELDS = ['images', 'evidence_urls'];

export function signReturnImages(adminClient, row, ttlSeconds) {
  return signFields(adminClient, row, RETURN_IMAGE_FIELDS, ttlSeconds);
}

export function signReturnRows(adminClient, rows, ttlSeconds) {
  return Promise.all((rows || []).map((row) => signReturnImages(adminClient, row, ttlSeconds)));
}
