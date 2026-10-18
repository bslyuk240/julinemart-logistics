import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_IMAGE_ACCEPT, uploadImageToProductBucket } from './productImageUpload';

export { PRODUCT_IMAGE_ACCEPT as HOMEPAGE_IMAGE_ACCEPT };

/** Hero slides and hero ad banners. Video stays URL-only: the bucket accepts images. */
export function uploadHomepageImageFile(supabase: SupabaseClient, file: File) {
  return uploadImageToProductBucket(supabase, file, 'homepage', 'homepage_image_upload');
}
