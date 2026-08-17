-- Phase G5: Gift delivery scheduling — requested delivery + occasion dates

ALTER TABLE public.gift_orders
  ADD COLUMN IF NOT EXISTS requested_delivery_date date,
  ADD COLUMN IF NOT EXISTS occasion_date date;

COMMENT ON COLUMN public.gift_orders.requested_delivery_date IS
  'Customer-requested delivery date — validated server-side against hub lead times and cutoffs';

COMMENT ON COLUMN public.gift_orders.occasion_date IS
  'Optional occasion date (birthday, anniversary) for ops scheduling context';

-- Builder sessions may carry draft dates before checkout
ALTER TABLE public.gift_builder_sessions
  ADD COLUMN IF NOT EXISTS requested_delivery_date date,
  ADD COLUMN IF NOT EXISTS occasion_date date;
