-- Drop the FK constraint that references public.users (vendors/customers aren't there)
ALTER TABLE public.activity_logs
  DROP CONSTRAINT IF EXISTS activity_logs_user_id_fkey;

-- Re-add FK referencing auth.users so any authenticated user can insert their own ID
ALTER TABLE public.activity_logs
  ADD CONSTRAINT activity_logs_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

-- Update RLS INSERT policy to allow auth.uid() = user_id (for all auth users)
DROP POLICY IF EXISTS "authenticated users can insert own activity" ON public.activity_logs;

CREATE POLICY "authenticated users can insert own activity"
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
