-- Phase 2: rider online/offline toggle, checked server-side before a rider
-- can see job offers (Home screen "go online" switch).
alter table riders add column if not exists is_online boolean not null default false;
alter table riders add column if not exists last_online_at timestamptz;
