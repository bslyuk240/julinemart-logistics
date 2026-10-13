import type { SupabaseClient } from '@supabase/supabase-js';
import { logClientError } from './clientErrorLogger';

// Must match the `product-images` Supabase Storage bucket config (file_size_limit / allowed_mime_types).
// Keep these in sync if the bucket limits ever change.
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const PRODUCT_IMAGE_ACCEPT = PRODUCT_IMAGE_ALLOWED_TYPES.join(',');

const RETRY_DELAY_MS = 1500;
const NETWORK_ERROR_MESSAGE =
  'Upload could not reach the server — check your connection and try again. A smaller or compressed image can help on slow networks.';

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

// "Failed to fetch" / "Load failed" (Safari) / "NetworkError…" (Firefox) mean the
// request never got a response — a dropped connection, not a server rejection.
// The Storage logs show these uploads never reach Supabase at all. An HTML body
// where JSON was expected is a gateway/proxy error page, also transient.
function isTransientError(message: string) {
  return /failed to fetch|load failed|networkerror|network request failed|unexpected token '<'/i.test(message);
}

export async function uploadImageToProductBucket(
  supabase: SupabaseClient,
  file: File,
  folder: 'products' | 'gifts',
  area: string,
): Promise<{ url: string | null; error: string | null }> {
  const fileContext = { area, fileName: file.name, fileSize: file.size, fileType: file.type };

  const validationError = validateProductImageFile(file);
  if (validationError) {
    logClientError(validationError, fileContext);
    return { url: null, error: validationError };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

  let lastMessage = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await supabase.storage.from('product-images').upload(path, file, {
      cacheControl: '31536000',
      upsert: false,
    });
    // On the retry, "already exists" means attempt 1 landed but its response
    // was lost — the file is there under this unique path, so treat as success.
    if (!error || (attempt > 1 && /already exists|duplicate/i.test(error.message))) {
      const { data } = supabase.storage.from('product-images').getPublicUrl(path);
      return { url: data.publicUrl, error: null };
    }
    lastMessage = error.message;
    if (!isTransientError(lastMessage) || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  const transient = isTransientError(lastMessage);
  logClientError(lastMessage, { ...fileContext, retried: transient });
  return { url: null, error: transient ? NETWORK_ERROR_MESSAGE : lastMessage };
}

export function uploadProductImageFile(supabase: SupabaseClient, file: File) {
  return uploadImageToProductBucket(supabase, file, 'products', 'product_image_upload');
}
