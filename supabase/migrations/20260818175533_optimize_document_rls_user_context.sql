begin;

-- Build the current user's complete repository authorization context once per
-- statement. Project repositories can contain hundreds of rows, and resolving
-- the profile, role, organizations and project membership for every document
-- made otherwise valid PostgREST reads exceed the statement timeout.
create or replace function public.app_current_document_access_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with matching_people as materialized (
    select collection_path, doc_id, data
    from public.app_documents
    where collection_path in ('users', 'team_members')
      and (
        data ->> 'uid' = auth.uid()::text
        or data ->> 'authUserId' = auth.uid()::text
        or lower(data ->> 'email') = lower(auth.jwt() ->> 'email')
      )
  ), identity_values as (
    select auth.uid()::text as value
    union select lower(auth.jwt() ->> 'email')
    union select doc_id from matching_people
    union select data ->> 'uid' from matching_people
    union select data ->> 'authUserId' from matching_people
    union select lower(data ->> 'email') from matching_people
  ), current_context as (
    select
      coalesce(
        (
          select coalesce(nullif(data ->> 'role', ''), nullif(data ->> 'systemRole', ''))
          from matching_people
          order by case when collection_path = 'users' then 0 else 1 end
          limit 1
        ),
        'user'
      ) as user_role,
      coalesce(
        array_agg(distinct value) filter (where coalesce(value, '') <> ''),
        array[]::text[]
      ) as identities
    from identity_values
  ), current_organizations as (
    select distinct organization_id
    from matching_people as person
    cross join lateral (
      select person.data ->> 'organizationId' as organization_id
      union all
      select value
      from jsonb_array_elements_text(coalesce(person.data -> 'organizationIds', '[]'::jsonb))
    ) as organizations
    where coalesce(organization_id, '') <> ''
  ), configured_permission as (
    select permissions.data #>> array['roles', context.user_role, 'documentManageAccess'] as value
    from public.app_documents as permissions
    cross join current_context as context
    where permissions.collection_path = 'settings'
      and permissions.doc_id = 'rolePermissions'
    limit 1
  ), accessible_projects as materialized (
    select
      project.doc_id,
      coalesce(
        (
          select jsonb_agg(distinct organization_id)
          from (
            select project.data ->> 'organizationId' as organization_id
            union all
            select value
            from jsonb_array_elements_text(coalesce(project.data -> 'organizationIds', '[]'::jsonb))
          ) as project_organizations
          where coalesce(organization_id, '') <> ''
        ),
        '[]'::jsonb
      ) as organization_ids
    from public.app_documents as project
    cross join current_context as context
    where project.collection_path = 'projects'
      and (
        context.user_role = 'admin'
        or project.data ->> 'ownerId' = any(context.identities)
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(project.data -> 'assignedUsers', '[]'::jsonb)) as assigned(value)
          where assigned.value = any(context.identities)
            or lower(assigned.value) = any(context.identities)
        )
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(project.data -> 'assignedTeamMembers', '[]'::jsonb)) as assigned(value)
          where assigned.value = any(context.identities)
        )
        or (
          context.user_role in ('org_admin', 'manager', 'gerente', 'project_manager', 'coordinador', 'coordinator')
          and exists (
            select 1
            from (
              select project.data ->> 'organizationId' as organization_id
              union all
              select value
              from jsonb_array_elements_text(coalesce(project.data -> 'organizationIds', '[]'::jsonb))
            ) as project_organizations
            join current_organizations using (organization_id)
            where coalesce(project_organizations.organization_id, '') <> ''
          )
        )
      )
  )
  select jsonb_build_object(
    'userRole', context.user_role,
    'identities', to_jsonb(context.identities),
    'canManageAccess', coalesce(
      (
        select value::boolean
        from configured_permission
        where value in ('true', 'false')
      ),
      context.user_role in ('admin', 'org_admin', 'manager', 'coordinador'),
      false
    ),
    'accessibleProjectIds', coalesce(
      (select jsonb_agg(doc_id order by doc_id) from accessible_projects),
      '[]'::jsonb
    ),
    'projectOrganizations', coalesce(
      (select jsonb_object_agg(doc_id, organization_ids) from accessible_projects),
      '{}'::jsonb
    )
  )
  from current_context as context;
$$;

create or replace function public.app_can_access_project_document_with_context(
  document_collection_path text,
  document_id text,
  document_data jsonb,
  access_context jsonb
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
  current_identities text[];
  accessible_project_ids text[];
  source_organizations jsonb;
  destination_organizations jsonb;
begin
  select coalesce(array_agg(value), array[]::text[])
  into accessible_project_ids
  from jsonb_array_elements_text(
    coalesce(access_context -> 'accessibleProjectIds', '[]'::jsonb)
  ) as projects(value);

  if not destination_project_id = any(accessible_project_ids) then
    return false;
  end if;

  if destination_mode = 'repository' then
    if source_project_id is null
      or not source_project_id = any(accessible_project_ids) then
      return false;
    end if;

    if source_project_id <> destination_project_id then
      source_organizations := coalesce(
        access_context #> array['projectOrganizations', source_project_id],
        '[]'::jsonb
      );
      destination_organizations := coalesce(
        access_context #> array['projectOrganizations', destination_project_id],
        '[]'::jsonb
      );

      if not exists (
        select 1
        from jsonb_array_elements_text(source_organizations) as source(value)
        join jsonb_array_elements_text(destination_organizations) as destination(value)
          using (value)
      ) then
        return false;
      end if;
    end if;
  end if;

  -- Managers can see the complete repository after project and organization
  -- access have been confirmed. This early return avoids every folder lookup.
  if coalesce((access_context ->> 'canManageAccess')::boolean, false) then
    return true;
  end if;

  select coalesce(array_agg(value), array[]::text[])
  into current_identities
  from jsonb_array_elements_text(
    coalesce(access_context -> 'identities', '[]'::jsonb)
  ) as identities(value);

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

-- Keep the original helper compatible with server-side callers while routing
-- it through the same authorization rules.
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
  select public.app_can_access_project_document_with_context(
    document_collection_path,
    document_id,
    document_data,
    public.app_current_document_access_context()
  );
$$;

revoke all privileges
on function public.app_current_document_access_context()
from anon, public;

revoke all privileges
on function public.app_can_access_project_document_with_context(text, text, jsonb, jsonb)
from anon, public;

grant execute
on function public.app_current_document_access_context()
to authenticated, service_role;

grant execute
on function public.app_can_access_project_document_with_context(text, text, jsonb, jsonb)
to authenticated, service_role;

-- The context subquery becomes an initPlan: PostgreSQL resolves the current
-- user's role, organizations and project list once instead of once per row.
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
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
  )
);

analyze public.app_documents;

commit;
