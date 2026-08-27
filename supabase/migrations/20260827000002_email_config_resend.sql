-- Resend as a first-class email provider. Templates stay in email_templates;
-- Resend is the delivery backend (API + batch), not a second template store.

ALTER TABLE email_config DROP CONSTRAINT IF EXISTS email_config_provider_check;
ALTER TABLE email_config ADD CONSTRAINT email_config_provider_check
  CHECK (provider = ANY (ARRAY['gmail', 'sendgrid', 'smtp', 'resend']));

ALTER TABLE email_config ADD COLUMN IF NOT EXISTS resend_api_key text;

COMMENT ON COLUMN email_config.resend_api_key IS 'Encrypted Resend API key (re_…). When set, operational mail (orders, vendor activation, bulk) is delivered via Resend. Auth mail stays on Supabase Custom SMTP.';
