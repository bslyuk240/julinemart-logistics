-- The entry-form opt-in checkbox previously said "...on WhatsApp" specifically
-- — that consent was WhatsApp-scoped. Since agents can now also trigger a
-- marketing send to these leads by email (see capabilityCatalog.js's new
-- marketing.leads.send_whatsapp/send_email), the checkbox copy is being
-- widened to honestly cover both channels (PWA-side change, same PR), and
-- storage needs to actually hold the email address to match — reusing this
-- table rather than a parallel one, since it's the same consent event for
-- the same person, just now recorded for both channels they might be
-- contacted on.
alter table whatsapp_marketing_consent add column email text;
comment on table whatsapp_marketing_consent is 'Cross-campaign marketing opt-in list (WhatsApp + email), fed by the "send me deals and Secret Drop alerts" checkbox on giveaway entries. Upserted by phone; email is recorded when the entrant also gave one, which is now always (email became required on entry).';
