DO $header$
BEGIN
  RAISE NOTICE '--- Running demo_users_setup migration ---';
END;
$header$;

-- demo_users_setup.sql
-- JULINEMART LOGISTICS ORCHESTRATOR
-- User Profile & Demo User Setup (Modern Supabase-Compatible)
-- ============================================================

-- Demo credentials (create these manually or via Admin API)
-- 1. admin@julinemart.com / admin123 (Admin)
-- 2. manager@julinemart.com / manager123 (Manager)
-- 3. viewer@julinemart.com / viewer123 (Viewer)

-- ============================================================
-- 1️⃣  AUTH SETUP INSTRUCTIONS
-- ============================================================
-- These users MUST be created manually via:
--   Supabase Dashboard → Authentication → Users → Add User
-- OR via the Supabase Admin API using:
--   supabase.auth.admin.createUser()

-- Example Node/TypeScript Admin Script:
-- ------------------------------------------------------------
-- import { createClient } from '@supabase/supabase-js'
-- const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
-- await supabase.auth.admin.createUser({
--   email: 'admin@julinemart.com',
--   password: 'admin123',
--   email_confirm: true,
--   user_metadata: { full_name: 'Admin User', role: 'admin' }
-- })
-- ------------------------------------------------------------

-- ============================================================
-- 2️⃣  AUTOMATIC PROFILE CREATION TRIGGER
-- ============================================================

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT ALL ON public.users TO authenticated;
--GRANT ALL ON public.activity_logs TO authenticated;

-- Function: Automatically insert profile when new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'viewer'),
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        is_active = true;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Link auth.users → public.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Verify
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

SELECT '✅ Trigger active: new Supabase users will auto-sync to public.users' AS status;

-- ============================================================
-- 3️⃣  DEMO USER SYNC (after manual creation)
-- ============================================================

-- Once demo users are created in Supabase Auth, run this section
-- It ensures their profiles exist and stay up to date

DO $$
DECLARE
  v_uid uuid;
BEGIN
  -- Admin
  SELECT id INTO v_uid FROM auth.users WHERE email = 'admin@julinemart.com';
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.users (id, email, full_name, role, is_active)
    VALUES (v_uid, 'admin@julinemart.com', 'Admin User', 'admin', true)
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true;
  END IF;

  -- Manager
  SELECT id INTO v_uid FROM auth.users WHERE email = 'manager@julinemart.com';
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.users (id, email, full_name, role, is_active)
    VALUES (v_uid, 'manager@julinemart.com', 'Manager User', 'manager', true)
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true;
  END IF;

  -- Viewer
  SELECT id INTO v_uid FROM auth.users WHERE email = 'viewer@julinemart.com';
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.users (id, email, full_name, role, is_active)
    VALUES (v_uid, 'viewer@julinemart.com', 'Viewer User', 'viewer', true)
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true;
  END IF;
END$$;

-- Summary
SELECT '✅ Demo users synced successfully' AS status,
  (SELECT COUNT(*) FROM public.users WHERE email IN (
    'admin@julinemart.com',
    'manager@julinemart.com',
    'viewer@julinemart.com'
  )) AS total_profiles;
