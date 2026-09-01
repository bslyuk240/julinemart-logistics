-- Giveaway/Campaign Engine Phase 2:
--   (a) customer-facing WhatsApp marketing opt-in + broadcast capability,
--       built on top of the EXISTING internal WhatsApp send primitive
--       (sendWhatsAppTemplate in internalWhatsapp.js) rather than a parallel
--       integration — that function is already contact-type-agnostic, it
--       just needed the enum widened.
--   (b) order-level campaign attribution, piggybacking on the voucher
--       redemption path that already exists at checkout.

-- (a) Widen the contact-type enum so a customer opt-in thread doesn't get
-- miscategorized as a vendor/lead ops contact. Must be its own statement/
-- migration — Postgres won't let a new enum value be used in the same
-- transaction that added it.
alter type internal_whatsapp_contact_type add value if not exists 'customer';
