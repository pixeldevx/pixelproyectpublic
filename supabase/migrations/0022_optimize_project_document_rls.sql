begin;

-- Avoid rebuilding the complete folder ancestry for every document when the
-- current user can already manage document access. The previous SQL function
-- allowed the planner to evaluate the recursive CTE even when the permission
-- branch was enough, which made medium-sized repositories exceed PostgREST's
-- statement timeout.
create or replace function public.app_can_access_project_document(
  document_collection_path text,
  document_id text,
  document_data jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  destination_project_id text := split_part(document_collection_path, '/', 2);
  source_project_id text := nullif(document_data ->> 'sourceProjectId', '');
  destination_mode text := coalesce(document_data ->> 'documentDestinationMode', 'task');
  user_role_value text;
  current_identities text[];
  destination_project_exists boolean;
begin
  user_role_value := public.app_current_user_role();

  -- Global administrators can access every existing project. Repository-mode
  -- documents still keep the organization boundary that prevents a document
  -- from being routed between unrelated organizations.
  if user_role_value = 'admin' then
    select exists (
      select 1
      from public.app_documents
      where collection_path = 'projects'
        and doc_id = destination_project_id
    )
    into destination_project_exists;

    if not destination_project_exists then
      return false;
    end if;

    if destination_mode <> 'repository' then
      return true;
    end if;

    return source_project_id is not null
      and public.app_projects_share_organization(
        source_project_id,
        destination_project_id
      );
  end if;

  if not public.app_can_access_project(destination_project_id) then
    return false;
  end if;

  if destination_mode = 'repository' and not (
    source_project_id is not null
    and public.app_can_access_project(source_project_id)
    and public.app_projects_share_organization(
      source_project_id,
      destination_project_id
    )
  ) then
    return false;
  end if;

  -- Users with the explicit document-management permission do not need the
  -- per-folder ancestry scan after their project access has been confirmed.
  if public.app_can_manage_document_access() then
    return true;
  end if;

  current_identities := public.app_current_identity_values();

  return not exists (
    with recursive access_chain as (
      select document_id as doc_id, document_data as data, 0 as depth
      union all
      select parent.doc_id, parent.data, access_chain.depth + 1
      from access_chain
      join public.app_documents as parent
        on parent.collection_path = document_collection_path
       and parent.doc_id = access_chain.data ->> 'parentFolderId'
      where access_chain.depth < 100
    )
    select 1
    from access_chain
    where access_chain.data ->> 'accessMode' = 'restricted'
      and not (
        (
          access_chain.depth = 0
          and access_chain.data ->> 'uploadedBy' = any(current_identities)
        )
        or exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(access_chain.data -> 'allowedMemberIds', '[]'::jsonb)
          ) as allowed(value)
          where allowed.value = any(current_identities)
            or lower(allowed.value) = any(current_identities)
        )
      )
  );
end;
$$;

revoke all privileges
on function public.app_can_access_project_document(text, text, jsonb)
from anon, public;

grant execute
on function public.app_can_access_project_document(text, text, jsonb)
to authenticated, service_role;

-- These helpers do not depend on the document row. Wrapping them in SELECT
-- creates an initPlan so Postgres evaluates membership once per statement,
-- following Supabase's RLS performance guidance.
drop policy if exists "authenticated users can read app documents" on public.app_documents;
create policy "authenticated users can read app documents"
on public.app_documents
for select
to authenticated
using (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document(collection_path, doc_id, data)
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
    or public.app_can_access_project_document(collection_path, doc_id, data)
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
    or public.app_can_access_project_document(collection_path, doc_id, data)
  )
)
with check (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document(collection_path, doc_id, data)
  )
);

drop policy if exists "authenticated users can delete app documents" on public.app_documents;
create policy "authenticated users can delete app documents"
on public.app_documents
for delete
to authenticated
using (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document(collection_path, doc_id, data)
  )
);

analyze public.app_documents;

commit;
