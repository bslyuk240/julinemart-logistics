-- Allow authenticated users to create and manage their own profile
-- without requiring admin role. Keeps admin policies intact.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    -- Insert own profile
    DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
    CREATE POLICY "Users can insert own profile" ON public.users
      FOR INSERT
      WITH CHECK (auth.uid() = id);

    -- Update own profile
    DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
    CREATE POLICY "Users can update own profile" ON public.users
      FOR UPDATE
      USING (auth.uid() = id);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Summary
SELECT 'Self-profile policies applied' AS status;

