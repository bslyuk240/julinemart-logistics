 --Email Logs Table for tracking sent emails

CREATE TABLE IF NOT EXISTS email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  sent_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_order ON email_logs(order_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient, sent_at DESC);

COMMENT ON TABLE email_logs IS 'Tracks all emails sent to customers';
COMMENT ON COLUMN email_logs.status IS 'Email delivery status: sent or failed';

-- Add email preferences to orders table (optional)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean DEFAULT true;

COMMENT ON COLUMN orders.email_notifications_enabled IS 'Whether customer wants email notifications for this order';

SELECT 'Email logs table created successfully!' as status;
