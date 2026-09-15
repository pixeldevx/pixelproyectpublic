begin;

create or replace function public.app_projects_share_organization(
  source_project_id text,
  destination_project_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with source_project as (
    select data
    from public.app_documents
    where collection_path = 'projects' and doc_id = source_project_id
    limit 1
  ), destination_project as (
    select data
    from public.app_documents
    where collection_path = 'projects' and doc_id = destination_project_id
    limit 1
  ), source_organizations as (
    select organization_id
    from source_project
    cross join lateral (
      select source_project.data ->> 'organizationId' as organization_id
      union all
      select value
      from jsonb_array_elements_text(coalesce(source_project.data -> 'organizationIds', '[]'::jsonb))
    ) as organizations
    where coalesce(organization_id, '') <> ''
  ), destination_organizations as (
    select organization_id
    from destination_project
    cross join lateral (
      select destination_project.data ->> 'organizationId' as organization_id
      union all
      select value
      from jsonb_array_elements_text(coalesce(destination_project.data -> 'organizationIds', '[]'::jsonb))
    ) as organizations
    where coalesce(organization_id, '') <> ''
  )
  select
    source_project_id = destination_project_id
    or exists (
      select 1
      from source_organizations
      join destination_organizations using (organization_id)
    );
$$;

create or replace function public.app_can_access_project_document(
  document_collection_path text,
  document_id text,
  document_data jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive access_chain as (
    select document_id as doc_id, document_data as data, 0 as depth
    union all
    select parent.doc_id, parent.data, access_chain.depth + 1
    from access_chain
    join public.app_documents as parent
      on parent.collection_path = document_collection_path
     and parent.doc_id = access_chain.data ->> 'parentFolderId'
    where access_chain.depth < 100
  ), context as (
    select public.app_current_identity_values() as identities
  ), document_context as (
    select
      split_part(document_collection_path, '/', 2) as destination_project_id,
      nullif(document_data ->> 'sourceProjectId', '') as source_project_id,
      coalesce(document_data ->> 'documentDestinationMode', 'task') as destination_mode
  )
  select
    public.app_can_access_project(document_context.destination_project_id)
    and (
      document_context.destination_mode <> 'repository'
      or (
        document_context.source_project_id is not null
        and public.app_can_access_project(document_context.source_project_id)
        and public.app_projects_share_organization(
          document_context.source_project_id,
          document_context.destination_project_id
        )
      )
    )
    and (
      public.app_can_manage_document_access()
      or not exists (
        select 1
        from access_chain
        cross join context
        where access_chain.data ->> 'accessMode' = 'restricted'
          and not (
            (access_chain.depth = 0 and access_chain.data ->> 'uploadedBy' = any(context.identities))
            or exists (
              select 1
              from jsonb_array_elements_text(coalesce(access_chain.data -> 'allowedMemberIds', '[]'::jsonb)) as allowed(value)
              where allowed.value = any(context.identities)
                or lower(allowed.value) = any(context.identities)
            )
          )
      )
    )
  from document_context;
$$;

revoke all privileges on function public.app_projects_share_organization(text, text) from anon, public;
grant execute on function public.app_projects_share_organization(text, text) to authenticated, service_role;

commit;
