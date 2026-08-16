import { supabase } from './supabase';

/**
 * Uploads a KYC document to the rider-documents bucket, scoped under the
 * signed-in user's own id — required by the bucket's RLS policy (see
 * supabase/migrations/20260816170000_rider_documents_storage.sql).
 */
export async function uploadRiderDocument(userId: string, file: File, label: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${userId}/${label}_${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from('rider-documents').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data: pub } = supabase.storage.from('rider-documents').getPublicUrl(data.path);
  return pub.publicUrl;
}
