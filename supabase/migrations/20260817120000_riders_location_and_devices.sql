-- Phase 3: scoped location tracking (last-known position only, updated by
-- rider-location-ping.js — enforced server-side to require an active,
-- accepted assignment) and a lightweight known-device list for flagging
-- logins from a device the rider hasn't used before.
alter table riders add column if not exists last_lat double precision;
alter table riders add column if not exists last_lng double precision;
alter table riders add column if not exists last_location_at timestamptz;
alter table riders add column if not exists known_device_ids jsonb not null default '[]'::jsonb;
