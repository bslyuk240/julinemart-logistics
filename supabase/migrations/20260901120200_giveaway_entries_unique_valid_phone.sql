-- Closes a race: two near-simultaneous submissions from the same phone could
-- both pass the application-level duplicate check before either insert
-- completes, producing two 'valid' rows for one entrant. A partial unique
-- index makes the DB itself the source of truth for "already entered", not
-- just the read-then-write check in giveaway-submit-entry.js.
create unique index idx_giveaway_entries_unique_valid_phone
  on giveaway_entries(campaign_id, whatsapp_number)
  where status = 'valid';
