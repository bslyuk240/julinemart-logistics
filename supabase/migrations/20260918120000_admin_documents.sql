-- Admin document library: lets staff upload and store business docs (partner
-- packs, policies, SOPs) in-app instead of scattering them across drives.
-- Written and read only through admin-documents.js (service role) — no
-- client-side storage or table policies are needed since the service role
-- bypasses RLS; leaving RLS enabled with no policies locks out anon/authenticated.

insert into storage.buckets (id, name, public)
values ('admin-documents', 'admin-documents', true)
on conflict (id) do update set public = excluded.public;

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'general',
  file_name text not null,
  file_path text not null,
  file_url text not null,
  file_size bigint,
  content_type text,
  uploaded_by uuid references users(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

alter table documents enable row level security;

create index if not exists documents_category_idx on documents (category, created_at desc);
