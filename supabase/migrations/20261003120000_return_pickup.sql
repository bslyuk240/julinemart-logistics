-- Return pickup: a customer can ask for the item to be collected from them
-- instead of dropping it off. Fez or a local rider does the pickup.
--
-- return_requests.pickup       where/when to collect: {name, phone, address, city,
--                              state, preferred_date, notes}
-- return_requests.pickup_fee   what the customer is charged for the pickup. 0 when
--                              the return is JulineMart's fault (damaged, wrong
--                              item, not as described); otherwise the quoted fee,
--                              which staff deduct from the refund.
-- return_requests.pickup_lane  'fez' | 'local_rider', set when staff approve it.
-- return_shipments.manual_shipment_id
--                              the local-rider pickup is a manual shipment from the
--                              customer to the hub; this links the two so the rider
--                              app's progress updates the return.
--
-- Safe to apply before or after the code ships: the code checks these columns
-- exist and hides pickup until they do.

alter table public.return_requests
  add column if not exists pickup jsonb,
  add column if not exists pickup_fee numeric(12, 2) not null default 0,
  add column if not exists pickup_lane text;

alter table public.return_shipments
  add column if not exists manual_shipment_id uuid references public.manual_shipments (id) on delete set null;

create index if not exists idx_return_shipments_manual_shipment
  on public.return_shipments (manual_shipment_id)
  where manual_shipment_id is not null;

comment on column public.return_requests.pickup_fee is
  'Pickup charge to the customer (0 if JulineMart is at fault). Staff deduct it from the refund.';
