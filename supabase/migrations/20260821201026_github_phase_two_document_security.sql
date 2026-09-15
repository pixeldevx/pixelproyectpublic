begin;

create index if not exists app_documents_github_events_task_idx
  on public.app_documents (collection_path, ((data ->> 'taskId')), updated_at desc)
  where collection_path ~ '^projects/[^/]+/githubEvents$';

create index if not exists app_documents_github_events_repository_idx
  on public.app_documents (((data ->> 'repositoryFullName')), updated_at desc)
  where collection_path ~ '^projects/[^/]+/githubEvents$';

create index if not exists app_documents_github_installation_idx
  on public.app_documents (((data ->> 'installationId')))
  where collection_path = 'github_installations';

drop policy if exists "github private documents are server only on select" on public.app_documents;
create policy "github private documents are server only on select"
on public.app_documents
as restrictive
for select
to authenticated
using (
  collection_path not in (
    'github_installations',
    'github_oauth_states',
    'github_webhook_deliveries'
  )
  and (
    collection_path !~ '^projects/[^/]+/githubEvents$'
    or public.app_can_access_project(split_part(collection_path, '/', 2))
  )
);

drop policy if exists "github private documents are server only on insert" on public.app_documents;
create policy "github private documents are server only on insert"
on public.app_documents
as restrictive
for insert
to authenticated
with check (
  collection_path not in (
    'github_installations',
    'github_oauth_states',
    'github_webhook_deliveries'
  )
  and collection_path !~ '^projects/[^/]+/githubEvents$'
);

drop policy if exists "github private documents are server only on update" on public.app_documents;
create policy "github private documents are server only on update"
on public.app_documents
as restrictive
for update
to authenticated
using (
  collection_path not in (
    'github_installations',
    'github_oauth_states',
    'github_webhook_deliveries'
  )
  and collection_path !~ '^projects/[^/]+/githubEvents$'
)
with check (
  collection_path not in (
    'github_installations',
    'github_oauth_states',
    'github_webhook_deliveries'
  )
  and collection_path !~ '^projects/[^/]+/githubEvents$'
);

drop policy if exists "github private documents are server only on delete" on public.app_documents;
create policy "github private documents are server only on delete"
on public.app_documents
as restrictive
for delete
to authenticated
using (
  collection_path not in (
    'github_installations',
    'github_oauth_states',
    'github_webhook_deliveries'
  )
  and collection_path !~ '^projects/[^/]+/githubEvents$'
);

comment on index public.app_documents_github_events_task_idx is
  'Supports the GitHub evidence timeline and task linkage without exposing installation credentials.';

commit;
