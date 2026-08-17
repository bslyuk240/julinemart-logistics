-- Retroactive migration: is_sub_hub / parent_hub_id were applied directly
-- against the database on 2026-05-10 (feat: sub-hub hierarchy — Asaba routes
-- through Warri for Fez dispatch) but never captured as a migration file.
-- This documents that live schema so `supabase/migrations` matches
-- production. Written idempotently since the columns already exist there.

ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS is_sub_hub boolean NOT NULL DEFAULT false;

ALTER TABLE public.hubs
  ADD COLUMN IF NOT EXISTS parent_hub_id uuid REFERENCES public.hubs(id);

CREATE INDEX IF NOT EXISTS idx_hubs_parent
  ON public.hubs (parent_hub_id);
