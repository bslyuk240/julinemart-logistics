-- Add source tracking to activity_logs so PWA storefront and vendor portal
-- events can be distinguished from JLO staff actions.
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'jlo',
  ADD COLUMN IF NOT EXISTS actor_email TEXT;

-- Allow authenticated users (PWA / vendor portal) to insert their own rows.
-- The log-activity Netlify function verifies the JWT then inserts on behalf of
-- the caller — user_id must match auth.uid().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'activity_logs'
      AND policyname = 'authenticated users can insert own activity'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "authenticated users can insert own activity"
      ON public.activity_logs FOR INSERT
      WITH CHECK (auth.uid() = user_id);
    $p$;
  END IF;
END $$;
