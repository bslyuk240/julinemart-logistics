-- Internal WhatsApp outreach: Sales Rep / Ops Manager agents messaging
-- vendors and leads. Deliberately separate from the whatsapp_* tables
-- (20251222213930_create_whatsapp_support.sql.sql) — those are the
-- customer-support inbox, now replaced by support_sessions/support_messages,
-- and are wired to orders (auto-link-order trigger, order-status templates)
-- in ways that don't apply here. This is agent-driven, not a public-facing
-- customer care number, and not exposed as a JLO admin inbox.

CREATE TYPE internal_whatsapp_contact_type AS ENUM ('vendor', 'lead');
CREATE TYPE internal_whatsapp_thread_status AS ENUM ('open', 'closed');
CREATE TYPE internal_whatsapp_message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE internal_whatsapp_message_type AS ENUM ('text', 'template', 'image', 'document');
CREATE TYPE internal_whatsapp_message_status AS ENUM ('sent', 'delivered', 'read', 'failed');

CREATE TABLE IF NOT EXISTS internal_whatsapp_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_phone text NOT NULL,
  contact_name text,
  contact_type internal_whatsapp_contact_type NOT NULL,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  status internal_whatsapp_thread_status NOT NULL DEFAULT 'open',
  last_message_at timestamptz,
  last_message_preview text,
  -- WhatsApp's 24h customer-service window: freeform replies are only
  -- allowed until this expires; after that, a template is required again.
  service_window_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_whatsapp_threads_phone_unique UNIQUE (contact_phone)
);

CREATE TABLE IF NOT EXISTS internal_whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES internal_whatsapp_threads(id) ON DELETE CASCADE,
  direction internal_whatsapp_message_direction NOT NULL,
  message_type internal_whatsapp_message_type NOT NULL DEFAULT 'text',
  content text,
  template_name text,
  media_url text,
  meta_message_id text UNIQUE,
  status internal_whatsapp_message_status NOT NULL DEFAULT 'sent',
  -- Which agent sent this (denormalized name/type — skola-workforce is a
  -- separate database, no real FK is possible across them).
  sent_by_agent text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz
);

CREATE TABLE IF NOT EXISTS internal_whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL, -- 'MARKETING' | 'UTILITY'
  language text NOT NULL DEFAULT 'en',
  template_content text NOT NULL,
  meta_template_status text NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'REJECTED'
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_whatsapp_templates_name_unique UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS internal_whatsapp_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_internal_wa_threads_phone ON internal_whatsapp_threads(contact_phone);
CREATE INDEX IF NOT EXISTS idx_internal_wa_threads_type ON internal_whatsapp_threads(contact_type);
CREATE INDEX IF NOT EXISTS idx_internal_wa_threads_vendor ON internal_whatsapp_threads(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_internal_wa_messages_thread ON internal_whatsapp_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_wa_messages_meta_id ON internal_whatsapp_messages(meta_message_id) WHERE meta_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_internal_wa_templates_active ON internal_whatsapp_templates(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_internal_wa_webhook_processed ON internal_whatsapp_webhook_events(processed);

CREATE OR REPLACE FUNCTION update_internal_whatsapp_thread_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE internal_whatsapp_threads
  SET
    last_message_at = NEW.created_at,
    last_message_preview = SUBSTRING(COALESCE(NEW.content, NEW.template_name, ''), 1, 100),
    service_window_expires_at = CASE
      WHEN NEW.direction = 'inbound' THEN NEW.created_at + INTERVAL '24 hours'
      ELSE service_window_expires_at
    END,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_internal_wa_thread_on_message
  AFTER INSERT ON internal_whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_internal_whatsapp_thread_on_message();

-- RLS on, no permissive policies: this is driven entirely by JLO's service
-- role (Netlify functions), not a staff dashboard or public-facing surface.
ALTER TABLE internal_whatsapp_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;

-- Draft templates — content only, not yet submitted to Meta for approval.
-- meta_template_status stays 'PENDING' until that's done through WhatsApp
-- Manager once the new phone number is registered.
INSERT INTO internal_whatsapp_templates (name, category, language, template_content) VALUES
  ('vendor_weekly_update', 'MARKETING', 'en', 'Hi {{1}}, here''s this week''s JulineMart vendor update: {{2}}. Questions? Just reply here.'),
  ('vendor_onboarding_followup', 'UTILITY', 'en', 'Hi {{1}}, following up on your JulineMart vendor application ({{2}}). {{3}}'),
  ('lead_intro', 'MARKETING', 'en', 'Hi {{1}}, this is {{2}} from JulineMart. {{3}} Reply here anytime.')
ON CONFLICT (name) DO NOTHING;
