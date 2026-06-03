-- Log password changes/resets (Supabase-native auth; no WordPress).
-- Fires on auth.users password change, tagged by which portal the user belongs to.
-- The insert is exception-guarded so an audit failure can NEVER block a password change.
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

    insert into public.activity_logs (user_id, actor_email, action, resource_type, source)
    values (new.id, new.email, 'PASSWORD_CHANGED', null, src);
  exception when others then
    null; -- never block auth on a logging failure
  end;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS log_password_changed_trg ON auth.users;
CREATE TRIGGER log_password_changed_trg
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (old.encrypted_password IS DISTINCT FROM new.encrypted_password)
  EXECUTE FUNCTION public.log_password_changed();
