-- Record the REAL Paystack transaction reference on the order.
--
-- The PWA opens Paystack with a fresh reference (`<payment_reference>-R<TS>`) on
-- every attempt, so it never equals orders.payment_reference. Without this the
-- webhook cannot match a charge to its order and automatic refunds (cancel of a
-- paid order, admin refunds, returns) ask Paystack to refund a reference it has
-- never seen. verify-payment / the webhook now write it here; refunds read it.
alter table public.orders add column if not exists paystack_reference text;

create index if not exists idx_orders_paystack_reference
  on public.orders (paystack_reference) where paystack_reference is not null;
