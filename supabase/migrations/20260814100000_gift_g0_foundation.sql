-- Phase G0: JulineMart Gifts foundation — Warri pilot hub + admin-managed GFCs + gift pool

CREATE TABLE IF NOT EXISTS public.gift_fulfilment_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  country text NOT NULL DEFAULT 'Nigeria',
  state text NOT NULL,
  city text NOT NULL,
  address text,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  supported_delivery_zones jsonb NOT NULL DEFAULT '[]'::jsonb,
  cutoff_time time,
  same_day_supported boolean NOT NULL DEFAULT false,
  next_day_supported boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_fulfilment_centres_active
  ON public.gift_fulfilment_centres(active) WHERE active = true;

CREATE TABLE IF NOT EXISTS public.gift_pool_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_fulfilment_centre_id uuid NOT NULL REFERENCES public.gift_fulfilment_centres(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variation_id uuid REFERENCES public.product_variations(id) ON DELETE SET NULL,
  available_qty int NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
  gift_program_cost numeric(12,2),
  lead_time_days int NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gift_fulfilment_centre_id, product_id, variation_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_pool_gfc ON public.gift_pool_inventory(gift_fulfilment_centre_id);
CREATE INDEX IF NOT EXISTS idx_gift_pool_product ON public.gift_pool_inventory(product_id);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gift_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_category text,
  ADD COLUMN IF NOT EXISTS gift_recipient_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS gift_occasion_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS gift_box_compatible boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_products_gift_eligible
  ON public.products(gift_eligible) WHERE gift_eligible = true;

-- Only one default GFC at a time
CREATE OR REPLACE FUNCTION public.gift_fulfilment_centre_default_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.gift_fulfilment_centres
    SET is_default = false, updated_at = now()
    WHERE id <> NEW.id AND is_default = true;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gift_fulfilment_centre_default ON public.gift_fulfilment_centres;
CREATE TRIGGER trg_gift_fulfilment_centre_default
  BEFORE INSERT OR UPDATE OF is_default ON public.gift_fulfilment_centres
  FOR EACH ROW EXECUTE FUNCTION public.gift_fulfilment_centre_default_guard();

-- Seed Warri Gift Hub (pilot consolidation centre)
INSERT INTO public.gift_fulfilment_centres (
  name, code, country, state, city, address, active, is_default, next_day_supported
)
SELECT
  'Warri Gift Hub',
  'warri',
  'Nigeria',
  'Delta',
  'Warri',
  'Warri, Delta State',
  true,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.gift_fulfilment_centres WHERE code = 'warri'
);

COMMENT ON TABLE public.gift_fulfilment_centres IS 'JulineMart Gifts consolidation hubs — admin-managed';
COMMENT ON TABLE public.gift_pool_inventory IS 'Products available for gift box fulfilment at a specific GFC';
