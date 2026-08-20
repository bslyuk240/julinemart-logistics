-- Catch-up migration: these columns were applied directly to the live
-- database earlier this session (editable bank details + vehicle
-- pending-review changes) but never saved as a migration file, so the
-- schema history didn't reflect reality. All `if not exists` — purely
-- documentation, no live effect.
alter table riders add column if not exists bank_name text;
alter table riders add column if not exists bank_account_number text;
alter table riders add column if not exists bank_account_name text;
alter table riders add column if not exists pending_bank_name text;
alter table riders add column if not exists pending_bank_account_number text;
alter table riders add column if not exists pending_bank_account_name text;
alter table riders add column if not exists pending_bank_requested_at timestamptz;
alter table riders add column if not exists pending_vehicle_type text;
alter table riders add column if not exists pending_vehicle_plate text;
alter table riders add column if not exists pending_vehicle_requested_at timestamptz;
