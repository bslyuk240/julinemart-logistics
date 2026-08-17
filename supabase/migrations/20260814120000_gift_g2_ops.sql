-- Phase G2: Gift fulfilment ops — timeline events, QC, pack photo

ALTER TABLE public.gift_orders
  ADD COLUMN IF NOT EXISTS pack_photo_url text,
  ADD COLUMN IF NOT EXISTS qc_notes text,
  ADD COLUMN IF NOT EXISTS packed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.gift_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_order_id uuid NOT NULL REFERENCES public.gift_orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  actor_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_order_events_gift_order
  ON public.gift_order_events(gift_order_id, created_at);
