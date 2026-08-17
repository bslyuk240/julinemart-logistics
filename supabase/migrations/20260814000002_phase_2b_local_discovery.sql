-- Phase 2B: local discovery (geolocation) + reserve & collect

ALTER TABLE public.approved_vendor_locations
  ADD COLUMN IF NOT EXISTS latitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10,7);

COMMENT ON COLUMN public.approved_vendor_locations.latitude IS 'Optional geocode for distance-based vendor discovery';
COMMENT ON COLUMN public.approved_vendor_locations.longitude IS 'Optional geocode for distance-based vendor discovery';

-- Extend fulfillment_method to include reservation (Phase 2A added delivery | store_pickup)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_fulfillment_method_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_fulfillment_method_check
  CHECK (fulfillment_method IN ('delivery', 'store_pickup', 'reservation'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS reservation_status text
    CHECK (reservation_status IS NULL OR reservation_status IN (
      'reserved', 'ready', 'collected', 'expired', 'cancelled'
    )),
  ADD COLUMN IF NOT EXISTS reserved_until timestamptz,
  ADD COLUMN IF NOT EXISTS reservation_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS reservation_collected_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_reservation_status
  ON public.orders(reservation_status)
  WHERE reservation_status IS NOT NULL;

COMMENT ON COLUMN public.orders.reservation_status IS 'Reserve & collect lifecycle: reserved → ready → collected';
