-- Gift voucher scoping: box SKU, occasion, recipient (box treated as one sellable unit)

ALTER TABLE public.gift_boxes
  ADD COLUMN IF NOT EXISTS sku text;

UPDATE public.gift_boxes
SET sku = 'GIFT-' || upper(replace(slug, '-', '_'))
WHERE sku IS NULL OR trim(sku) = '';

ALTER TABLE public.gift_boxes
  ALTER COLUMN sku SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_boxes_sku_upper ON public.gift_boxes (upper(sku));

COMMENT ON COLUMN public.gift_boxes.sku IS
  'Unique gift box identifier (GBX-{occasion}-{recipient}-{###}) — distinct from catalog product SKUs.';

ALTER TABLE public.gift_packaging_types
  ADD COLUMN IF NOT EXISTS sku text;

UPDATE public.gift_packaging_types
SET sku = 'GIFT-PKG-' || upper(code)
WHERE sku IS NULL OR trim(sku) = '';

ALTER TABLE public.gift_packaging_types
  ALTER COLUMN sku SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gift_packaging_types_sku_upper
  ON public.gift_packaging_types (upper(sku));

COMMENT ON COLUMN public.gift_packaging_types.sku IS
  'Voucher-facing SKU for build-your-own packaging tier (the box as one unit).';

ALTER TABLE public.campaign_vouchers
  ADD COLUMN IF NOT EXISTS gift_box_skus text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS gift_occasion_slugs text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS gift_recipient_slugs text[] DEFAULT '{}'::text[];

COMMENT ON COLUMN public.campaign_vouchers.gift_box_skus IS
  'Optional gift box SKUs (GBX-occasion-recipient-###) — when set, voucher applies only on matching gift box identifier.';
COMMENT ON COLUMN public.campaign_vouchers.gift_occasion_slugs IS
  'Optional gift occasion slugs (birthday, wedding, …) — matches box tags and/or checkout occasion.';
COMMENT ON COLUMN public.campaign_vouchers.gift_recipient_slugs IS
  'Optional gift recipient slugs (her, mum, …) — matches box tags and/or builder recipient.';
