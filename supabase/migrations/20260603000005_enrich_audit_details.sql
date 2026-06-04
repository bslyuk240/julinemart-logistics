-- Enrich audit log details for SIGNUP and PASSWORD_CHANGED triggers.

-- SIGNUP: add provider, first_name, last_name, phone from auth metadata.
CREATE OR REPLACE FUNCTION public.handle_new_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
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

  if (tg_op = 'INSERT') then
    insert into public.activity_logs (user_id, actor_email, action, resource_type, resource_id, details, source)
    values (
      new.id,
      new.email,
      'SIGNUP',
      'customers',
      new.id::text,
      jsonb_build_object(
        'provider',    coalesce(new.raw_app_meta_data->>'provider', 'email'),
        'first_name',  coalesce(new.raw_user_meta_data->>'first_name', null),
        'last_name',   coalesce(new.raw_user_meta_data->>'last_name', null),
        'phone',       coalesce(new.raw_user_meta_data->>'phone', null)
      ),
      'storefront'
    );
  end if;

  return new;
end;
$function$;

-- PASSWORD_CHANGED: add portal, email, recovery_sent_at hint.
CREATE OR REPLACE FUNCTION public.log_password_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  src text;
begin
  begin
    if exists (select 1 from public.users where id = new.id) then
      src := 'jlo';
    elsif exists (select 1 from public.vendors where user_id = new.id) then
      src := 'vendor_portal';
    else
      src := 'storefront';
    end if;

    insert into public.activity_logs (user_id, actor_email, action, resource_type, details, source)
    values (
      new.id,
      new.email,
      'PASSWORD_CHANGED',
      null,
      jsonb_build_object(
        'portal',            src,
        'email',             new.email,
        'recovery_sent_at',  new.recovery_sent_at
      ),
      src
    );
  exception when others then
    null;
  end;
  return new;
end;
$function$;
