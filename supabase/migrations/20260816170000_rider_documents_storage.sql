-- Storage for rider KYC documents (ID photo, live selfie, vehicle
-- registration). Unlike vendor-documents (uploaded by an anonymous
-- applicant, since vendors only get a Supabase Auth account on approval),
-- riders already have an account at upload time — they sign up before
-- starting the application (see rider-register.js) — so this can require
-- `authenticated` and scope each upload to the uploader's own user_id
-- path, which vendor-documents' anon-upload policy can't do.
insert into storage.buckets (id, name, public)
values ('rider-documents', 'rider-documents', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Riders upload their own documents" on storage.objects;
create policy "Riders upload their own documents"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'rider-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Riders update their own documents" on storage.objects;
create policy "Riders update their own documents"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'rider-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'rider-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
