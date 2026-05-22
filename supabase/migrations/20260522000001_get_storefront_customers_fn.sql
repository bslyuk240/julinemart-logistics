-- Returns only real storefront customers, excluding JLO staff and vendor accounts.
-- SECURITY DEFINER bypasses RLS so the cross-table joins work from the frontend.
CREATE OR REPLACE FUNCTION public.get_storefront_customers()
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.created_at
  FROM public.customers c
  WHERE c.id NOT IN (SELECT u.id FROM public.users u)
    AND c.id NOT IN (SELECT v.user_id FROM public.vendors v WHERE v.user_id IS NOT NULL)
  ORDER BY c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_storefront_customers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_customers() TO authenticated;
