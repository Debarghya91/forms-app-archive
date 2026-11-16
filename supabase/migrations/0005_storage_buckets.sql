-- 0005: private storage buckets (documents, notices) with
-- owner-only object policies. The service role bypasses these
-- policies. Idempotent: bucket inserts ignore conflicts and policies
-- are dropped before they are created.
--
-- If the SQL editor role cannot write to storage.buckets, create the
-- buckets in the dashboard instead (Storage, New bucket, private) and
-- re-run only the policy statements below.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('notices', 'notices', false)
on conflict (id) do nothing;

drop policy if exists owner_all_documents on storage.objects;
create policy owner_all_documents on storage.objects for all to authenticated
  using (bucket_id = 'documents' and auth.uid() = owner)
  with check (bucket_id = 'documents' and auth.uid() = owner);

drop policy if exists owner_all_notices on storage.objects;
create policy owner_all_notices on storage.objects for all to authenticated
  using (bucket_id = 'notices' and auth.uid() = owner)
  with check (bucket_id = 'notices' and auth.uid() = owner);
