-- GBX gift box SKU format + BYO auto-generated box SKU storage

ALTER TABLE public.gift_builder_sessions
  ADD COLUMN IF NOT EXISTS box_sku text;

ALTER TABLE public.gift_orders
  ADD COLUMN IF NOT EXISTS box_sku text;

CREATE INDEX IF NOT EXISTS idx_gift_orders_box_sku_upper ON public.gift_orders (upper(box_sku))
  WHERE box_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gift_builder_sessions_box_sku_upper
  ON public.gift_builder_sessions (upper(box_sku))
  WHERE box_sku IS NOT NULL;

COMMENT ON COLUMN public.gift_boxes.sku IS
  'Unique gift box identifier (GBX-{occasion}-{recipient}-{###}). Vouchers match on this SKU; vendor lines inside are settled separately.';
COMMENT ON COLUMN public.gift_builder_sessions.box_sku IS
  'Auto-generated GBX SKU when customer checks out a build-your-own box — not shown in storefront UI.';
COMMENT ON COLUMN public.gift_orders.box_sku IS
  'Resolved GBX SKU for this gift order (ready-made box sku or BYO auto-generated sku).';
