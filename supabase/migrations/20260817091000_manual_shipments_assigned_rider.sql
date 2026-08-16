alter table manual_shipments add column if not exists assigned_rider_id uuid references riders(id) on delete set null;
