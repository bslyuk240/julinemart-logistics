- Fix recursive RLS policies on users and related references
-- This version adds safety checks to ensure the users table exists before applying changes

DO $$
BEGIN
  -- Check if the users table exists before proceeding
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'users'
  ) THEN
    RAISE NOTICE '✅ public.users table found. Applying RLS fixes...';

    -- Helper: check if a user has a required role
    CREATE OR REPLACE FUNCTION public.user_has_role(uid uuid, required_role text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $inner$
    DECLARE
      r text;
    BEGIN
      SELECT role INTO r FROM public.users WHERE id = uid LIMIT 1;
      RETURN r = required_role;
    END;
    $inner$;

    -- Permissions to call from PostgREST roles
    GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, text) TO anon, authenticated, service_role;

    -- Recreate RLS policies to avoid recursive self-selects on users
    DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
    DROP POLICY IF EXISTS "Admins can insert users" ON public.users;
    DROP POLICY IF EXISTS "Admins can update users" ON public.users;

    -- New non-recursive policies using the helper
    CREATE POLICY "Admins can view all users" ON public.users
      FOR SELECT USING (public.user_has_role(auth.uid(), 'admin'));

    CREATE POLICY "Admins can insert users" ON public.users
      FOR INSERT WITH CHECK (public.user_has_role(auth.uid(), 'admin'));

    CREATE POLICY "Admins can update users" ON public.users
      FOR UPDATE USING (public.user_has_role(auth.uid(), 'admin'));

    -- Update activity_logs policy only if the table exists
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'activity_logs'
    ) THEN
      DROP POLICY IF EXISTS "Users can view activity logs" ON public.activity_logs;
      CREATE POLICY "Users can view activity logs" ON public.activity_logs
        FOR SELECT USING (
          auth.uid() = user_id OR
          public.user_has_role(auth.uid(), 'admin') OR
          public.user_has_role(auth.uid(), 'manager')
        );
    END IF;

  ELSE
    RAISE NOTICE '⚠️ public.users table not found. Skipping RLS fixes.';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Summary output
SELECT 'RLS fix script executed with safety checks' AS status;
