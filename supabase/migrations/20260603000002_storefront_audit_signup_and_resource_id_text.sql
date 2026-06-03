-- Storefront audit logging hardening
--
-- 1. Relax activity_logs.resource_id from uuid -> text. JLO resources use uuids,
--    but storefront/Woo references (e.g. order_number) are numeric. A uuid column
--    silently rejects those with "invalid input syntax for type uuid", and the
--    client swallows the error. text accepts both; nothing FKs/casts on this column.
ALTER TABLE public.activity_logs
  ALTER COLUMN resource_id TYPE text USING resource_id::text;

-- 2. Log storefront SIGNUP server-side from the auth.users -> customers trigger.
--    This is authoritative: it fires for every real customer signup regardless of
--    client-side session timing (email confirmation, Google/NextAuth, etc.).
CREATE OR REPLACE FUNCTION public.handle_new_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  -- Skip storefront customer sync for JLO staff created via Admin API
  if public.is_jlo_staff_auth_creation(new.raw_app_meta_data) then
    return new;
  end if;

  insert into public.customers (id, email, first_name, last_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', '')
  )
  on conflict (id) do update set
    email      = excluded.email,
    first_name = case when excluded.first_name <> '' then excluded.first_name else customers.first_name end,
    last_name  = case when excluded.last_name  <> '' then excluded.last_name  else customers.last_name  end,
    avatar_url = case when excluded.avatar_url <> '' then excluded.avatar_url else customers.avatar_url end,
    updated_at = now();

  -- Audit trail: record the signup (only on first insert, not on re-sync upserts).
  if (tg_op = 'INSERT') then
    insert into public.activity_logs (user_id, actor_email, action, resource_type, resource_id, details, source)
    values (
      new.id,
      new.email,
      'SIGNUP',
      'customers',
      new.id::text,
      jsonb_build_object('provider', coalesce(new.raw_app_meta_data->>'provider', 'email')),
      'storefront'
    );
  end if;

  return new;
end;
$function$;
