-- Riders — external delivery riders, kept separate from `users` (internal
-- staff roles) the same way `vendors` is. Linked to Supabase Auth via
-- `user_id`, not by matching `id` directly — mirrors vendors.user_id, the
-- proven pattern already used by vendorAuth.js.
CREATE TABLE IF NOT EXISTS public.riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Identity (Phase 1 KYC)
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    nin TEXT,
    id_document_url TEXT,

    -- Liveness (Phase 1 onboarding selfie, Phase 3 daily re-check)
    selfie_url TEXT,
    selfie_captured_at TIMESTAMPTZ,

    -- Vehicle
    vehicle_type TEXT CHECK (vehicle_type IN ('okada', 'keke', 'car', 'foot')),
    vehicle_plate TEXT,
    vehicle_document_url TEXT,

    -- Guarantor
    guarantor_name TEXT,
    guarantor_phone TEXT,

    -- Coverage — same location taxonomy vendors and customer local-rider
    -- eligibility already resolve through.
    approved_location_id UUID REFERENCES public.approved_vendor_locations(id),

    -- Review
    status TEXT NOT NULL DEFAULT 'pending_review'
      CHECK (status IN ('pending_review', 'active', 'suspended', 'rejected')),
    reject_reason TEXT,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES public.users(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_riders_user_id ON public.riders (user_id);
CREATE INDEX IF NOT EXISTS idx_riders_status ON public.riders (status);
CREATE INDEX IF NOT EXISTS idx_riders_approved_location ON public.riders (approved_location_id);

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
-- No policies — all access goes through service-role admin/rider functions,
-- same pattern as gift_box_reviews / gift_packaging_types / courier_hubs.

-- Sub-orders gain a real rider assignment, replacing the free-text
-- rider_name/rider_phone previously typed into metadata by staff.
ALTER TABLE public.sub_orders
  ADD COLUMN IF NOT EXISTS assigned_rider_id UUID REFERENCES public.riders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sub_orders_assigned_rider ON public.sub_orders (assigned_rider_id);
