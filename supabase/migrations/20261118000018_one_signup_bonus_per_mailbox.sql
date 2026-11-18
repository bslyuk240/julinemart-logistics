-- One sign-up bonus per mailbox.
--
-- Each claim now stores the one-way fingerprint of the mailbox (ignores +tags and
-- Gmail dots, see account_email_fingerprint). A unique index makes a second claim
-- for the same mailbox impossible, even for two sign-ups at the same instant.
-- Referrals also treat a friend on the referrer's own mailbox as a self-referral.

alter table public.rewards_signup_claims add column if not exists email_hash text;
create unique index if not exists uq_rewards_signup_claims_email_hash
  on public.rewards_signup_claims (email_hash) where email_hash is not null;

do $$
declare def text; patched text;
begin
  def := pg_get_functiondef('public.rewards_claim_signup(uuid)'::regprocedure);
  patched := replace(def,
    E'    return jsonb_build_object(''awarded'', false, ''reason'', ''previously_registered'');\n  end if;\n',
    E'    return jsonb_build_object(''awarded'', false, ''reason'', ''previously_registered'');\n  end if;\n  if exists (select 1 from public.rewards_signup_claims sc where sc.email_hash = public.account_email_fingerprint(au.email) and sc.user_id <> p_user) then\n    return jsonb_build_object(''awarded'', false, ''reason'', ''mailbox_already_claimed'');\n  end if;\n');
  patched := replace(patched,
    E'insert into public.rewards_signup_claims (user_id, config_version_id)\n  values (p_user, v.id) on conflict (user_id) do nothing;',
    E'insert into public.rewards_signup_claims (user_id, config_version_id, email_hash)\n  values (p_user, v.id, public.account_email_fingerprint(au.email)) on conflict do nothing;');
  if position('mailbox_already_claimed' in patched) = 0 or position('on conflict do nothing' in patched) = 0 then
    raise exception 'rewards_claim_signup: marker not found, nothing patched';
  end if;
  execute patched;
end $$;

do $$
declare def text; patched text;
begin
  def := pg_get_functiondef('public.rewards_register_referral(uuid,text)'::regprocedure);
  patched := replace(def,
    E'    elsif referrer = p_referee then\n',
    E'    elsif referrer = p_referee\n       or public.account_email_fingerprint(au.email) = public.account_email_fingerprint((select u.email from auth.users u where u.id = referrer)) then\n');
  if patched = def then raise exception 'rewards_register_referral: marker not found, nothing patched'; end if;
  execute patched;
end $$;
