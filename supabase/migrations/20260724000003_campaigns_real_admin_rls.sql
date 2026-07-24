-- Same gap as campaign_vouchers (see 20260724000002): the "admin_manage_*"
-- policies on campaigns/campaign_sections/campaign_qr_variants all granted
-- ALL (insert/update/delete) to any `authenticated` orchestrator user with no
-- role check, not just admins. Splits each into a real per-command policy:
-- SELECT stays open to authenticated staff (the admin dashboard's list/edit
-- views need to read draft/paused/archived campaigns too, not just the
-- public "active" subset already exposed to anon/public), while
-- INSERT/UPDATE/DELETE now require a real admin role, matching the pattern
-- already used on the `users` table.
--
-- campaign_qr_variants keeps no separate authenticated-select policy — the
-- existing "Public can read QR variants" policy (role: public) already
-- covers read access for every role, including authenticated.
drop policy if exists "admin_manage_campaigns" on campaigns;

create policy "campaigns_select_authenticated"
  on campaigns for select to authenticated using (true);

create policy "campaigns_admin_insert"
  on campaigns for insert to authenticated
  with check (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "campaigns_admin_update"
  on campaigns for update to authenticated
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "campaigns_admin_delete"
  on campaigns for delete to authenticated
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

drop policy if exists "admin_manage_campaign_sections" on campaign_sections;

create policy "campaign_sections_select_authenticated"
  on campaign_sections for select to authenticated using (true);

create policy "campaign_sections_admin_insert"
  on campaign_sections for insert to authenticated
  with check (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "campaign_sections_admin_update"
  on campaign_sections for update to authenticated
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "campaign_sections_admin_delete"
  on campaign_sections for delete to authenticated
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

drop policy if exists "admin_manage_campaign_qr_variants" on campaign_qr_variants;

create policy "campaign_qr_variants_admin_insert"
  on campaign_qr_variants for insert to authenticated
  with check (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "campaign_qr_variants_admin_update"
  on campaign_qr_variants for update to authenticated
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "campaign_qr_variants_admin_delete"
  on campaign_qr_variants for delete to authenticated
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));
