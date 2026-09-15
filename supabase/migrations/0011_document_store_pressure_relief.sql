alter table public.app_documents
  add column if not exists collection_group text
  generated always as (reverse(split_part(reverse(collection_path), '/', 1))) stored;

create or replace function public.is_pixel_project_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.app_documents
      where collection_path = 'team_members'
        and lower(data ->> 'email') = lower(auth.jwt() ->> 'email')
    )
    or exists (
      select 1
      from public.app_documents
      where collection_path = 'users'
        and lower(data ->> 'email') = lower(auth.jwt() ->> 'email')
    ),
    false
  );
$$;

revoke all privileges on function public.is_pixel_project_member() from anon;
revoke all privileges on function public.is_pixel_project_member() from public;
grant execute on function public.is_pixel_project_member() to authenticated;
grant execute on function public.is_pixel_project_member() to service_role;

create index if not exists app_documents_collection_group_path_doc_idx
  on public.app_documents (collection_group, collection_path, doc_id);

create index if not exists app_documents_member_email_lookup_idx
  on public.app_documents (collection_path, lower(data ->> 'email'))
  where collection_path in ('users', 'team_members');

create index if not exists app_documents_group_assigned_to_idx
  on public.app_documents (collection_group, (data ->> 'assignedTo'))
  where data ? 'assignedTo';

create index if not exists app_documents_group_owner_id_idx
  on public.app_documents (collection_group, (data ->> 'ownerId'))
  where data ? 'ownerId';

create index if not exists app_documents_group_task_id_idx
  on public.app_documents (collection_group, (data ->> 'taskId'))
  where data ? 'taskId';

create index if not exists app_documents_path_parent_task_idx
  on public.app_documents (collection_path, (data ->> 'parentTaskId'))
  where data ? 'parentTaskId';

create index if not exists app_documents_path_status_idx
  on public.app_documents (collection_path, (data ->> 'status'))
  where data ? 'status';

drop policy if exists "authenticated users can read app documents" on public.app_documents;
create policy "authenticated users can read app documents"
on public.app_documents
for select
to authenticated
using ((select public.is_pixel_project_member()));

drop policy if exists "authenticated users can create app documents" on public.app_documents;
create policy "authenticated users can create app documents"
on public.app_documents
for insert
to authenticated
with check ((select public.is_pixel_project_member()));

drop policy if exists "authenticated users can update app documents" on public.app_documents;
create policy "authenticated users can update app documents"
on public.app_documents
for update
to authenticated
using ((select public.is_pixel_project_member()))
with check ((select public.is_pixel_project_member()));

drop policy if exists "authenticated users can delete app documents" on public.app_documents;
create policy "authenticated users can delete app documents"
on public.app_documents
for delete
to authenticated
using ((select public.is_pixel_project_member()));

analyze public.app_documents;
