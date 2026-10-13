-- Security audit 2026-10-13: database-side fixes.
--
-- 1. get_storefront_customers() was SECURITY DEFINER and executable by anon,
--    so anyone with the public anon key could dump every customer's name,
--    email and phone. Now: staff session or service role only.
-- 2. rider_earnings_summary was a SECURITY DEFINER view granted to anon and
--    authenticated (every rider's earnings/balance). Only service-role
--    functions read it (rider-earnings.js, rider-withdrawals.js).
-- 3. product-images: any signed-in user (including storefront customers) could
--    upload, overwrite or delete any product image. Now: uploads by staff or
--    vendors; overwrite/delete by staff or the file's own uploader.
-- 4. rider-documents: the "public read" SELECT policy let anyone LIST the
--    bucket. Direct public links (delivery proofs sent to Skola) keep working
--    because the bucket stays public; listing no longer does.
-- 5. New private bucket rider-kyc for ID documents and selfies, readable only
--    by the rider who uploaded them and by staff (via signed URLs).

-- Helpers used by the policies below. SECURITY DEFINER so they can read
-- users/vendors regardless of those tables' RLS; they only ever answer
-- "is the caller staff / a vendor".
CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_active = true);
$$;

CREATE OR REPLACE FUNCTION public.is_vendor_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.vendors v WHERE v.user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_active_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_vendor_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_vendor_user() TO authenticated, service_role;

-- 1. Customer list: staff session (dashboard) or service role (broadcast-email).
CREATE OR REPLACE FUNCTION public.get_storefront_customers()
RETURNS TABLE(id uuid, email text, first_name text, last_name text, phone text, created_at timestamp with time zone)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.created_at
  FROM public.customers c
  WHERE (auth.role() = 'service_role' OR public.is_active_staff())
    AND c.id NOT IN (SELECT u.id FROM public.users u)
    AND c.id NOT IN (SELECT v.user_id FROM public.vendors v WHERE v.user_id IS NOT NULL)
  ORDER BY c.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_storefront_customers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_storefront_customers() TO authenticated, service_role;

-- 2. Rider earnings view: service role only.
ALTER VIEW public.rider_earnings_summary SET (security_invoker = true);
REVOKE ALL ON public.rider_earnings_summary FROM anon, authenticated;

-- 3. product-images write access.
DROP POLICY IF EXISTS "product-images authenticated upload" ON storage.objects;
DROP POLICY IF EXISTS "product-images authenticated update" ON storage.objects;
DROP POLICY IF EXISTS "product-images authenticated delete" ON storage.objects;

CREATE POLICY "product-images staff or vendor upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (public.is_active_staff() OR public.is_vendor_user()));

CREATE POLICY "product-images staff or owner update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND (public.is_active_staff() OR owner = auth.uid()))
  WITH CHECK (bucket_id = 'product-images' AND (public.is_active_staff() OR owner = auth.uid()));

CREATE POLICY "product-images staff or owner delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND (public.is_active_staff() OR owner = auth.uid()));

-- 4. Stop rider-documents being listable by anyone. Riders keep read access to
--    their own folder, which upload({ upsert: true }) needs.
DROP POLICY IF EXISTS "Rider documents public read" ON storage.objects;

CREATE POLICY "Riders read their own documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rider-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_active_staff()));

-- 5. Private KYC bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rider-kyc', 'rider-kyc', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY "rider-kyc rider upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rider-kyc' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "rider-kyc rider update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'rider-kyc' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'rider-kyc' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "rider-kyc rider or staff read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'rider-kyc' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_active_staff()));
