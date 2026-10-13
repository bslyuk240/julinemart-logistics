/**
 * Rider KYC files (ID document, selfies, vehicle document) live in the
 * private `rider-kyc` bucket. The database stores each file's storage URL as
 * a stable reference; nothing can load that URL directly. Anything that hands
 * these files to a browser swaps them for short-lived signed URLs here.
 *
 * Delivery proofs and signatures stay in the public `rider-documents` bucket
 * (they're shared with Skola and shown on order screens) and pass through
 * unchanged.
 */
export const RIDER_KYC_BUCKET = 'rider-kyc';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

// Pulls { bucket, path } out of a Supabase Storage object URL.
function parseStorageUrl(url) {
  const match = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?#]+)/.exec(url || '');
  return match ? { bucket: match[1], path: decodeURIComponent(match[2]) } : null;
}

export async function signKycUrl(adminClient, url) {
  const ref = parseStorageUrl(url);
  if (!ref || ref.bucket !== RIDER_KYC_BUCKET) return url;
  const { data, error } = await adminClient.storage
    .from(RIDER_KYC_BUCKET)
    .createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.warn('[riderKyc] could not sign', ref.path, error.message);
    return null;
  }
  return data.signedUrl;
}

/** Signs every KYC URL on a rider row (and its nested rider_documents). */
export async function signRiderKycFields(adminClient, rider) {
  if (!rider) return rider;
  const signed = { ...rider };
  for (const field of ['id_document_url', 'selfie_url', 'vehicle_document_url']) {
    if (signed[field]) signed[field] = await signKycUrl(adminClient, signed[field]);
  }
  if (Array.isArray(signed.rider_documents)) {
    signed.rider_documents = await signDocumentRows(adminClient, signed.rider_documents);
  }
  return signed;
}

export async function signDocumentRows(adminClient, rows) {
  return Promise.all(
    (rows || []).map(async (row) => ({ ...row, file_url: await signKycUrl(adminClient, row.file_url) })),
  );
}
