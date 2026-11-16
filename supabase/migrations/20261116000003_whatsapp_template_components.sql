-- Store Meta's real template definition (HEADER / BODY / BUTTONS components) as
-- returned by the Graph API during sync, so we can see what a template requires
-- (image header, variable count, buttons) instead of guessing from body text.
alter table public.internal_whatsapp_templates
  add column if not exists meta_components jsonb;
