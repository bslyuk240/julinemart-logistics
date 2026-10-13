/**
 * Rider KYC files (ID document, selfies, vehicle document) live in the
 * private `rider-kyc` bucket; see privateStorage.js for how stored references
 * become short-lived signed URLs.
 *
 * Delivery proofs and signatures stay in the public `rider-documents` bucket
 * (they're shared with Skola and shown on order screens) and pass through
 * unchanged.
 */
import { signFields, signStorageUrl } from './privateStorage.js';

export const RIDER_KYC_BUCKET = 'rider-kyc';

export function signKycUrl(adminClient, url) {
  return signStorageUrl(adminClient, url);
}

/** Signs every KYC URL on a rider row (and its nested rider_documents). */
export async function signRiderKycFields(adminClient, rider) {
  if (!rider) return rider;
  const signed = await signFields(adminClient, rider, ['id_document_url', 'selfie_url', 'vehicle_document_url']);
  if (Array.isArray(signed.rider_documents)) {
    signed.rider_documents = await signDocumentRows(adminClient, signed.rider_documents);
  }
  return signed;
}

export function signDocumentRows(adminClient, rows) {
  return Promise.all((rows || []).map((row) => signFields(adminClient, row, ['file_url'])));
}
