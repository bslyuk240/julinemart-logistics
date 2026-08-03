import type { SupabaseClient } from '@supabase/supabase-js';
import { logClientError } from './clientErrorLogger';

// Must match the `product-images` Supabase Storage bucket config (file_size_limit / allowed_mime_types).
// Keep these in sync if the bucket limits ever change.
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const PRODUCT_IMAGE_ACCEPT = PRODUCT_IMAGE_ALLOWED_TYPES.join(',');

export function validateProductImageFile(file: File): string | null {
  if (!PRODUCT_IMAGE_ALLOWED_TYPES.includes(file.type)) {
    return `Unsupported file type${file.type ? ` (${file.type})` : ''}. Use JPG, PNG, WEBP, or GIF.`;
  }
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `Image is ${mb}MB — the max is 5MB. Try a smaller photo or compress it first.`;
  }
  return null;
}

export async function uploadProductImageFile(
  supabase: SupabaseClient,
  file: File,
): Promise<{ url: string | null; error: string | null }> {
  const fileContext = { area: 'product_image_upload', fileName: file.name, fileSize: file.size, fileType: file.type };

  const validationError = validateProductImageFile(file);
  if (validationError) {
    logClientError(validationError, fileContext);
    return { url: null, error: validationError };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
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
