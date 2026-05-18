CREATE TABLE IF NOT EXISTS public.fx_price_sync_logs (
  id              uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  reason          text          NOT NULL,
  rate_used       numeric(18,6) NOT NULL,
  previous_rate   numeric(18,6) NULL,
  change_pct      numeric(8,4)  NULL,
  updated_simple  integer       NOT NULL DEFAULT 0,
  updated_variations integer    NOT NULL DEFAULT 0,
  skipped         integer       NOT NULL DEFAULT 0,
  errors          jsonb         NULL
);

COMMENT ON TABLE  public.fx_price_sync_logs IS 'Audit log of every FX-triggered CJ product price sync run';
COMMENT ON COLUMN public.fx_price_sync_logs.reason IS 'manual | threshold_triggered | initial_sync | weekly_scheduled';

ALTER TABLE public.fx_price_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.fx_price_sync_logs
  FOR ALL USING (true) WITH CHECK (true);
