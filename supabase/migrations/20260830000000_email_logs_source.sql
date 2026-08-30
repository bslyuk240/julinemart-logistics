-- Records who/what triggered each send, so a campaign sent through the
-- external service API (e.g. Skola Workforce hitting
-- /api/v1/notifications/email/bulk) can be told apart from one sent through
-- the admin dashboard's broadcast tool, without having to guess from the
-- subject line and timestamps after the fact.

ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN email_logs.source IS
  'Who triggered this send: a service_api_keys.name for external API callers (notifications.email.send / send_bulk), "admin:<email>" for the dashboard broadcast tool, or null for other internal callers.';
