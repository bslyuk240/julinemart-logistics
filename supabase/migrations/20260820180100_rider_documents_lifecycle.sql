-- Documents lifecycle (rider-app-ux-rebuild.md #17): today `riders` has
-- three bare URL columns (id_document_url, selfie_url,
-- vehicle_document_url) with no per-document status, dates, or review
-- history — review is one blanket approve/reject for the whole
-- application. This table adds real per-document tracking without
-- touching those existing columns (still read by the current approve
-- flow) — additive, same pattern as the shipments unification table.
--
-- One row per *submission* (not one mutable slot per type) — a rejected
-- or expired document gets a new row on resubmission, giving a real
-- history instead of overwriting it. "The current document" for a type is
-- the most recent row.
--
-- Selfie is deliberately excluded from expiry tracking — it's a liveness
-- check re-captured periodically via Home.tsx's 24h check-in flow, not a
-- KYC document with a printed expiry date like the ID or vehicle papers.
create table rider_documents (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references riders(id) on delete cascade,
  type text not null check (type in ('id', 'selfie', 'vehicle')),
  file_url text not null,
  issue_date date,
  expiry_date date,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by uuid references users(id),
  rejection_reason text,
  -- Set the first time an expiry-reminder push goes out for this
  -- document, so the scheduled check (#17's "expiry notifications")
  -- doesn't re-notify the rider every day it stays within the window.
  expiry_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rider_documents_rider_id_idx on rider_documents(rider_id);
create index rider_documents_expiry_idx on rider_documents(expiry_date) where expiry_date is not null;

create trigger update_rider_documents_updated_at
  before update on rider_documents
  for each row execute function set_updated_at();

-- Backfill existing riders' current documents so the new admin/rider
-- views aren't empty for anyone already in the system. Active riders'
-- documents are marked verified (they already passed the old blanket
-- review); everyone else's stay pending.
insert into rider_documents (rider_id, type, file_url, status, verified_at, verified_by)
select id, 'id', id_document_url,
  case when status = 'active' then 'verified' else 'pending' end,
  case when status = 'active' then approved_at end,
  case when status = 'active' then approved_by end
from riders where id_document_url is not null;

insert into rider_documents (rider_id, type, file_url, status, verified_at, verified_by)
select id, 'selfie', selfie_url,
  case when status = 'active' then 'verified' else 'pending' end,
  case when status = 'active' then approved_at end,
  case when status = 'active' then approved_by end
from riders where selfie_url is not null;

insert into rider_documents (rider_id, type, file_url, status, verified_at, verified_by)
select id, 'vehicle', vehicle_document_url,
  case when status = 'active' then 'verified' else 'pending' end,
  case when status = 'active' then approved_at end,
  case when status = 'active' then approved_by end
from riders where vehicle_document_url is not null;
