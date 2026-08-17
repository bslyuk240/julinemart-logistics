-- Phase 3: Seller growth — vendor-owned campaigns, quality ranking, seller video

-- ── Vendor-owned campaigns ───────────────────────────────────────────────────
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS approval_status text CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS review_notes text;

CREATE INDEX IF NOT EXISTS idx_campaigns_vendor_id
  ON public.campaigns(vendor_id) WHERE vendor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_vendor_approval
  ON public.campaigns(approval_status)
  WHERE vendor_id IS NOT NULL;

COMMENT ON COLUMN public.campaigns.vendor_id IS 'Seller-owned campaign; requires approval_status=approved for public storefront display';
COMMENT ON COLUMN public.campaigns.approval_status IS 'Null for JulineMart admin campaigns; draft→pending→approved/rejected for vendor campaigns';

-- ── Seller quality ranking ───────────────────────────────────────────────────
ALTER TABLE public.seller_performance_snapshots
  ADD COLUMN IF NOT EXISTS seller_quality_score numeric(5,2);

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS seller_quality_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS intro_video_url text;

COMMENT ON COLUMN public.seller_performance_snapshots.seller_quality_score IS 'Composite 0–100 score for discovery ranking';
COMMENT ON COLUMN public.vendors.seller_quality_score IS 'Denormalized copy of latest seller_quality_score for fast catalog sort';
COMMENT ON COLUMN public.vendors.intro_video_url IS 'Optional Meet the seller intro video (YouTube or direct URL)';
