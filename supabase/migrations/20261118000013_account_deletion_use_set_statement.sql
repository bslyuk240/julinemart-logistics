-- delete_customer_account() switched row triggers off with set_config(), which
-- the postgres role is not allowed to call for session_replication_role here;
-- a plain SET statement is allowed. Patch the already-created function in place.
do $$
declare def text;
begin
  def := pg_get_functiondef('public.delete_customer_account(uuid)'::regprocedure);
  def := replace(def, 'perform set_config(''session_replication_role'', ''replica'', true);', 'set local session_replication_role = replica;');
  def := replace(def, 'perform set_config(''session_replication_role'', ''origin'', true);',  'set local session_replication_role = origin;');
  execute def;
end $$;
