-- Extend is_jlo_staff_auth_creation to also skip vendor portal invites.
-- vendor-approve.js sets app_metadata.signup_source = 'vendor_portal' after inviteUserByEmail,
-- so the auth→customers trigger no longer creates a customer row for approved vendors.
CREATE OR REPLACE FUNCTION public.is_jlo_staff_auth_creation(app_meta jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((app_meta ->> 'jlo_staff')::boolean, false)
    OR COALESCE(app_meta ->> 'signup_source', '') = 'jlo'
    OR COALESCE(app_meta ->> 'signup_source', '') = 'vendor_portal';
$$;

COMMENT ON FUNCTION public.is_jlo_staff_auth_creation(jsonb) IS
  'True when the user was created from JLO (Admin API) or vendor portal invite. Used in auth→customers trigger to skip non-customer accounts.';
