-- The storefront's /api/analytics/track-event also sends gift funnel events,
-- but the check only allowed 'product_viewed', so every gift event insert was
-- rejected. Keep this list in sync with ALLOWED_EVENT_TYPES in the PWA route.
-- JLO consumers (journey analytics, drilldown, win-back) filter on
-- event_type = 'product_viewed', so the new types don't affect them.
ALTER TABLE public.customer_journey_events
  DROP CONSTRAINT IF EXISTS customer_journey_events_event_type_check;

ALTER TABLE public.customer_journey_events
  ADD CONSTRAINT customer_journey_events_event_type_check
  CHECK (event_type IN ('product_viewed', 'gift_landing_view', 'gift_byo_start', 'gift_purchase'));
