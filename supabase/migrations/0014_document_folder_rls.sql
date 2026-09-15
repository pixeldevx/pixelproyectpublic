begin;

create or replace function public.app_current_identity_values()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with matching_people as (
    select doc_id, data
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
  )
  select coalesce(array_agg(distinct value) filter (where coalesce(value, '') <> ''), array[]::text[])
  from identity_values;
$$;

create or replace function public.app_current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select coalesce(nullif(data ->> 'role', ''), nullif(data ->> 'systemRole', ''))
      from public.app_documents
      where collection_path in ('users', 'team_members')
        and (
          data ->> 'uid' = auth.uid()::text
          or data ->> 'authUserId' = auth.uid()::text
          or lower(data ->> 'email') = lower(auth.jwt() ->> 'email')
        )
      order by case when collection_path = 'users' then 0 else 1 end
      limit 1
    ),
    'user'
  );
$$;

create or replace function public.app_can_access_project(project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with current_context as (
    select
      public.app_current_identity_values() as identities,
      public.app_current_user_role() as user_role
  ), current_organizations as (
    select distinct organization_id
    from public.app_documents as person
    cross join lateral (
      select person.data ->> 'organizationId' as organization_id
      union all
      select value
      from jsonb_array_elements_text(coalesce(person.data -> 'organizationIds', '[]'::jsonb))
    ) as organizations
    where person.collection_path in ('users', 'team_members')
      and (
        person.data ->> 'uid' = auth.uid()::text
        or person.data ->> 'authUserId' = auth.uid()::text
        or lower(person.data ->> 'email') = lower(auth.jwt() ->> 'email')
      )
      and coalesce(organization_id, '') <> ''
  ), target_project as (
    select data
    from public.app_documents
    where collection_path = 'projects' and doc_id = project_id
    limit 1
  )
  select coalesce(
    exists (
      select 1
      from target_project as project
      cross join current_context as context
      where context.user_role = 'admin'
        or project.data ->> 'ownerId' = any(context.identities)
        or exists (
          select 1
          from jsonb_array_elements_text(coalesce(project.data -> 'assignedUsers', '[]'::jsonb)) as assigned(value)
          where assigned.value = any(context.identities)
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
    ),
    false
  );
$$;

create or replace function public.app_can_manage_document_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with context as (
    select public.app_current_user_role() as user_role
  ), configured as (
    select data #>> array['roles', context.user_role, 'documentManageAccess'] as value
    from public.app_documents
    cross join context
    where collection_path = 'settings' and doc_id = 'rolePermissions'
    limit 1
  )
  select coalesce(
    (select value::boolean from configured where value in ('true', 'false')),
    (select user_role in ('admin', 'org_admin', 'manager', 'coordinador') from context),
    false
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
  )
  select
    public.app_can_access_project(split_part(document_collection_path, '/', 2))
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
    );
$$;

revoke all privileges on function public.app_current_identity_values() from anon, public;
revoke all privileges on function public.app_current_user_role() from anon, public;
revoke all privileges on function public.app_can_access_project(text) from anon, public;
revoke all privileges on function public.app_can_manage_document_access() from anon, public;
revoke all privileges on function public.app_can_access_project_document(text, text, jsonb) from anon, public;

grant execute on function public.app_current_identity_values() to authenticated, service_role;
grant execute on function public.app_current_user_role() to authenticated, service_role;
grant execute on function public.app_can_access_project(text) to authenticated, service_role;
grant execute on function public.app_can_manage_document_access() to authenticated, service_role;
grant execute on function public.app_can_access_project_document(text, text, jsonb) to authenticated, service_role;

drop policy if exists "authenticated users can read app documents" on public.app_documents;
create policy "authenticated users can read app documents"
on public.app_documents
for select
to authenticated
using (
  public.is_pixel_project_member()
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
  public.is_pixel_project_member()
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
  public.is_pixel_project_member()
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document(collection_path, doc_id, data)
  )
)
with check (
  public.is_pixel_project_member()
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
  public.is_pixel_project_member()
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document(collection_path, doc_id, data)
  )
);

commit;
