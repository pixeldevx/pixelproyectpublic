-- Scrum story catalogs and visual-evidence metadata are written only by
-- authenticated server routes. Restrictive policies prevent a browser client
-- from bypassing project permissions or forging audit fields through the
-- generic app_documents policies.

drop policy if exists "scrum story protected collections read scope" on public.app_documents;
create policy "scrum story protected collections read scope"
on public.app_documents
as restrictive
for select
to authenticated
using (
  collection_path !~ '^projects/[^/]+/storyAiImportUsage$'
  and (
    collection_path !~ '^projects/[^/]+/scrumStoryCatalogs$'
    or public.app_can_access_project(split_part(collection_path, '/', 2))
  )
);

drop policy if exists "scrum story protected collections server insert" on public.app_documents;
create policy "scrum story protected collections server insert"
on public.app_documents
as restrictive
for insert
to authenticated
with check (
  collection_path !~ '^projects/[^/]+/(scrumStoryCatalogs|storyAiImportUsage)$'
  and coalesce(data ->> 'type', '') <> 'story_visual_evidence'
  and coalesce(data ->> 'documentKind', '') <> 'visual_evidence'
  and coalesce(data ->> 'scope', '') <> 'user_story_evidence'
);

drop policy if exists "scrum story protected collections server update" on public.app_documents;
create policy "scrum story protected collections server update"
on public.app_documents
as restrictive
for update
to authenticated
using (
  collection_path !~ '^projects/[^/]+/(scrumStoryCatalogs|storyAiImportUsage)$'
  and coalesce(data ->> 'type', '') <> 'story_visual_evidence'
  and coalesce(data ->> 'documentKind', '') <> 'visual_evidence'
  and coalesce(data ->> 'scope', '') <> 'user_story_evidence'
)
with check (
  collection_path !~ '^projects/[^/]+/(scrumStoryCatalogs|storyAiImportUsage)$'
  and coalesce(data ->> 'type', '') <> 'story_visual_evidence'
  and coalesce(data ->> 'documentKind', '') <> 'visual_evidence'
  and coalesce(data ->> 'scope', '') <> 'user_story_evidence'
);

drop policy if exists "scrum story protected collections server delete" on public.app_documents;
create policy "scrum story protected collections server delete"
on public.app_documents
as restrictive
for delete
to authenticated
using (
  collection_path !~ '^projects/[^/]+/(scrumStoryCatalogs|storyAiImportUsage)$'
  and coalesce(data ->> 'type', '') <> 'story_visual_evidence'
  and coalesce(data ->> 'documentKind', '') <> 'visual_evidence'
  and coalesce(data ->> 'scope', '') <> 'user_story_evidence'
);

create index if not exists app_documents_scrum_story_catalog_lookup_idx
  on public.app_documents (collection_path, ((data ->> 'catalogType')), ((data ->> 'active')))
  where collection_path ~ '^projects/[^/]+/scrumStoryCatalogs$';

create index if not exists app_documents_story_visual_evidence_lookup_idx
  on public.app_documents (collection_path, ((data ->> 'storyId')), ((data ->> 'order')))
  where collection_path ~ '^projects/[^/]+/documents$'
    and data ->> 'type' = 'story_visual_evidence';
