-- Extend the waybill numbering feature to return pickup shipments.
-- Reuses the courier-agnostic next_waybill_number() RPC from
-- 20260731000001_add_waybill_numbering.sql — no new sequence needed.

ALTER TABLE public.return_shipments
  ADD COLUMN IF NOT EXISTS waybill_number text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_return_shipments_waybill_number
  ON public.return_shipments (waybill_number)
  WHERE waybill_number IS NOT NULL;
