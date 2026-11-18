-- The service role may not change session_replication_role, so the row-trigger
-- bypass in delete_customer_account() fails when called through the API. It is
-- not needed: the audit entries the orders trigger writes are scrubbed by the
-- activity_logs update that already runs after the anonymisation.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.delete_customer_account(uuid)'::regprocedure);
  def := replace(def, E'  set local session_replication_role = replica;\n\n', '');
  def := replace(def, E'  set local session_replication_role = origin;\n\n', '');
  execute def;
end $$;
