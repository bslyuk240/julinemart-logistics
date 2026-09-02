-- internal_whatsapp_templates has row_security enabled but had ZERO policies
-- defined on it — in Postgres that means every non-superuser/non-bypassrls
-- role (including the admin dashboard's `authenticated` client) silently gets
-- back zero rows on every query, no error. This is why the Giveaways admin
-- page's "Send WhatsApp broadcast" Template dropdown has always been empty:
-- the sync/send Netlify functions write and read this table fine because
-- they use the service_role key, which bypasses RLS entirely, but the
-- dashboard reads it directly from the browser as `authenticated`.
--
-- Mirrors the hardened admin/manager read pattern already established for
-- other staff-only tables (is_active check included, see
-- 20260731000004_security_hardening_manual_shipments.sql) — writes stay
-- service_role-only (no authenticated write policy), matching how this table
-- has only ever been written to (sync + admin-triggered send functions).

create policy "service_role_all_internal_whatsapp_templates"
  on public.internal_whatsapp_templates
  for all
  to service_role
  using (true)
  with check (true);

create policy "internal_whatsapp_templates_select_staff"
  on public.internal_whatsapp_templates
  for select
  to authenticated
  using (
    exists (
      select 1 from public.users
      where users.id = auth.uid()
        and users.is_active = true
        and users.role in ('admin', 'manager')
    )
  );
