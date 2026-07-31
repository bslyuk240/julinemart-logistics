-- Sequential, collision-safe waybill numbers for sub_orders.
-- Courier-agnostic prefix ("JLO", not "FEZ") so the same numbering
-- scheme keeps working once an in-house fleet lane is added later.
-- Format: JLO-WB-000123 (distinct from the local-rider tracking
-- format JLO-XXXXXXXX, which has no dashes after JLO).

CREATE SEQUENCE IF NOT EXISTS public.waybill_number_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

CREATE OR REPLACE FUNCTION public.next_waybill_number()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'JLO-WB-' || lpad(nextval('public.waybill_number_seq')::text, 6, '0');
$$;

REVOKE ALL ON FUNCTION public.next_waybill_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_waybill_number() TO service_role;

ALTER TABLE public.sub_orders
  ADD COLUMN IF NOT EXISTS waybill_number text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_orders_waybill_number
  ON public.sub_orders (waybill_number)
  WHERE waybill_number IS NOT NULL;
