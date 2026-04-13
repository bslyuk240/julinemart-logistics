-- JLO creates staff via auth.admin.createUser with app_metadata.jlo_staff = true (see netlify/functions/users.js).
-- If a project trigger inserts into public.customers on EVERY auth.users INSERT, staff wrongly get a customer row.
-- Use this helper at the start of that trigger function:
--
--   IF public.is_jlo_staff_auth_creation(NEW.raw_app_meta_data) THEN
--     RETURN NEW;
--   END IF;
--
-- Only the Admin API can set app_metadata; storefront signups cannot spoof jlo_staff.

CREATE OR REPLACE FUNCTION public.is_jlo_staff_auth_creation(app_meta jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((app_meta ->> 'jlo_staff')::boolean, false)
    OR COALESCE(app_meta ->> 'signup_source', '') = 'jlo';
$$;

COMMENT ON FUNCTION public.is_jlo_staff_auth_creation(jsonb) IS
  'True when the user was created from JLO (Admin API). Use in auth→customers triggers to skip inserting staff into public.customers.';
