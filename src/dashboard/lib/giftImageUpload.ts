import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_IMAGE_ACCEPT, uploadImageToProductBucket } from './productImageUpload';

export { PRODUCT_IMAGE_ACCEPT as GIFT_IMAGE_ACCEPT };

export function uploadGiftBoxImageFile(supabase: SupabaseClient, file: File) {
  return uploadImageToProductBucket(supabase, file, 'gifts', 'gift_box_image_upload');
}
