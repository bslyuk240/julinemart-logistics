-- Courier-owned hub/depot locations (Fez's own hubs today, extensible to any
-- other courier later) — a lightweight reference table distinct from `hubs`,
-- which represents locations JulineMart itself operates (dispatch queues,
-- staff, sub-hub hierarchy). A courier hub has none of that: it's just a
-- name + address a vendor is told to drop a parcel at, which the courier
-- runs entirely on their own.
CREATE TABLE IF NOT EXISTS public.courier_hubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id UUID NOT NULL REFERENCES public.couriers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courier_hubs_courier ON public.courier_hubs (courier_id);
CREATE INDEX IF NOT EXISTS idx_courier_hubs_active ON public.courier_hubs (is_active);

ALTER TABLE public.courier_hubs ENABLE ROW LEVEL SECURITY;
-- No policies — all access goes through service-role admin functions, same
-- pattern as gift_box_reviews / gift_packaging_types this session.

-- Let an approved vendor location point at a structured courier hub instead
-- of (or in addition to) the free-text fez_hub_name/fez_hub_address fields.
-- Existing rows keep working unmigrated: resolveSender.js and the public
-- vendor-locations endpoint prefer courier_hub_id when set, falling back to
-- the legacy free-text fields otherwise.
ALTER TABLE public.approved_vendor_locations
  ADD COLUMN IF NOT EXISTS courier_hub_id UUID REFERENCES public.courier_hubs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_approved_vendor_locations_courier_hub
  ON public.approved_vendor_locations (courier_hub_id);
