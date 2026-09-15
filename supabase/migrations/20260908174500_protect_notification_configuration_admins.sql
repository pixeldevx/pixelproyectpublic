begin;

-- Keep the authorization root for notification configuration outside browser
-- control. Entries are provisioned deliberately by a trusted server/DB
-- administrator; never infer them from the browser-editable profile role.
drop policy if exists "notification configuration admins server read" on public.app_documents;
create policy "notification configuration admins server read"
on public.app_documents
as restrictive
for select
to authenticated
using (collection_path <> 'notification_configuration_admins');

drop policy if exists "notification configuration admins server insert" on public.app_documents;
create policy "notification configuration admins server insert"
on public.app_documents
as restrictive
for insert
to authenticated
with check (collection_path <> 'notification_configuration_admins');

drop policy if exists "notification configuration admins server update" on public.app_documents;
create policy "notification configuration admins server update"
on public.app_documents
as restrictive
for update
to authenticated
using (collection_path <> 'notification_configuration_admins')
with check (collection_path <> 'notification_configuration_admins');

drop policy if exists "notification configuration admins server delete" on public.app_documents;
create policy "notification configuration admins server delete"
on public.app_documents
as restrictive
for delete
to authenticated
using (collection_path <> 'notification_configuration_admins');

commit;
