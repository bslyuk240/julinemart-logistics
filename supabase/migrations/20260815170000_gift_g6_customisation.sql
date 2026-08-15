-- Phase G6: Gift personalisation — reuse product_customisation_schemas via JSON spec on lines

ALTER TABLE public.gift_builder_items
  ADD COLUMN IF NOT EXISTS customisation_spec jsonb;

ALTER TABLE public.gift_order_line_items
  ADD COLUMN IF NOT EXISTS customisation_spec jsonb;

COMMENT ON COLUMN public.gift_builder_items.customisation_spec IS
  'Snapshot from product_customisation_schemas — schema_id, field_values, price_adjustment, summary_lines';

COMMENT ON COLUMN public.gift_order_line_items.customisation_spec IS
  'Copied from builder line at checkout for ops packing checklist';
