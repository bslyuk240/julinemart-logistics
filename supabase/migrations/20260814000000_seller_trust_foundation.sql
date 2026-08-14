-- Phase 1: Trusted Local Commerce — seller trust + structured disputes
-- seller_verifications, seller_performance_snapshots, return_requests extensions,
-- approved_vendor_locations public profile fields

-- ── Seller verifications ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seller_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  verification_type text NOT NULL CHECK (verification_type IN (
    'identity', 'phone', 'bank_account', 'business_registration',
    'physical_store', 'trusted_seller', 'julinemart_assured'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by uuid REFERENCES public.users(id),
  verified_at timestamptz,
  expires_at timestamptz,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, verification_type)
);

CREATE INDEX IF NOT EXISTS idx_seller_verifications_vendor
  ON public.seller_verifications(vendor_id);
CREATE INDEX IF NOT EXISTS idx_seller_verifications_status
  ON public.seller_verifications(status);

DROP TRIGGER IF EXISTS trg_seller_verifications_updated_at ON public.seller_verifications;
CREATE TRIGGER trg_seller_verifications_updated_at
  BEFORE UPDATE ON public.seller_verifications
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ── Seller performance snapshots ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seller_performance_snapshots (
  vendor_id uuid PRIMARY KEY REFERENCES public.vendors(id) ON DELETE CASCADE,
  successful_orders int NOT NULL DEFAULT 0,
  fulfilment_rate numeric(5,2),
  product_accuracy numeric(5,2),
  on_time_dispatch numeric(5,2),
  response_rate numeric(5,2),
  avg_response_minutes int,
  dispute_rate numeric(5,2),
  repeat_customer_rate numeric(5,2),
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- ── Structured disputes (extend returns) ─────────────────────────────────────
ALTER TABLE public.return_requests
  ADD COLUMN IF NOT EXISTS complaint_type text CHECK (complaint_type IN (
    'not_received', 'wrong_product', 'damaged', 'not_as_described',
    'missing_items', 'suspected_counterfeit', 'other'
  )),
  ADD COLUMN IF NOT EXISTS evidence_urls jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS seller_response text,
  ADD COLUMN IF NOT EXISTS seller_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_timeline jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS refund_initiated_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_expected_by timestamptz;

-- ── Physical store public profile ────────────────────────────────────────────
ALTER TABLE public.approved_vendor_locations
  ADD COLUMN IF NOT EXISTS public_area text,
  ADD COLUMN IF NOT EXISTS store_photos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS opening_hours jsonb,
  ADD COLUMN IF NOT EXISTS supports_customer_pickup boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_instructions text;

COMMENT ON TABLE public.seller_verifications IS 'Per-type seller trust verification records for JulineMart Trusted Local Commerce';
COMMENT ON TABLE public.seller_performance_snapshots IS 'Nightly rollup of seller performance metrics for storefront display and ranking';
