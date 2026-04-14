-- Customer product reviews (Supabase catalog). Moderation: pending → approved | rejected.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS average_rating numeric(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviews_allowed boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  woo_product_id integer,
  vendor_id uuid REFERENCES public.vendors (id) ON DELETE SET NULL,
  reviewer_name text NOT NULL,
  reviewer_email text NOT NULL,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  verified_purchase boolean NOT NULL DEFAULT false,
  woo_order_id integer,
  admin_note text
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON public.product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_vendor_id ON public.product_reviews (vendor_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_woo_product_id ON public.product_reviews (woo_product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_status ON public.product_reviews (status);
CREATE INDEX IF NOT EXISTS idx_product_reviews_created_at ON public.product_reviews (created_at DESC);

COMMENT ON TABLE public.product_reviews IS 'Storefront product ratings; approved rows contribute to products.rating_count / average_rating.';

CREATE OR REPLACE FUNCTION public.refresh_product_rating_stats (p_product_id uuid)
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
    COALESCE(ROUND(AVG(pr.rating::numeric), 2), 0)
  INTO cnt, avg_rating
  FROM public.product_reviews pr
  WHERE pr.product_id = p_product_id
    AND pr.status = 'approved';

  UPDATE public.products
  SET
    rating_count = cnt,
    average_rating = avg_rating
  WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_product_reviews_refresh_stats ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  IF tg_op = 'DELETE' THEN
    pid := OLD.product_id;
  ELSE
    pid := NEW.product_id;
  END IF;
  PERFORM public.refresh_product_rating_stats(pid);
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS product_reviews_refresh_stats ON public.product_reviews;
CREATE TRIGGER product_reviews_refresh_stats
  AFTER INSERT OR UPDATE OF status, rating OR DELETE
  ON public.product_reviews
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_product_reviews_refresh_stats();

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
