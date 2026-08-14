-- Phase 4: JulineMart Custom — made-to-order schema (pilot: bakers)

CREATE TABLE IF NOT EXISTS public.product_customisation_schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  pilot_vertical text CHECK (pilot_vertical IN ('bakers', 'printers', 'tailors')),
  requires_approval boolean NOT NULL DEFAULT true,
  production_days_min int CHECK (production_days_min IS NULL OR production_days_min >= 0),
  production_days_max int CHECK (production_days_max IS NULL OR production_days_max >= 0),
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_customisation_vendor
  ON public.product_customisation_schemas(vendor_id);

CREATE TABLE IF NOT EXISTS public.custom_order_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  schema_id uuid REFERENCES public.product_customisation_schemas(id) ON DELETE SET NULL,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_adjustment numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'seller_reviewing', 'seller_confirmed', 'proof_sent',
    'customer_approved', 'in_production', 'quality_check',
    'ready', 'dispatched', 'delivered', 'cancelled'
  )),
  approved_proof_url text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_order_specs_order ON public.custom_order_specs(order_id);
CREATE INDEX IF NOT EXISTS idx_custom_order_specs_status ON public.custom_order_specs(status);

CREATE TABLE IF NOT EXISTS public.custom_order_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_order_spec_id uuid NOT NULL REFERENCES public.custom_order_specs(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('customer', 'vendor', 'admin')),
  message text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_order_messages_spec
  ON public.custom_order_messages(custom_order_spec_id, created_at);

COMMENT ON TABLE public.product_customisation_schemas IS 'Per-product custom order field definitions (JulineMart Custom Phase 4)';
COMMENT ON TABLE public.custom_order_specs IS 'Customer customisation snapshot + production timeline per order line';
