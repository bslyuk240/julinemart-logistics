-- Allow admin and manager roles to read all customer rows.
-- Without this, the customers table RLS (auth.uid() = id) blocks admin queries.
CREATE POLICY "admin/manager: read all customers"
ON public.customers
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND role IN ('admin', 'manager')
  )
);
