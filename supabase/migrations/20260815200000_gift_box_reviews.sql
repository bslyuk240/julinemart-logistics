-- Gift box reviews — mirrors public.product_reviews for gift boxes.

ALTER TABLE public.gift_boxes
  ADD COLUMN IF NOT EXISTS average_rating numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.gift_box_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  gift_box_id uuid NOT NULL REFERENCES public.gift_boxes (id) ON DELETE CASCADE,
  reviewer_name text NOT NULL,
  reviewer_email text NOT NULL,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  verified_purchase boolean NOT NULL DEFAULT false,
  admin_note text
);

CREATE INDEX IF NOT EXISTS idx_gift_box_reviews_box_id ON public.gift_box_reviews (gift_box_id);
CREATE INDEX IF NOT EXISTS idx_gift_box_reviews_status ON public.gift_box_reviews (status);
CREATE INDEX IF NOT EXISTS idx_gift_box_reviews_created_at ON public.gift_box_reviews (created_at DESC);

COMMENT ON TABLE public.gift_box_reviews IS 'Storefront gift box ratings; approved rows contribute to gift_boxes.rating_count / average_rating.';

CREATE OR REPLACE FUNCTION public.refresh_gift_box_rating_stats (p_gift_box_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
  avg_rating numeric;
BEGIN
  SELECT
    COUNT(*)::int,
    COALESCE(ROUND(AVG(gbr.rating::numeric), 2), 0)
  INTO cnt, avg_rating
  FROM public.gift_box_reviews gbr
  WHERE gbr.gift_box_id = p_gift_box_id
    AND gbr.status = 'approved';

  UPDATE public.gift_boxes
  SET
    rating_count = cnt,
    average_rating = avg_rating
  WHERE id = p_gift_box_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_gift_box_reviews_refresh_stats ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bid uuid;
BEGIN
  IF tg_op = 'DELETE' THEN
    bid := OLD.gift_box_id;
  ELSE
    bid := NEW.gift_box_id;
  END IF;
  PERFORM public.refresh_gift_box_rating_stats(bid);
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS gift_box_reviews_refresh_stats ON public.gift_box_reviews;
CREATE TRIGGER gift_box_reviews_refresh_stats
  AFTER INSERT OR UPDATE OF status, rating OR DELETE
  ON public.gift_box_reviews
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_gift_box_reviews_refresh_stats();

-- RLS enabled, no policies — same posture as product_reviews: all access goes
-- through service-role server code (PWA API route + admin moderation function),
-- never direct client REST access.
ALTER TABLE public.gift_box_reviews ENABLE ROW LEVEL SECURITY;
