-- ============================================================
-- JulineMart Live Support Chat Migration
-- ============================================================

-- Enums
CREATE TYPE support_session_status AS ENUM ('open', 'assigned', 'closed');
CREATE TYPE support_session_mode   AS ENUM ('ai', 'human');
CREATE TYPE support_sender_type    AS ENUM ('customer', 'staff', 'ai');

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS support_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Customer identity (localStorage UUID for anon, or Supabase user_id for logged-in)
  customer_session_key  TEXT NOT NULL UNIQUE,
  customer_name         TEXT,
  customer_email        TEXT,
  customer_user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Chat lifecycle
  status                support_session_status DEFAULT 'open',
  mode                  support_session_mode   DEFAULT 'ai',

  -- Staff assignment
  assigned_staff_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_staff_name   TEXT,

  -- Summary for inbox list
  last_message_at       TIMESTAMP DEFAULT NOW(),
  last_message_preview  TEXT,
  unread_count          INTEGER   DEFAULT 0,

  -- Timestamps
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),
  closed_at             TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES support_sessions(id) ON DELETE CASCADE,
  sender_type  support_sender_type NOT NULL,
  sender_name  TEXT,
  content      TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- REALTIME — enable full row for UPDATE event filters
-- ============================================================
ALTER TABLE support_sessions REPLICA IDENTITY FULL;
ALTER TABLE support_messages REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE support_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE support_messages;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_support_sessions_key      ON support_sessions(customer_session_key);
CREATE INDEX idx_support_sessions_status   ON support_sessions(status, mode);
CREATE INDEX idx_support_sessions_last_msg ON support_sessions(last_message_at DESC);
CREATE INDEX idx_support_messages_session  ON support_messages(session_id, created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- Public SELECT (allows anonymous Realtime subscriptions; session IDs are UUIDs = unguessable)
CREATE POLICY "Support sessions: public read"
  ON support_sessions FOR SELECT USING (true);

CREATE POLICY "Support messages: public read"
  ON support_messages FOR SELECT USING (true);

-- Service role has full access (used by Next.js API routes)
CREATE POLICY "Support sessions: service role write"
  ON support_sessions FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Support messages: service role write"
  ON support_messages FOR ALL USING (auth.role() = 'service_role');

-- Authenticated staff can update sessions (join, close, reopen)
CREATE POLICY "Support sessions: staff update"
  ON support_sessions FOR UPDATE USING (
    auth.uid() IS NOT NULL AND
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_active = true)
  );

-- Authenticated staff can insert messages
CREATE POLICY "Support messages: staff insert"
  ON support_messages FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_active = true)
  );

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update updated_at on support_sessions
CREATE TRIGGER update_support_sessions_updated_at
  BEFORE UPDATE ON support_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update session summary whenever a message is inserted
CREATE OR REPLACE FUNCTION update_session_on_support_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE support_sessions
  SET
    last_message_at      = NEW.created_at,
    last_message_preview = LEFT(NEW.content, 120),
    unread_count         = CASE
                             WHEN NEW.sender_type = 'customer' THEN unread_count + 1
                             ELSE unread_count
                           END,
    updated_at           = NOW()
  WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_session_on_support_message
  AFTER INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION update_session_on_support_message();

-- ============================================================
-- EMAIL TEMPLATES — extend type CHECK to include support_chat
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_templates_type_check') THEN
    ALTER TABLE email_templates DROP CONSTRAINT email_templates_type_check;
  END IF;
END $$;

ALTER TABLE email_templates
ADD CONSTRAINT email_templates_type_check CHECK (type IN (
  'order_confirmation',
  'order_processing',
  'order_shipped',
  'out_for_delivery',
  'order_delivered',
  'order_cancelled',
  'influencer_report',
  'vendor_waitlist',
  'vendor_activation',
  'support_chat_staff_alert',
  'support_chat_customer_receipt'
));

INSERT INTO email_templates (name, type, subject, html_content, text_content, is_active) VALUES

-- 1. Staff alert: customer has requested a human agent
(
  'Support Chat - Staff Alert',
  'support_chat_staff_alert',
  'New support chat request from {{customer_name}}',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#77088a;padding:20px 24px;border-radius:12px 12px 0 0">
    <h2 style="color:#fff;margin:0;font-size:20px">New Support Chat Request</h2>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px">A customer is waiting for a human agent</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:120px">Customer</td><td style="padding:8px 0;font-weight:600">{{customer_name}}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Email</td><td style="padding:8px 0">{{customer_email}}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">First message</td><td style="padding:8px 0;font-style:italic;color:#374151">"{{first_message}}"</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Time</td><td style="padding:8px 0">{{requested_at}}</td></tr>
    </table>
    <a href="{{inbox_url}}" style="display:inline-block;background:#77088a;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">
      Open Support Inbox →
    </a>
    <p style="margin-top:20px;font-size:13px;color:#9ca3af">Log in to JulineMart staff portal to view and join the chat.</p>
  </div>
  </body></html>',
  'New Support Chat Request

Customer: {{customer_name}}
Email: {{customer_email}}
First message: "{{first_message}}"
Time: {{requested_at}}

Open inbox: {{inbox_url}}',
  true
),

-- 2. Customer receipt: we got your message
(
  'Support Chat - Customer Receipt',
  'support_chat_customer_receipt',
  'We received your message — JulineMart Support',
  '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#77088a;padding:20px 24px;border-radius:12px 12px 0 0">
    <h2 style="color:#fff;margin:0;font-size:20px">JulineMart Support</h2>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:14px">We have received your message</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">
    <p style="font-size:16px;margin-top:0">Hi {{customer_name}},</p>
    <p>Thank you for reaching out to JulineMart Support. We have received your message and our team will get back to you as soon as possible.</p>
    <div style="background:#f9fafb;border-left:4px solid #77088a;padding:12px 16px;border-radius:4px;margin:20px 0">
      <p style="margin:0;font-size:14px;color:#6b7280">Your message</p>
      <p style="margin:8px 0 0;font-style:italic;color:#374151">"{{first_message}}"</p>
    </div>
    <p style="color:#4b5563">We typically reply within a few hours during business hours. You can also continue the chat by visiting our website.</p>
    <p style="margin-top:24px;font-size:13px;color:#9ca3af">— The JulineMart Support Team</p>
    <p style="font-size:13px;color:#9ca3af">Questions? Reply to this email or contact us at <a href="mailto:{{support_email}}" style="color:#77088a">{{support_email}}</a></p>
  </div>
  </body></html>',
  'Hi {{customer_name}},

Thank you for reaching out to JulineMart Support. We received your message:

"{{first_message}}"

We typically reply within a few hours. You can continue the chat at our website.

— The JulineMart Support Team
{{support_email}}',
  true
)

ON CONFLICT (type) DO NOTHING;
