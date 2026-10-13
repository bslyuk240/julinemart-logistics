-- Security audit 2026-10-13, round 2.

-- 1. Private buckets. Files are served as short-lived signed URLs by the
--    functions that list them (netlify/functions/services/privateStorage.js).
UPDATE storage.buckets SET public = false WHERE id IN ('admin-documents', 'return-images');

-- Vendor applicants' ID/CAC documents. Applicants upload through one-time
-- signed upload URLs from vendor-kyc-upload-url; no client policies, so only
-- the service role can read or write here.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vendor-kyc', 'vendor-kyc', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false;

-- 2. vendor-documents (stays public: storefront vendor logos/banners and Meta
--    ad media must load by URL). Any signed-in user, including storefront
--    customers, could upload/overwrite branding and Meta ad files. Branding is
--    uploaded server-side by vendor-branding-upload.js; Meta ad media only by
--    staff from the dashboard.
DROP POLICY IF EXISTS "Authenticated insert vendor branding" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update vendor branding" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated insert meta-ads-temp" ON storage.objects;

CREATE POLICY "Staff insert meta-ads-temp" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-documents' AND name LIKE 'meta-ads-temp/%' AND public.is_active_staff());

-- 3. SECURITY DEFINER functions that anyone (or any signed-in user) could call
--    over the REST API. All callers are service-role functions or triggers;
--    trigger functions don't need EXECUTE to fire.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.increment_giveaway_broadcast_counts(uuid, integer, integer)',
    'public.next_waybill_number()',
    'public.log_finance_access(text, text, jsonb)',
    'public.user_has_role(uuid, text)',
    'public.refresh_product_rating_stats(uuid)',
    'public.refresh_gift_box_rating_stats(uuid)',
    'public.fn_sync_product_rating()',
    'public.handle_new_customer()',
    'public.handle_new_user()',
    'public.log_activity()',
    'public.log_card_added()',
    'public.log_password_changed()',
    'public.log_return_requested()',
    'public.trg_gift_box_reviews_refresh_stats()',
    'public.trg_product_reviews_refresh_stats()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- Giveaway draws check admin/manager inside; they never need anon.
REVOKE EXECUTE ON FUNCTION public.draw_giveaway_winner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.forfeit_and_redraw_giveaway_winner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draw_giveaway_winner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.forfeit_and_redraw_giveaway_winner(uuid, text) TO authenticated, service_role;

-- 4. Pin search_path on every public function that didn't set one (Supabase
--    lint 0011), matching the default path these already resolved against.
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', f);
  END LOOP;
END $$;
