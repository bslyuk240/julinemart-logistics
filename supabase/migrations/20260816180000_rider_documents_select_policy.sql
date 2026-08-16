-- Supabase Storage's upload (INSERT ... RETURNING) also requires the
-- inserted row to satisfy the table's SELECT policy, not just INSERT's
-- WITH CHECK — without this, every rider document upload failed with
-- "new row violates row-level security policy" even though the INSERT
-- policy itself was correct. The bucket is public (admin review reads
-- documents via public URLs), so a public SELECT policy mirrors that.
drop policy if exists "Rider documents public read" on storage.objects;
create policy "Rider documents public read"
  on storage.objects for select
  to public
  using (bucket_id = 'rider-documents');
