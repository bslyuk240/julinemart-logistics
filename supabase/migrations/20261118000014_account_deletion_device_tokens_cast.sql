-- device_tokens.customer_id is text, not uuid: cast the id when comparing.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.delete_customer_account(uuid)'::regprocedure);
  def := replace(def, 'delete from public.device_tokens where customer_id = p_user;', 'delete from public.device_tokens where customer_id = p_user::text;');
  execute def;
end $$;
