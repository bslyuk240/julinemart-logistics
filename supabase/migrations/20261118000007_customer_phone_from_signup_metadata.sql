-- Save the sign-up phone number from the auth metadata.
--
-- The storefront used to write customers.phone from the browser right after
-- signUp(), which needs a logged-in session. With "Confirm email" on there is
-- no session until the customer clicks the link, so the phone was silently never
-- saved. The trigger now copies it (an existing non-empty phone is never
-- overwritten). Everything else in the function is unchanged.
create or replace function public.handle_new_customer()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.is_jlo_staff_auth_creation(new.raw_app_meta_data) then
    return new;
  end if;

  insert into public.customers (id, email, first_name, last_name, avatar_url, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(btrim(coalesce(new.raw_user_meta_data->>'phone', '')), '')
  )
  on conflict (id) do update set
    email      = excluded.email,
    first_name = case when excluded.first_name <> '' then excluded.first_name else customers.first_name end,
    last_name  = case when excluded.last_name  <> '' then excluded.last_name  else customers.last_name  end,
    avatar_url = case when excluded.avatar_url <> '' then excluded.avatar_url else customers.avatar_url end,
    phone      = coalesce(nullif(customers.phone, ''), excluded.phone),
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
