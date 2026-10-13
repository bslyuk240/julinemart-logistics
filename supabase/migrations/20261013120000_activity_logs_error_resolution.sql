-- Lets admins mark CLIENT_ERROR rows as attended to, so the Errors tab can
-- default to only what still needs looking at. Only the activity-logs
-- function (service role) writes these, and only on CLIENT_ERROR rows.
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS resolution_note text;

CREATE INDEX IF NOT EXISTS activity_logs_unresolved_errors_idx
  ON public.activity_logs (created_at DESC)
  WHERE action = 'CLIENT_ERROR' AND resolved_at IS NULL;
