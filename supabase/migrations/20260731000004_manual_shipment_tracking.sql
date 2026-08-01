-- Manual shipment tracking parity with sub_orders

ALTER TABLE public.manual_shipments
  ADD COLUMN IF NOT EXISTS last_tracking_update timestamptz;

ALTER TABLE public.tracking_events
  ADD COLUMN IF NOT EXISTS manual_shipment_id uuid REFERENCES public.manual_shipments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tracking_events_manual_shipment
  ON public.tracking_events(manual_shipment_id);

CREATE INDEX IF NOT EXISTS idx_manual_shipments_last_tracking_update
  ON public.manual_shipments(last_tracking_update DESC);
