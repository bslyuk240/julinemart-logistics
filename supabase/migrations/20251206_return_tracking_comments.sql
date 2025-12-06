-- Add tracking submission columns (idempotent) and comments
alter table if exists public.return_shipments
  add column if not exists customer_submitted_tracking boolean default false,
  add column if not exists tracking_submitted_at timestamptz;

comment on column public.return_shipments.customer_submitted_tracking is 'True if customer provided tracking number, false if admin/system generated';
comment on column public.return_shipments.tracking_submitted_at is 'When the tracking number was added to the system';

-- Ensure status supports the required values
do $$
begin
  -- Drop existing status check if present
  if exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema = 'public'
      and table_name = 'return_shipments'
      and column_name = 'status'
      and constraint_name = 'return_shipments_status_check'
  ) then
    alter table public.return_shipments
      drop constraint return_shipments_status_check;
  end if;

  -- Create a new check constraint for allowed statuses
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'return_shipments_status_check_new'
      and constraint_schema = 'public'
  ) then
    alter table public.return_shipments
      add constraint return_shipments_status_check_new
      check (status in (
        'awaiting_tracking',
        'in_transit',
        'delivered_to_hub',
        'inspection_in_progress',
        'approved',
        'rejected',
        'pickup_scheduled',
        'awaiting_dropoff',
        'pending',
        'delivered',
        'completed'
      ));
  end if;
end$$;
