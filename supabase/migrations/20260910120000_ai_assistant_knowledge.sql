-- Freeform knowledge the customer-facing AI support chat can draw on, beyond
-- the shipping/refund/terms static_pages it already reads (see
-- julinemart-pwa's src/app/api/support/message/route.ts buildSystemPrompt).
-- Staff add entries here from JLO; the PWA folds active ones into the
-- assistant's system prompt on every reply, so no code deploy is needed to
-- teach it something new (e.g. an active giveaway's rules).

create table ai_assistant_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ai_assistant_knowledge_active on ai_assistant_knowledge (is_active);

alter table ai_assistant_knowledge enable row level security;

-- The PWA's chat route reads this with the service-role key (bypasses RLS) —
-- this policy matches the explicit convention already used for
-- campaign_reviews / internal_whatsapp_templates rather than relying on the
-- bypass alone.
create policy "service_role_all_ai_assistant_knowledge"
  on ai_assistant_knowledge
  for all
  to service_role
  using (true)
  with check (true);

-- Admin-only, matching other "site content" admin surfaces (Homepage
-- Content, Tags, Categories) rather than the wider admin+manager set some
-- operational tables use — this directly shapes what the customer-facing
-- assistant says.
create policy "ai_assistant_knowledge_all_admin"
  on ai_assistant_knowledge
  for all
  to authenticated
  using (
    exists (
      select 1 from users
      where users.id = auth.uid()
        and users.is_active = true
        and users.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from users
      where users.id = auth.uid()
        and users.is_active = true
        and users.role = 'admin'
    )
  );
