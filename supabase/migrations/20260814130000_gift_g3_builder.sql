-- Phase G3: Build your own gift box (Mode B)

CREATE TABLE IF NOT EXISTS public.gift_packaging_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  price numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  max_items int NOT NULL DEFAULT 8 CHECK (max_items >= 1),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.gift_packaging_types (code, name, description, price, max_items, sort_order)
SELECT v.code, v.name, v.description, v.price, v.max_items, v.sort_order
FROM (VALUES
  ('standard', 'Standard Box', 'JulineMart gift box with tissue and ribbon', 1500, 5, 1),
  ('premium', 'Premium Box', 'Upgraded box, ribbon, and gift wrap', 3500, 8, 2),
  ('luxury', 'Luxury Box', 'Premium presentation with branded sleeve', 6000, 12, 3)
) AS v(code, name, description, price, max_items, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.gift_packaging_types LIMIT 1);

CREATE TABLE IF NOT EXISTS public.gift_builder_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL UNIQUE,
  gift_fulfilment_centre_id uuid NOT NULL REFERENCES public.gift_fulfilment_centres(id) ON DELETE RESTRICT,
  gift_packaging_type_id uuid REFERENCES public.gift_packaging_types(id) ON DELETE SET NULL,
  recipient_type text,
  occasion text,
  budget_max numeric(12,2),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'converted', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_builder_sessions_token ON public.gift_builder_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_gift_builder_sessions_status ON public.gift_builder_sessions(status);

CREATE TABLE IF NOT EXISTS public.gift_builder_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_builder_session_id uuid NOT NULL REFERENCES public.gift_builder_sessions(id) ON DELETE CASCADE,
  gift_pool_inventory_id uuid REFERENCES public.gift_pool_inventory(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variation_id uuid REFERENCES public.product_variations(id) ON DELETE SET NULL,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  component_cost numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gift_builder_session_id, product_id, variation_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_builder_items_session ON public.gift_builder_items(gift_builder_session_id);

ALTER TABLE public.gift_orders
  ADD COLUMN IF NOT EXISTS gift_builder_session_id uuid REFERENCES public.gift_builder_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gift_packaging_type_id uuid REFERENCES public.gift_packaging_types(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS trg_gift_builder_sessions_updated ON public.gift_builder_sessions;
CREATE TRIGGER trg_gift_builder_sessions_updated
  BEFORE UPDATE ON public.gift_builder_sessions
  FOR EACH ROW EXECUTE FUNCTION public.gift_row_updated_at();
