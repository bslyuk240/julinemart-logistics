-- Align public.users.role CHECK with roles used by the dashboard and Netlify functions
-- (shop_manager, agent, vendor). The original constraint only allowed admin/manager/viewer,
-- which caused handle_new_user to fail for new staff roles — auth user existed but no profile row.

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT IF EXISTS %I', con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check CHECK (
    role IN (
      'admin',
      'manager',
      'viewer',
      'agent',
      'shop_manager',
      'vendor'
    )
  );
