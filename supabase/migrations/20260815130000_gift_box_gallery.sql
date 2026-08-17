-- Gift box cover + additional gallery images (URLs from Supabase Storage uploads)

ALTER TABLE public.gift_boxes
  ADD COLUMN IF NOT EXISTS gallery_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.gift_boxes.image_url IS 'Primary cover image URL';
COMMENT ON COLUMN public.gift_boxes.gallery_urls IS 'Additional gallery image URLs (excludes cover)';
