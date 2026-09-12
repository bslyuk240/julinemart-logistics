-- Influencer self-service portal (Phase A): link influencers to a Supabase Auth
-- user and lock down direct client access with RLS. Real enforcement + field
-- redaction still happens in the new influencer-* Netlify functions (service
-- role); these policies are defense-in-depth for the two tables an influencer
-- login can now reach, mirroring nothing pre-existing since `influencers` had
-- no RLS at all before this.

alter table public.influencers
  add column if not exists user_id uuid references auth.users(id);

create unique index if not exists influencers_user_id_key
  on public.influencers (user_id)
  where user_id is not null;

alter table public.influencers enable row level security;
alter table public.influencer_sales enable row level security;

drop policy if exists "Service role has full access" on public.influencers;
create policy "Service role has full access" on public.influencers
  for all to service_role using (true) with check (true);

drop policy if exists "Influencer can read own row" on public.influencers;
create policy "Influencer can read own row" on public.influencers
  for select
  using (auth.uid() = user_id);

drop policy if exists "Service role has full access" on public.influencer_sales;
create policy "Service role has full access" on public.influencer_sales
  for all to service_role using (true) with check (true);

drop policy if exists "Influencer can read own sales" on public.influencer_sales;
create policy "Influencer can read own sales" on public.influencer_sales
  for select
  using (
    exists (
      select 1 from public.influencers i
      where i.id = influencer_sales.influencer_id
        and i.user_id = auth.uid()
    )
  );

comment on column public.influencers.user_id is
  'Links to auth.users once the influencer accepts a staff-sent invite (netlify/functions/influencer-invite.js). Null until then.';
