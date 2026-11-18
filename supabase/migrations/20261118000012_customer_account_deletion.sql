-- Customer self-service account deletion.
--
--  * account_deletion_requests : one row per request; the emailed token is stored
--    only as a hash. No FK to auth.users so the record outlives the account.
--  * account_deletion_blockers(user) : why an account can't be deleted yet
--    (orders still being delivered, returns/refunds in progress, non-customer
--    accounts such as staff/vendors/riders/influencers).
--  * delete_customer_account(user) : closes the points balance with a
--    compensating ledger entry (the ledger stays append-only), voids pending
--    awards, anonymises the personal data that must be kept (orders, returns,
--    reviews, giveaway entries, logs), removes the rest, then deletes the
--    customer rows. The caller deletes the auth user afterwards.
--  * two email templates (confirmation link, final notice).

-- 1. Requests --------------------------------------------------------------
create table if not exists public.account_deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  email         text,                       -- cleared once the request is finished
  token_hash    text not null unique,
  status        text not null default 'pending'
                  check (status in ('pending', 'completed', 'cancelled', 'expired', 'failed')),
  requested_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  completed_at  timestamptz,
  summary       jsonb
);
create index if not exists idx_account_deletion_requests_user
  on public.account_deletion_requests (user_id, status);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;

-- 2. Eligibility -----------------------------------------------------------
create or replace function public.account_deletion_blockers(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_email   text;
  reasons   jsonb := '[]'::jsonb;
  n         integer;
begin
  select lower(email) into v_email from auth.users where id = p_user;
  if v_email is null then
    return jsonb_build_object('eligible', false, 'reasons',
      jsonb_build_array(jsonb_build_object('code', 'not_found', 'message', 'Account not found.')));
  end if;

  if not public.rewards_is_storefront_customer(p_user)
     or exists (select 1 from public.influencers i where i.user_id = p_user)
     or exists (select 1 from public.riders r where r.user_id = p_user) then
    reasons := reasons || jsonb_build_array(jsonb_build_object(
      'code', 'not_customer_account',
      'message', 'This account has extra access (staff, vendor, rider or influencer). Please contact support to close it.'));
  end if;

  select count(*) into n from public.orders o
   where (o.customer_id = p_user or lower(o.customer_email) = v_email)
     and o.payment_status = 'paid'
     and coalesce(o.overall_status::text, 'pending') not in ('delivered', 'cancelled', 'refunded');
  if n > 0 then
    reasons := reasons || jsonb_build_array(jsonb_build_object(
      'code', 'open_orders', 'count', n,
      'message', format('You have %s order(s) still on the way. You can delete your account once they are delivered.', n)));
  end if;

  select count(*) into n from public.return_requests rr
   where lower(rr.customer_email) = v_email
     and coalesce(rr.status, 'pending') not in ('rejected', 'refund_completed', 'completed', 'delivered');
  if n > 0 then
    reasons := reasons || jsonb_build_array(jsonb_build_object(
      'code', 'open_returns', 'count', n,
      'message', 'You have a return or refund still in progress. You can delete your account once it is finished.'));
  end if;

  return jsonb_build_object('eligible', jsonb_array_length(reasons) = 0, 'reasons', reasons);
end;
$$;

-- 3. The deletion itself ---------------------------------------------------
create or replace function public.delete_customer_account(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b        jsonb;
  v_email  text;
  v_phone  text;
  v_tomb   text;
  res      jsonb := '{}'::jsonb;
  r        record;
  bal      integer;
  n        integer;
  v_orders uuid[];
  v_rets   uuid[];
begin
  b := public.account_deletion_blockers(p_user);
  if not (b->>'eligible')::boolean then
    raise exception 'account_deletion_blocked: %', b::text using errcode = 'P0001';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = p_user;
  select nullif(btrim(c.phone), '') into v_phone from public.customers c where c.id = p_user;
  v_tomb := 'deleted+' || substr(p_user::text, 1, 8) || '@deleted.invalid';

  -- A. Points: release holds, void what is still pending, close the balance with
  --    a compensating entry. Ledger rows themselves carry no personal data.
  for r in select order_id from public.rewards_reservations where user_id = p_user and status = 'reserved' loop
    perform public.rewards_release_reservation(r.order_id, 'account_closed');
  end loop;
  update public.rewards_purchase_awards set status = 'void', void_reason = 'account_closed'
   where user_id = p_user and status = 'pending';
  update public.rewards_referral_awards set status = 'void', void_reason = 'account_closed'
   where referrer_id = p_user and status in ('pending', 'in_review');
  select balance_points into bal from public.rewards_accounts where user_id = p_user;
  if coalesce(bal, 0) > 0 then
    perform public.rewards_post_ledger(p_user, -bal, 'adjustment', 'account_closed',
      'account-closed:' || p_user::text, 'account', p_user::text, null, null,
      'Customer account closed; balance forfeited', null);
  end if;
  update public.rewards_accounts set referral_code = null, updated_at = now() where user_id = p_user;
  res := res || jsonb_build_object('points_forfeited', coalesce(bal, 0));

  -- B. Anonymise what must be kept. The orders audit trigger records the old values
  --    of what we change, so the audit entries are scrubbed again right after.
  select coalesce(array_agg(id), '{}') into v_orders from public.orders
   where customer_id = p_user or lower(customer_email) = v_email;
  select coalesce(array_agg(id), '{}') into v_rets from public.return_requests
   where lower(customer_email) = v_email;

  update public.orders set
      customer_name = 'Deleted customer', customer_email = v_tomb, customer_phone = '-',
      delivery_address = 'Removed on account deletion', delivery_landmark = null,
      order_notes = null, special_instructions = null, customer_id = null,
      metadata = coalesce(metadata, '{}'::jsonb) - 'customer_name' - 'customer_email' - 'customer_phone'
                 - 'email' - 'phone' - 'name' - 'address'
   where id = any (v_orders);
  get diagnostics n = row_count; res := res || jsonb_build_object('orders_anonymised', n);

  update public.return_requests set customer_email = null, customer_name = null where id = any (v_rets);
  get diagnostics n = row_count; res := res || jsonb_build_object('returns_anonymised', n);

  update public.influencer_sales set customer_email = null where lower(customer_email) = v_email;
  update public.product_reviews set reviewer_email = v_tomb, reviewer_name = 'Former customer'
   where lower(reviewer_email) = v_email;
  get diagnostics n = row_count; res := res || jsonb_build_object('reviews_anonymised', n);

  update public.giveaway_entries set full_name = 'Deleted', email = null, customer_id = null,
         whatsapp_number = 'deleted-' || id::text
   where customer_id = p_user or lower(email) = v_email;
  get diagnostics n = row_count; res := res || jsonb_build_object('giveaway_entries_anonymised', n);

  update public.email_logs set recipient = v_tomb where lower(recipient) = v_email;
  update public.support_sessions set customer_user_id = null, customer_email = v_tomb, customer_name = 'Deleted customer'
   where customer_user_id = p_user or lower(customer_email) = v_email;
  if v_phone is not null then
    update public.whatsapp_chats set customer_name = 'Deleted customer' where customer_phone = v_phone;
  end if;

  -- Audit trail keeps its rows; the personal values inside them go.
  update public.activity_logs set actor_email = v_tomb, details = jsonb_build_object('anonymised', true)
   where user_id = p_user or lower(actor_email) = v_email;
  update public.activity_logs set details = jsonb_build_object('anonymised', true)
   where (resource_type in ('orders', 'return_requests') and resource_id::text = any (select unnest(v_orders || v_rets)::text))
      or (resource_type = 'customers' and resource_id::text = p_user::text);

  -- C. Delete what has no reason to stay.
  delete from public.customer_journey_events where customer_id = p_user or lower(customer_email) = v_email;
  delete from public.product_winback_sends where lower(customer_email) = v_email;
  delete from public.whatsapp_marketing_consent
   where customer_id = p_user or lower(email) = v_email or (v_phone is not null and phone = v_phone);
  delete from public.device_tokens where customer_id = p_user::text;
  delete from public.store_follows where user_id = p_user;

  -- customer_addresses, wishlist, saved cards and notification prefs cascade.
  delete from public.customers where id = p_user;
  get diagnostics n = row_count; res := res || jsonb_build_object('customer_deleted', n);

  return res;
end;
$$;

revoke all on function public.account_deletion_blockers(uuid) from public, anon, authenticated;
revoke all on function public.delete_customer_account(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;
grant execute on function public.delete_customer_account(uuid) to service_role;

-- 4. Email templates -------------------------------------------------------
alter table public.email_templates drop constraint if exists email_templates_type_check;
alter table public.email_templates add constraint email_templates_type_check check (type = any (array[
  'influencer_report','order_cancelled','order_confirmation','order_processing','order_shipped','out_for_delivery',
  'order_delivered','refund_completed','return_rejected','return_request_received','vendor_fez_pickup_confirmed',
  'vendor_order_fez_pickup','vendor_order_hub_dropoff','vendor_waitlist_activation','vendor_waitlist_confirmation',
  'support_chat_staff_alert','support_chat_customer_receipt','vendor_application_received','vendor_application_rejected',
  'vendor_application_alert','contact_form','return_admin_alert','return_vendor_alert','return_approved',
  'return_in_transit','return_delivered_to_hub','refund_failed','vendor_shipment_ready_fez_pickup',
  'vendor_shipment_ready_fez_hub','abandoned_checkout_reminder','product_view_winback','vendor_activation_reminder',
  'vendor_welcome','vendor_monthly_sales_report','vendor_promotional_campaign','vendor_account_update','giveaway_winner',
  'account_deletion_confirm','account_deleted']));

with shell(s) as (
  select $shell$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>@@TITLE@@ - JulineMart</title>
</head>
<body style="margin:0;padding:0;background:#f6f3f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3f7;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-top:4px solid #670779;">
<tr><td style="padding:32px 40px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;"><img src="https://res.cloudinary.com/dupgdbwrt/image/upload/v1759971092/icon-512x512.png_ygtda9.png" alt="" width="36" height="36" style="display:block;border:0;"></td>
<td style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#2d0334;letter-spacing:-0.2px;">JulineMart</td>
</tr></table>
</td></tr>
<tr><td style="padding:40px 40px 8px;">
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.2;font-weight:normal;color:#1f1424;letter-spacing:-0.5px;">@@HEADLINE@@</h1>
<p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:600;color:#1f1424;">Hi {{customerName}},</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3d3543;">@@LEAD@@</p>
@@BODY@@
</td></tr>
<tr><td style="padding:32px 40px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e7e1e9;"><tr>
<td style="padding-top:24px;font-size:13px;line-height:1.7;color:#6b6472;">@@HELP@@</td>
</tr></table>
</td></tr>
</table>
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;"><tr>
<td style="padding:20px 40px;font-size:12px;line-height:1.7;color:#6b6472;">JulineMart, Nigeria's trusted marketplace<br>Lagos &middot; Warri &middot; Abuja</td>
</tr></table>
</td></tr></table>
</body>
</html>$shell$
),
items(name, type, subject, title, headline, lead, body, help, variables, text_content) as (
  values
  ('Account Deletion Confirmation', 'account_deletion_confirm', 'Confirm deleting your JulineMart account', 'Confirm account deletion',
   'Confirm your account deletion',
   'We received a request to permanently delete your JulineMart account. To make sure it was you, confirm below. The link works once and expires in 1 hour.',
   '<p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#1f1424;">What will happen</p><p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#3d3543;">Your profile, saved addresses, wishlist and sign-in are deleted. Any JulinePoints balance is forfeited. Order records are kept for tax and accounting, with your name, phone and address removed. This cannot be undone.</p><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr><td style="background:#670779;border-radius:2px;"><a href="{{confirmUrl}}" style="display:inline-block;padding:15px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">Confirm and delete my account</a></td></tr></table>',
   'Didn''t ask for this? Ignore this email. Nothing will be deleted and your account stays as it is. Questions? Write to <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a>.',
   '["customerName","confirmUrl"]'::jsonb,
   E'Hi {{customerName}},\n\nWe received a request to permanently delete your JulineMart account. Confirm it here (the link works once and expires in 1 hour):\n{{confirmUrl}}\n\nIf you did not ask for this, ignore this email and nothing will be deleted.'),
  ('Account Deleted', 'account_deleted', 'Your JulineMart account has been deleted', 'Account deleted',
   'Your account has been deleted',
   'Your JulineMart account and personal data have been deleted, as you asked.',
   '<p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#3d3543;">Order records that we must keep for tax and accounting remain, with your personal details removed. You are always welcome back: you can create a new account any time.</p>',
   'Didn''t request this? Write to us straight away at <a href="mailto:info@julinemart.com" style="color:#670779;">info@julinemart.com</a>.',
   '["customerName"]'::jsonb,
   E'Hi {{customerName}},\n\nYour JulineMart account and personal data have been deleted, as you asked. Order records we must keep for tax and accounting remain, with your personal details removed.')
)
insert into public.email_templates (name, type, subject, html_content, text_content, variables, is_active)
select i.name, i.type, i.subject,
       replace(replace(replace(replace(replace(sh.s, '@@TITLE@@', i.title), '@@HEADLINE@@', i.headline),
         '@@LEAD@@', i.lead), '@@BODY@@', i.body), '@@HELP@@', i.help),
       i.text_content, i.variables, true
from items i, shell sh
on conflict (type) do nothing;
