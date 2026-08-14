-- Phase G1: Ready-made gift boxes (Mode A)

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_kind text NOT NULL DEFAULT 'marketplace';

CREATE INDEX IF NOT EXISTS idx_orders_order_kind ON public.orders(order_kind);

CREATE TABLE IF NOT EXISTS public.gift_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_fulfilment_centre_id uuid NOT NULL REFERENCES public.gift_fulfilment_centres(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  image_url text,
  list_price numeric(12,2) NOT NULL CHECK (list_price >= 0),
  active boolean NOT NULL DEFAULT true,
  recipient_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  occasion_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_boxes_gfc ON public.gift_boxes(gift_fulfilment_centre_id);
CREATE INDEX IF NOT EXISTS idx_gift_boxes_active ON public.gift_boxes(active) WHERE active = true;

CREATE TABLE IF NOT EXISTS public.gift_box_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_box_id uuid NOT NULL REFERENCES public.gift_boxes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variation_id uuid REFERENCES public.product_variations(id) ON DELETE SET NULL,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  component_cost numeric(12,2) CHECK (component_cost IS NULL OR component_cost >= 0),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gift_box_id, product_id, variation_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_box_items_box ON public.gift_box_items(gift_box_id);

CREATE TABLE IF NOT EXISTS public.gift_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  gift_box_id uuid REFERENCES public.gift_boxes(id) ON DELETE SET NULL,
  gift_fulfilment_centre_id uuid NOT NULL REFERENCES public.gift_fulfilment_centres(id) ON DELETE RESTRICT,
  order_kind text NOT NULL DEFAULT 'gift_ready_made',
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  recipient_email text,
  recipient_address text NOT NULL,
  recipient_city text NOT NULL,
  recipient_state text NOT NULL,
  recipient_zone text NOT NULL,
  gift_message text,
  sender_visible boolean NOT NULL DEFAULT true,
  occasion text,
  component_cost_total numeric(12,2) NOT NULL DEFAULT 0,
  gift_status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_orders_gfc ON public.gift_orders(gift_fulfilment_centre_id);
CREATE INDEX IF NOT EXISTS idx_gift_orders_status ON public.gift_orders(gift_status);

CREATE OR REPLACE FUNCTION public.gift_row_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gift_boxes_updated ON public.gift_boxes;
CREATE TRIGGER trg_gift_boxes_updated
  BEFORE UPDATE ON public.gift_boxes
  FOR EACH ROW EXECUTE FUNCTION public.gift_row_updated_at();

DROP TRIGGER IF EXISTS trg_gift_orders_updated ON public.gift_orders;
CREATE TRIGGER trg_gift_orders_updated
  BEFORE UPDATE ON public.gift_orders
  FOR EACH ROW EXECUTE FUNCTION public.gift_row_updated_at();
