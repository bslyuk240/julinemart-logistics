-- Add tracking submission columns and status values for return shipments
alter table if exists public.return_shipments
  add column if not exists customer_submitted_tracking boolean default false,
  add column if not exists tracking_submitted_at timestamptz;

-- Status values are stored as text; ensure downstream code can use new values:
-- awaiting_tracking, in_transit, delivered_to_hub
