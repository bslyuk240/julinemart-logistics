-- Security hardening: RLS on manual_shipments + restrict waybill RPC to service_role.

ALTER TABLE public.manual_shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manual_shipments service role full access"
  ON public.manual_shipments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "manual_shipments staff read"
  ON public.manual_shipments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.is_active = true
        AND u.role IN ('admin', 'agent', 'manager', 'viewer', 'staff', 'shop_manager')
    )
  );

CREATE POLICY "manual_shipments staff write"
  ON public.manual_shipments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.is_active = true
        AND u.role IN ('admin', 'agent', 'manager', 'staff')
    )
  );

CREATE POLICY "manual_shipments staff update"
  ON public.manual_shipments
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.is_active = true
        AND u.role IN ('admin', 'agent', 'manager', 'staff')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = auth.uid()
        AND u.is_active = true
        AND u.role IN ('admin', 'agent', 'manager', 'staff')
    )
  );

REVOKE EXECUTE ON FUNCTION public.next_waybill_number() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.next_waybill_number() TO service_role;
