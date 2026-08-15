import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PRODUCT_IMAGE_ACCEPT,
  validateProductImageFile,
} from './productImageUpload';
import { logClientError } from './clientErrorLogger';

export { PRODUCT_IMAGE_ACCEPT as GIFT_IMAGE_ACCEPT };

export async function uploadGiftBoxImageFile(
  supabase: SupabaseClient,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  const fileContext = {
    area: 'gift_box_image_upload',
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
  };

  const validationError = validateProductImageFile(file);
  if (validationError) {
    logClientError(validationError, fileContext);
    return { url: null, error: validationError };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `gifts/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from('product-images').upload(path, file, {
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    logClientError(error.message, fileContext);
    return { url: null, error: error.message };
  }

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}
