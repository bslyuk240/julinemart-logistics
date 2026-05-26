-- Purge legacy WhatsApp noise from activity logs
DELETE FROM public.activity_logs
WHERE action ILIKE 'whatsapp%'
   OR resource_type ILIKE 'whatsapp%';

-- Improve automatic DB trigger logging (compact details, source tag)
CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS TRIGGER AS $$
DECLARE
  actor uuid;
  actor_mail text;
  act text;
  det jsonb;
  old_j jsonb;
  new_j jsonb;
  k text;
  changes jsonb := '{}'::jsonb;
BEGIN
  actor := auth.uid();
  IF actor IS NOT NULL THEN
    SELECT email INTO actor_mail FROM public.users WHERE id = actor;
  END IF;

  act := CASE TG_OP
    WHEN 'INSERT' THEN 'CREATE'
    WHEN 'UPDATE' THEN 'UPDATE'
    WHEN 'DELETE' THEN 'DELETE'
  END;

  IF TG_OP = 'UPDATE' THEN
    old_j := to_jsonb(OLD);
    new_j := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_j)
    LOOP
      IF k IN ('updated_at', 'last_login', 'last_message_at') THEN
        CONTINUE;
      END IF;
      IF (old_j -> k) IS DISTINCT FROM (new_j -> k) THEN
        changes := changes || jsonb_build_object(k, jsonb_build_object('from', old_j -> k, 'to', new_j -> k));
      END IF;
    END LOOP;
    IF changes = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    det := jsonb_build_object('changes', changes);
  ELSIF TG_OP = 'INSERT' THEN
    det := jsonb_build_object('id', NEW.id);
  ELSE
    det := jsonb_build_object('id', OLD.id);
  END IF;

  INSERT INTO public.activity_logs (user_id, actor_email, action, resource_type, resource_id, details, source)
  VALUES (
    actor,
    actor_mail,
    act,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    det,
    'jlo'
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Extend audit triggers to more operational tables
DROP TRIGGER IF EXISTS log_users_activity ON public.users;
CREATE TRIGGER log_users_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_vendors_activity ON public.vendors;
CREATE TRIGGER log_vendors_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_vendor_withdrawals_activity ON public.vendor_withdrawals;
CREATE TRIGGER log_vendor_withdrawals_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.vendor_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_courier_settlements_activity ON public.courier_settlements;
CREATE TRIGGER log_courier_settlements_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.courier_settlements
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

DROP TRIGGER IF EXISTS log_campaign_vouchers_activity ON public.campaign_vouchers;
CREATE TRIGGER log_campaign_vouchers_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.campaign_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.log_activity();

CREATE INDEX IF NOT EXISTS idx_activity_logs_source ON public.activity_logs(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_resource ON public.activity_logs(resource_type, created_at DESC);
