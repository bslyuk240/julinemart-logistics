-- Queue for push notifications scheduled to send in the future.
CREATE TABLE IF NOT EXISTS scheduled_push_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  schedule_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'partial', 'failed')),
  payload jsonb NOT NULL,
  result jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_push_pending
  ON scheduled_push_notifications (schedule_at)
  WHERE status = 'pending';

ALTER TABLE scheduled_push_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read scheduled push notifications"
  ON scheduled_push_notifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'admin' AND u.is_active = true
    )
  );

COMMENT ON TABLE scheduled_push_notifications IS
  'Push notification jobs deferred until schedule_at; processed by Netlify scheduled function.';
