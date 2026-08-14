-- Phase 2A: store follows, vendor QR analytics, seller actual product photos

CREATE TABLE IF NOT EXISTS public.store_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor_woo_id text NOT NULL,
  vendor_uuid uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  notify_new_products boolean NOT NULL DEFAULT true,
  notify_promotions boolean NOT NULL DEFAULT true,
  notify_restock boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, vendor_woo_id)
);

CREATE INDEX IF NOT EXISTS idx_store_follows_user ON public.store_follows(user_id);
CREATE INDEX IF NOT EXISTS idx_store_follows_vendor ON public.store_follows(vendor_woo_id);

CREATE TABLE IF NOT EXISTS public.vendor_qr_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_woo_id text NOT NULL,
  source text DEFAULT 'store_qr',
  scanned_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_vendor_qr_scans_vendor ON public.vendor_qr_scans(vendor_woo_id);

ALTER TABLE public.product_images
  ADD COLUMN IF NOT EXISTS photo_source text DEFAULT 'manufacturer'
  CHECK (photo_source IN ('manufacturer', 'seller_actual'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_method text DEFAULT 'delivery'
  CHECK (fulfillment_method IN ('delivery', 'store_pickup'));

COMMENT ON TABLE public.store_follows IS 'Customer follow relationships with vendor storefronts';
COMMENT ON COLUMN public.product_images.photo_source IS 'Distinguishes manufacturer vs seller actual product photography';
