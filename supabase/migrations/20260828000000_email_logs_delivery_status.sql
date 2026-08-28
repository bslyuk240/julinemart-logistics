-- Track real delivery outcomes (not just "accepted by Resend") on email_logs,
-- fed by the Resend delivery webhook (netlify/functions/resend-webhook.js).

ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS resend_message_id text;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS delivery_updated_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_email_logs_resend_message_id
  ON email_logs(resend_message_id)
  WHERE resend_message_id IS NOT NULL;

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_status_check;
ALTER TABLE email_logs ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('sent', 'failed', 'delivered', 'bounced', 'complained', 'delayed'));

COMMENT ON COLUMN email_logs.status IS
  'sent/failed = accepted or rejected by the provider at send time. delivered/bounced/complained/delayed = later outcome reported by the Resend webhook.';
COMMENT ON COLUMN email_logs.resend_message_id IS 'Resend email id, used to match incoming webhook delivery events to this row.';
COMMENT ON COLUMN email_logs.delivery_updated_at IS 'When the webhook last updated this row''s status (distinct from sent_at, the original send time).';
