-- Extend storefront audit logging to two more authoritative customer actions.
-- Both are logged via AFTER INSERT triggers (SECURITY DEFINER) so they fire
-- regardless of which code path creates the row, mirroring the SIGNUP approach.

-- 1. RETURN_REQUESTED — a customer submitting a return request.
CREATE OR REPLACE FUNCTION public.log_return_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.activity_logs (user_id, actor_email, action, resource_type, resource_id, details, source)
  values (
    null,
    new.customer_email,
    'RETURN_REQUESTED',
    'return_requests',
    new.id::text,
    jsonb_build_object(
      'order_number', new.order_number,
      'reason', coalesce(new.reason_code, new.reason),
      'preferred_resolution', new.preferred_resolution,
      'customer_name', new.customer_name
    ),
    'storefront'
  );
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS log_return_requested_trg ON public.return_requests;
CREATE TRIGGER log_return_requested_trg
  AFTER INSERT ON public.return_requests
  FOR EACH ROW EXECUTE FUNCTION public.log_return_requested();

-- 2. CARD_ADDED — a customer saving a payment card.
CREATE OR REPLACE FUNCTION public.log_card_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.activity_logs (user_id, actor_email, action, resource_type, resource_id, details, source)
  values (
    new.customer_id,
    new.email,
    'CARD_ADDED',
    'customer_saved_cards',
    new.id::text,
    jsonb_build_object('card_type', new.card_type, 'last4', new.last4, 'bank', new.bank),
    'storefront'
  );
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS log_card_added_trg ON public.customer_saved_cards;
CREATE TRIGGER log_card_added_trg
  AFTER INSERT ON public.customer_saved_cards
  FOR EACH ROW EXECUTE FUNCTION public.log_card_added();
