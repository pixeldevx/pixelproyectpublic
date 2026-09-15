begin;

-- Keep one permissive policy per action. This preserves the optimized project
-- document rules and adds the narrowly scoped own-advance fallback without
-- making Postgres evaluate duplicate permissive policies on every request.
drop policy if exists "advance owners can read their administrative documents" on public.app_documents;
drop policy if exists "advance owners can create their administrative documents" on public.app_documents;
drop policy if exists "advance owners can update their administrative documents" on public.app_documents;

drop policy if exists "authenticated users can read app documents" on public.app_documents;
create policy "authenticated users can read app documents"
on public.app_documents
for select
to authenticated
using (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or public.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
);

drop policy if exists "authenticated users can create app documents" on public.app_documents;
create policy "authenticated users can create app documents"
on public.app_documents
for insert
to authenticated
with check (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or public.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
);

drop policy if exists "authenticated users can update app documents" on public.app_documents;
create policy "authenticated users can update app documents"
on public.app_documents
for update
to authenticated
using (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or public.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
)
with check (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or public.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
);

commit;
