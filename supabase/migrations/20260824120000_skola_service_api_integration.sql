-- Service API keys for external "Custom API" integrations (e.g. Skola Workforce).
-- Tokens are never stored — only a SHA-256 hash of the token is kept, so a DB
-- read can never recover a usable credential. key_prefix is stored purely for
-- display in the admin UI (so an admin can tell keys apart without unhashing).
create table if not exists service_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index if not exists idx_service_api_keys_hash on service_api_keys(key_hash);

-- Outbound webhook destinations this app pushes events to. The secret is
-- encrypted at rest with the same AES-256-GCM scheme as courier credentials
-- (see netlify/functions/services/secretsCrypto.js), keyed by ENCRYPTION_KEY.
create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  url text not null,
  secret_encrypted text not null,
  event_types text[] not null default '{}', -- empty = subscribed to all event types
  is_active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Delivery attempts/log for outbound webhooks, driving the retry-with-backoff
-- scheduled function. event_id is the value sent as X-Skola-Event-Id — kept
-- stable across retries so re-delivery of the same event is a safe no-op on
-- the receiving end.
create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'dead')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_deliveries_retry
  on webhook_deliveries(next_attempt_at)
  where status in ('pending', 'failed');

-- Notes appended to a shipment by an external system (e.g. an AI agent via
-- the service API). Kept as its own audited table rather than mutating
-- shipments.metadata, so entries are append-only and individually attributable.
create table if not exists shipment_notes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  source text not null default 'api',
  author text,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_shipment_notes_shipment
  on shipment_notes(shipment_id, created_at desc);

-- These tables are written/read exclusively via service-role Netlify
-- functions (admin-service-api-keys, admin-webhook-endpoints, public-api,
-- the webhook delivery/retry jobs) — never directly from a browser client.
-- RLS is enabled with no policies, so anon/authenticated get zero access
-- (service role bypasses RLS), matching this project's convention of RLS-on
-- for every table.
alter table service_api_keys enable row level security;
alter table webhook_endpoints enable row level security;
alter table webhook_deliveries enable row level security;
alter table shipment_notes enable row level security;
