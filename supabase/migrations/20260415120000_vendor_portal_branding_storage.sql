-- Vendor portal Settings: upload logo/banner to vendor-documents/branding/{vendor_id}/...
-- Registration uploads use other paths under the same bucket; existing policies stay intact.

insert into storage.buckets (id, name, public)
values ('vendor-documents', 'vendor-documents', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Authenticated insert vendor branding" on storage.objects;
create policy "Authenticated insert vendor branding"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vendor-documents'
    and (name like 'branding/%')
  );

drop policy if exists "Authenticated update vendor branding" on storage.objects;
create policy "Authenticated update vendor branding"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'vendor-documents'
    and (name like 'branding/%')
  )
  with check (
    bucket_id = 'vendor-documents'
    and (name like 'branding/%')
  );
