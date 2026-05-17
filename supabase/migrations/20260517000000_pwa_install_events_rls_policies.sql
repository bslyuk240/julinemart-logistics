-- RLS policies for pwa_install_events
-- The table was created with RLS enabled but no policies, causing the anon
-- client used by the PWA Monitoring dashboard to return 0 rows.

-- Allow any logged-in dashboard user to read PWA events
CREATE POLICY "authenticated users can read pwa_install_events"
  ON pwa_install_events FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow inserts (used by PWA's Next.js API route via service role key)
CREATE POLICY "service role can insert pwa_install_events"
  ON pwa_install_events FOR INSERT
  WITH CHECK (true);
