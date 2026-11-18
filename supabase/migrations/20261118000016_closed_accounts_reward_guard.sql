-- Stop deleting an account and re-registering with the same email from earning
-- the sign-up bonus (or a referral reward) a second time.
--
-- At deletion we keep only a one-way fingerprint of the email (never the address).
-- The fingerprint ignores +tags and, for Gmail, dots, so trivial variants of the
-- same mailbox match. The sign-up bonus and referral registration refuse a
-- fingerprint that is on the list.

create table if not exists public.closed_accounts (
  email_hash text primary key,
  closed_at  timestamptz not null default now()
);
alter table public.closed_accounts enable row level security;
revoke all on public.closed_accounts from anon, authenticated;

create or replace function public.account_email_fingerprint(p_email text)
returns text
language sql immutable
set search_path = public
as $$
  with e as (
    select lower(btrim(coalesce(p_email, ''))) as addr
  ), p as (
    select split_part(addr, '@', 1) as local_part, split_part(addr, '@', 2) as domain from e
  ), n as (
    select
      case when domain in ('gmail.com', 'googlemail.com') then replace(split_part(local_part, '+', 1), '.', '')
           else split_part(local_part, '+', 1) end as local_part,
      case when domain = 'googlemail.com' then 'gmail.com' else domain end as domain
    from p
  )
  select encode(sha256(convert_to('jm-closed-account:' || local_part || '@' || domain, 'UTF8')), 'hex') from n;
$$;
revoke all on function public.account_email_fingerprint(text) from public, anon, authenticated;
grant execute on function public.account_email_fingerprint(text) to service_role;

-- 1. Record the fingerprint when an account is deleted.
do $$
declare def text; patched text;
begin
  def := pg_get_functiondef('public.delete_customer_account(uuid)'::regprocedure);
  patched := replace(def,
    E'v_tomb := ''deleted+'' || substr(p_user::text, 1, 8) || ''@deleted.invalid'';\n',
    E'v_tomb := ''deleted+'' || substr(p_user::text, 1, 8) || ''@deleted.invalid'';\n  insert into public.closed_accounts (email_hash) values (public.account_email_fingerprint(v_email)) on conflict do nothing;\n');
  if patched = def then raise exception 'delete_customer_account: marker not found, nothing patched'; end if;
  execute patched;
end $$;

-- 2. No sign-up bonus for a previously deleted email.
do $$
declare def text; patched text;
begin
  def := pg_get_functiondef('public.rewards_claim_signup(uuid)'::regprocedure);
  patched := replace(def,
    E'select id, created_at, email_confirmed_at into au from auth.users where id = p_user;',
    E'select id, email, created_at, email_confirmed_at into au from auth.users where id = p_user;');
  patched := replace(patched,
    E'if not found then return jsonb_build_object(''awarded'', false, ''reason'', ''not_found''); end if;\n',
    E'if not found then return jsonb_build_object(''awarded'', false, ''reason'', ''not_found''); end if;\n  if exists (select 1 from public.closed_accounts ca where ca.email_hash = public.account_email_fingerprint(au.email)) then\n    return jsonb_build_object(''awarded'', false, ''reason'', ''previously_registered'');\n  end if;\n');
  if patched = def or position('closed_accounts' in patched) = 0 or position('au.email' in patched) = 0 then
    raise exception 'rewards_claim_signup: marker not found, nothing patched';
  end if;
  execute patched;
end $$;

-- 3. A deleted-and-recreated friend is not a "new customer" for referral rewards.
do $$
declare def text; patched text;
begin
  def := pg_get_functiondef('public.rewards_register_referral(uuid,text)'::regprocedure);
  patched := replace(def,
    E'      reason := ''already_referred'';\n',
    E'      reason := ''already_referred'';\n    elsif exists (select 1 from public.closed_accounts ca where ca.email_hash = public.account_email_fingerprint(au.email)) then\n      reason := ''previously_registered'';\n');
  if patched = def then raise exception 'rewards_register_referral: marker not found, nothing patched'; end if;
  execute patched;
end $$;
