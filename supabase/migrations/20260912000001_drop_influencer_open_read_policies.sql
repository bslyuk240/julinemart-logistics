-- Pre-existing (out-of-band, not previously tracked in this repo's migrations)
-- "Allow authenticated read on influencers" / "...influencer_sales" policies had
-- `qual: true` for the `authenticated` role — meaning ANY logged-in user of ANY
-- app sharing this Supabase project (customers, riders, vendors, staff) could
-- read every influencer's bank account details, commission data, and every
-- sale's customer email via a direct PostgREST/Supabase-client call.
--
-- Confirmed via full grep of julinemart-logistics-orchestrator and julinemart-pwa
-- that no client-side code relies on this: every browser-side read of these
-- tables goes through either the `influencers` Supabase Edge Function or the
-- Express `/api/influencers/*` backend, both of which use the service-role key
-- (bypasses RLS regardless of these policies). Safe to remove.

drop policy if exists "Allow authenticated read on influencers" on public.influencers;
drop policy if exists "Allow authenticated read on influencer_sales" on public.influencer_sales;
