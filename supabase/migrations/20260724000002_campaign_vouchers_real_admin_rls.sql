-- The existing "admin_manage_vouchers" policy on campaign_vouchers was named
-- for admins but actually granted ALL (insert/update/delete) to any
-- `authenticated` orchestrator user, with no role check — meaning any
-- logged-in staff account (not just admin) could mint/edit/delete vouchers
-- directly via the Supabase client, bypassing the app's isAdmin UI gate.
-- Replaces it with a real per-role split, matching the admin-role-check
-- pattern already used on the `users` table (20250101000014_user_management.sql):
-- SELECT stays open to any authenticated staff (needed for the Campaign
-- Builder's voucher-link dropdown and the Vouchers page's own read-only
-- view), but INSERT/UPDATE/DELETE now require a real admin role.
-- Does not affect checkout/redemption — those run through the service-role
-- client in netlify/functions/helpers/voucherHelpers.js, which bypasses RLS.
drop policy if exists "admin_manage_vouchers" on campaign_vouchers;

create policy "campaign_vouchers_select_authenticated"
  on campaign_vouchers
  for select
  to authenticated
  using (true);

create policy "campaign_vouchers_admin_insert"
  on campaign_vouchers
  for insert
  to authenticated
  with check (
    exists (select 1 from users where id = auth.uid() and role = 'admin')
  );

create policy "campaign_vouchers_admin_update"
  on campaign_vouchers
  for update
  to authenticated
  using (
    exists (select 1 from users where id = auth.uid() and role = 'admin')
  )
  with check (
    exists (select 1 from users where id = auth.uid() and role = 'admin')
  );

create policy "campaign_vouchers_admin_delete"
  on campaign_vouchers
  for delete
  to authenticated
  using (
    exists (select 1 from users where id = auth.uid() and role = 'admin')
  );
