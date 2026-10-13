import { supabase } from './supabase';

type RiderBucket = 'rider-documents' | 'rider-kyc';

async function uploadToRiderBucket(bucket: RiderBucket, userId: string, file: File, label: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${userId}/${label}_${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw error;
  // For the private rider-kyc bucket this URL isn't loadable on its own — it's
  // the stored reference the server swaps for a short-lived signed URL.
  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return pub.publicUrl;
}

/**
 * Uploads delivery evidence (proof photo, signature) to the public
 * rider-documents bucket, scoped under the signed-in user's own id — required
 * by the bucket's RLS policy (see
 * supabase/migrations/20260816170000_rider_documents_storage.sql).
 */
export function uploadRiderDocument(userId: string, file: File, label: string): Promise<string> {
  return uploadToRiderBucket('rider-documents', userId, file, label);
}

/**
 * Uploads identity documents (ID, selfies, vehicle papers) to the private
 * rider-kyc bucket, readable only by the rider and staff
 * (supabase/migrations/20261013140000_security_audit_db_fixes.sql).
 */
export function uploadRiderKycDocument(userId: string, file: File, label: string): Promise<string> {
  return uploadToRiderBucket('rider-kyc', userId, file, label);
}
