-- Phase 3.5: Product warranty + purchase archive snapshots

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS warranty_type text CHECK (warranty_type IN ('none', 'manufacturer', 'seller', 'extended')),
  ADD COLUMN IF NOT EXISTS warranty_months int CHECK (warranty_months IS NULL OR warranty_months > 0);

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS warranty_type text CHECK (warranty_type IN ('none', 'manufacturer', 'seller', 'extended')),
  ADD COLUMN IF NOT EXISTS warranty_months int CHECK (warranty_months IS NULL OR warranty_months > 0);

COMMENT ON COLUMN public.products.warranty_type IS 'Warranty offered on this product; none = not offered';
COMMENT ON COLUMN public.products.warranty_months IS 'Warranty duration in months from delivery';
COMMENT ON COLUMN public.order_items.warranty_type IS 'Snapshot of product warranty at purchase time';
COMMENT ON COLUMN public.order_items.warranty_months IS 'Snapshot warranty duration in months';
