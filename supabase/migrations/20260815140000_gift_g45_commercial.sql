-- Phase G4.5: Gift commercial model — vendor catalog settlement + JLO-sourced pool + pricing stack

-- Per-hub (or default) markup / margin defaults for gift customer pricing
CREATE TABLE IF NOT EXISTS public.gift_commercial_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_fulfilment_centre_id uuid REFERENCES public.gift_fulfilment_centres(id) ON DELETE CASCADE,
  packaging_markup numeric(12,2) NOT NULL DEFAULT 0 CHECK (packaging_markup >= 0),
  profit_margin_percent numeric(5,2) NOT NULL DEFAULT 15 CHECK (profit_margin_percent >= 0),
  profit_margin_fixed numeric(12,2) NOT NULL DEFAULT 0 CHECK (profit_margin_fixed >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gift_fulfilment_centre_id)
);

COMMENT ON TABLE public.gift_commercial_settings IS 'Default packaging markup + profit margin for gift customer pricing per GFC (NULL gfc = global default row optional)';

-- Pool items sourced outside vendor catalog (no products row required)
CREATE TABLE IF NOT EXISTS public.gift_pool_sourced_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_fulfilment_centre_id uuid NOT NULL REFERENCES public.gift_fulfilment_centres(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  description text,
  image_url text,
  gift_category text,
  gift_program_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (gift_program_cost >= 0),
  contribution_weight numeric(12,2) NOT NULL DEFAULT 0 CHECK (contribution_weight >= 0),
  available_qty int NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
  lead_time_days int NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_pool_sourced_gfc ON public.gift_pool_sourced_items(gift_fulfilment_centre_id);
CREATE INDEX IF NOT EXISTS idx_gift_pool_sourced_active ON public.gift_pool_sourced_items(active) WHERE active = true;

-- Tag vendor-catalog pool rows explicitly
ALTER TABLE public.gift_pool_inventory
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'vendor_catalog'
    CHECK (source_type IN ('vendor_catalog'));

-- Ready-made box lines can reference sourced pool SKUs
ALTER TABLE public.gift_box_items
  ADD COLUMN IF NOT EXISTS line_source text NOT NULL DEFAULT 'vendor_catalog'
    CHECK (line_source IN ('vendor_catalog', 'jlo_sourced')),
  ADD COLUMN IF NOT EXISTS pool_sourced_item_id uuid REFERENCES public.gift_pool_sourced_items(id) ON DELETE SET NULL;

-- Ready-made / builder lines may reference sourced pool SKUs without catalog product_id
ALTER TABLE public.gift_box_items
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.gift_builder_items
  ADD COLUMN IF NOT EXISTS line_source text NOT NULL DEFAULT 'vendor_catalog'
    CHECK (line_source IN ('vendor_catalog', 'jlo_sourced')),
  ADD COLUMN IF NOT EXISTS pool_sourced_item_id uuid REFERENCES public.gift_pool_sourced_items(id) ON DELETE SET NULL;

ALTER TABLE public.gift_builder_items
  ALTER COLUMN product_id DROP NOT NULL;

-- Gift order commercial breakdown (customer vs vendor settlement)
ALTER TABLE public.gift_orders
  ADD COLUMN IF NOT EXISTS customer_subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS vendor_settlement_subtotal numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Every component line on a gift order (vendor + sourced)
CREATE TABLE IF NOT EXISTS public.gift_order_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_order_id uuid NOT NULL REFERENCES public.gift_orders(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  line_source text NOT NULL CHECK (line_source IN ('vendor_catalog', 'jlo_sourced')),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  pool_sourced_item_id uuid REFERENCES public.gift_pool_sourced_items(id) ON DELETE SET NULL,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  gift_program_cost numeric(12,2),
  vendor_settlement_unit_price numeric(12,2),
  vendor_settlement_subtotal numeric(12,2) NOT NULL DEFAULT 0,
  vendor_payout_status text NOT NULL DEFAULT 'pending'
    CHECK (vendor_payout_status IN ('pending', 'pre_settled', 'paid', 'not_applicable')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_order_line_items_gift ON public.gift_order_line_items(gift_order_id);
CREATE INDEX IF NOT EXISTS idx_gift_order_line_items_vendor ON public.gift_order_line_items(vendor_id) WHERE vendor_id IS NOT NULL;

-- Seed global default commercial settings (no gfc_id — use first default hub in app)
INSERT INTO public.gift_commercial_settings (
  gift_fulfilment_centre_id, packaging_markup, profit_margin_percent, profit_margin_fixed
)
SELECT id, 500, 15, 0
FROM public.gift_fulfilment_centres
WHERE is_default = true
  AND NOT EXISTS (
    SELECT 1 FROM public.gift_commercial_settings gcs
    WHERE gcs.gift_fulfilment_centre_id = gift_fulfilment_centres.id
  )
LIMIT 1;

COMMENT ON TABLE public.gift_pool_sourced_items IS 'JLO-sourced gift pool SKUs — not listed on main marketplace catalog';
COMMENT ON TABLE public.gift_order_line_items IS 'Component audit for gift orders; vendor lines also create order_items at catalog retail';
