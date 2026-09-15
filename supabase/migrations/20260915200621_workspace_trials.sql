-- One database, independent workspaces. Membership is authoritative and never
-- comes from user-editable Auth metadata or application profile JSON.
-- Postgres Changes cannot authorize deleted rows with RLS. Publish only the
-- events whose row can still be authorized; clients refresh deletions by query.
alter publication supabase_realtime set (publish = 'insert, update');
create table public.app_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id),
  name text not null check (char_length(name) between 2 and 100),
  status text not null default 'trial' check (status in ('trial','active','suspended')),
  trial_ends_at timestamptz,
  legacy_storage boolean not null default false,
  created_at timestamptz not null default now(),
  check (status <> 'trial' or trial_ends_at is not null)
);
create table public.app_workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.app_workspaces(id),
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now()
);
create index app_workspace_members_workspace_idx on public.app_workspace_members(workspace_id);
alter table public.app_workspaces enable row level security;
alter table public.app_workspace_members enable row level security;
revoke all on public.app_workspaces, public.app_workspace_members from public, anon, authenticated;
grant select on public.app_workspaces, public.app_workspace_members to authenticated;
grant all on public.app_workspaces, public.app_workspace_members to service_role;

create or replace function private.current_workspace_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select workspace_id from public.app_workspace_members where user_id = (select auth.uid());
$$;
create or replace function private.workspace_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.app_workspaces w
    join public.app_workspace_members m on m.workspace_id = w.id
    where m.user_id = (select auth.uid())
      and (w.status = 'active' or (w.status = 'trial' and w.trial_ends_at > now()))
  );
$$;
create or replace function private.workspace_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_workspace_members
    where user_id = (select auth.uid()) and role in ('owner','admin'));
$$;
revoke all on function private.current_workspace_id(), private.workspace_is_active(), private.workspace_is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_workspace_id(), private.workspace_is_active(), private.workspace_is_admin() to authenticated;
create policy workspace_self on public.app_workspaces for select to authenticated
using (id = (select private.current_workspace_id()));
create policy membership_self on public.app_workspace_members for select to authenticated
using (user_id = (select auth.uid()));

alter table public.app_documents add column tenant_id uuid references public.app_workspaces(id);
alter table public.project_spatial_layers add column tenant_id uuid references public.app_workspaces(id);
alter table public.project_spatial_features add column tenant_id uuid references public.app_workspaces(id);
alter table public.project_spatial_annotations add column tenant_id uuid references public.app_workspaces(id);
alter table public.user_reassignment_audit add column tenant_id uuid references public.app_workspaces(id);

-- Preserve the already installed instance, selecting its real administrator.
-- Abort rather than guess if this migration is run against a different dataset.
do $$
declare owner_record record; workspace uuid; owner_count integer;
begin
  select count(*) into owner_count from auth.users u where exists (
    select 1 from public.app_documents d where d.collection_path='users'
      and lower(d.data->>'email')=lower(u.email) and d.data->>'role'='admin');
  if owner_count <> 1 then raise exception 'Expected exactly one existing administrator; review migration before applying'; end if;
  select u.id,u.email into owner_record from auth.users u where exists (
    select 1 from public.app_documents d where d.collection_path='users'
      and lower(d.data->>'email')=lower(u.email) and d.data->>'role'='admin');
  insert into public.app_workspaces(owner_id,name,status,legacy_storage)
  values(owner_record.id,'Pixel Project','active',true) returning id into workspace;
  insert into public.app_workspace_members(user_id,workspace_id,role) values(owner_record.id,workspace,'owner');
  update public.app_documents set tenant_id=workspace;
  update public.project_spatial_layers set tenant_id=workspace;
  update public.project_spatial_features set tenant_id=workspace;
  update public.project_spatial_annotations set tenant_id=workspace;
  update public.user_reassignment_audit set tenant_id=workspace;
  update public.app_documents set doc_id=owner_record.id::text,
    data=data || jsonb_build_object('uid',owner_record.id,'role','admin','organizationId',workspace,'organizationIds',jsonb_build_array(workspace))
  where collection_path='users' and lower(data->>'email')=lower(owner_record.email);
  update public.app_documents set data=data || jsonb_build_object('organizationId',workspace,'organizationIds',jsonb_build_array(workspace))
  where collection_path='team_members';
  insert into public.app_documents(tenant_id,collection_path,doc_id,data)
  values(workspace,'organizations',workspace::text,jsonb_build_object('name','Pixel Project','createdAt',now()));
end;
$$;

alter table public.app_documents drop constraint app_documents_pkey;
alter table public.app_documents add primary key(tenant_id,collection_path,doc_id);
do $$
declare tab text;
begin
  foreach tab in array array['app_documents','project_spatial_layers','project_spatial_features','project_spatial_annotations','user_reassignment_audit'] loop
    execute format('alter table public.%I alter column tenant_id set not null',tab);
    execute format('alter table public.%I alter column tenant_id set default private.current_workspace_id()',tab);
    execute format('create index %I on public.%I(tenant_id)',tab || '_tenant_idx',tab);
  end loop;
end;
$$;
create index app_documents_tenant_group_idx on public.app_documents(tenant_id,collection_group);
alter table public.project_spatial_layers add unique(tenant_id,id);
alter table public.project_spatial_features add constraint spatial_feature_tenant_layer_fk
  foreign key(tenant_id,layer_id) references public.project_spatial_layers(tenant_id,id) on delete cascade;

-- Replace the old single-instance grant; keep server-only collection restrictions.
drop policy "authenticated users can read app documents" on public.app_documents;
drop policy "authenticated users can create app documents" on public.app_documents;
drop policy "authenticated users can update app documents" on public.app_documents;
drop policy "authenticated users can delete app documents" on public.app_documents;
create policy workspace_documents_read on public.app_documents for select to authenticated
using (tenant_id=(select private.current_workspace_id()) and
  ((select private.workspace_is_active()) or (collection_path='users' and doc_id=(select auth.uid())::text)));
create policy workspace_documents_insert on public.app_documents for insert to authenticated
with check (tenant_id=(select private.current_workspace_id()) and (select private.workspace_is_active()));
create policy workspace_documents_update on public.app_documents for update to authenticated
using (tenant_id=(select private.current_workspace_id()) and (select private.workspace_is_active()))
with check (tenant_id=(select private.current_workspace_id()) and (select private.workspace_is_active()));
create policy workspace_documents_delete on public.app_documents for delete to authenticated
using (tenant_id=(select private.current_workspace_id()) and (select private.workspace_is_active()));
-- Defense in depth against future permissive policies.
create policy workspace_documents_boundary on public.app_documents as restrictive for all to authenticated
using (tenant_id=(select private.current_workspace_id())) with check (tenant_id=(select private.current_workspace_id()));
revoke all on public.app_documents from anon;

-- A profile cannot become an authorization source through a browser write.
create or replace function private.protect_workspace_document()
returns trigger language plpgsql security invoker set search_path='' as $$
declare prior_profile jsonb;
begin
  if current_user not in ('anon','authenticated') then return coalesce(new,old); end if;
  if tg_op='UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.collection_path is distinct from old.collection_path or new.doc_id is distinct from old.doc_id) then
    raise exception 'Document identity cannot be changed' using errcode='42501';
  end if;
  if coalesce(new.collection_path,old.collection_path)='users' then
    if tg_op = 'DELETE' or new.doc_id <> auth.uid()::text then
      raise exception 'User access is managed by the workspace server' using errcode='42501';
    end if;
    if tg_op = 'INSERT' then
      select data into prior_profile from public.app_documents where tenant_id=new.tenant_id and collection_path='users' and doc_id=new.doc_id;
      if prior_profile is null then raise exception 'User access is managed by the workspace server' using errcode='42501'; end if;
    else prior_profile:=old.data; end if;
    if (new.data - array['displayName','photoURL','phone','signatureUrl','signatureStoragePath','signatureUpdatedAt','updatedAt','lastLoginAt','identificationType','identificationNumber','address','city','bankAccounts'])
      is distinct from (prior_profile - array['displayName','photoURL','phone','signatureUrl','signatureStoragePath','signatureUpdatedAt','updatedAt','lastLoginAt','identificationType','identificationNumber','address','city','bankAccounts']) then
      raise exception 'Profile access fields are read only' using errcode='42501';
    end if;
  end if;
  if coalesce(new.collection_path,old.collection_path) in ('settings','app_config','roles','organizations') and not private.workspace_is_admin() then
    raise exception 'Workspace administrator required' using errcode='42501';
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function private.protect_workspace_document() from public, anon, authenticated;
create trigger protect_workspace_document before insert or update or delete on public.app_documents
for each row execute function private.protect_workspace_document();

-- Legacy read helpers now execute with the caller's RLS scope, never as postgres.
do $$
declare fn record;
begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in (
      'app_can_access_project','app_can_access_project_document','app_can_access_project_document_with_context',
      'app_can_manage_document_access','app_current_document_access_context','app_current_identity_values',
      'app_current_user_role','app_projects_share_organization','app_can_access_owned_advance_document') loop
    execute format('alter function %s security invoker',fn.signature);
  end loop;
end;
$$;
create or replace function public.is_pixel_project_member()
returns boolean language sql stable security invoker set search_path='' as $$
  select private.workspace_is_active();
$$;
do $$
declare tab text;
begin
  foreach tab in array array['project_spatial_layers','project_spatial_features','project_spatial_annotations'] loop
    execute format('create policy workspace_boundary on public.%I as restrictive for all to authenticated using (tenant_id=(select private.current_workspace_id()) and (select private.workspace_is_active())) with check (tenant_id=(select private.current_workspace_id()) and (select private.workspace_is_active()))',tab);
    execute format('revoke all on public.%I from anon',tab);
  end loop;
end;
$$;

create or replace function private.can_access_workspace_file(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.app_workspace_members m join public.app_workspaces w on w.id=m.workspace_id
    where m.user_id=(select auth.uid())
      and (w.status='active' or (w.status='trial' and w.trial_ends_at>now()))
      and (object_name like 'workspaces/' || w.id::text || '/%'
        or (w.legacy_storage and object_name not like 'workspaces/%'))
      and object_name !~ '(^|/)\.\.(/|$)'
  );
$$;
revoke all on function private.can_access_workspace_file(text) from public,anon;
grant execute on function private.can_access_workspace_file(text) to authenticated;
create policy workspace_storage_boundary on storage.objects as restrictive for all to authenticated
using (bucket_id='pixel-project-files' and private.can_access_workspace_file(name))
with check (bucket_id='pixel-project-files' and private.can_access_workspace_file(name));

create or replace function public.my_workspace()
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',w.id,'name',w.name,'status',w.status,'trial_ends_at',w.trial_ends_at,
    'role',case when m.role in ('owner','admin') then 'admin' else 'user' end,'organization_id',w.id,
    'is_platform_admin',w.legacy_storage and w.owner_id=(select auth.uid()))
  from public.app_workspace_members m join public.app_workspaces w on w.id=m.workspace_id
  where m.user_id=(select auth.uid());
$$;
revoke all on function public.my_workspace() from public,anon;
grant execute on function public.my_workspace() to authenticated;

create or replace function private.ensure_trial_workspace(workspace_name text, display_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account auth.users%rowtype; workspace uuid; clean_name text; org_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Lock the account, making concurrent registration/retries create exactly one workspace.
  select * into account from auth.users where id=auth.uid() for update;
  if account.id is null or account.email_confirmed_at is null or account.is_anonymous then
    raise exception 'Confirm your email before creating a workspace' using errcode='42501';
  end if;
  select workspace_id into workspace from public.app_workspace_members where user_id=account.id;
  if workspace is null then
    org_name := left(btrim(coalesce(workspace_name,'')),100);
    if char_length(org_name)<2 then org_name:='Mi organización'; end if;
    clean_name := left(btrim(coalesce(display_name,'')),100);
    if clean_name='' then clean_name:=split_part(account.email,'@',1); end if;
    insert into public.app_workspaces(owner_id,name,status,trial_ends_at)
    values(account.id,org_name,'trial',now()+interval '14 days') returning id into workspace;
    insert into public.app_workspace_members(user_id,workspace_id,role) values(account.id,workspace,'owner');
    insert into public.app_documents(tenant_id,collection_path,doc_id,data) values
      (workspace,'organizations',workspace::text,jsonb_build_object('name',org_name,'createdAt',now(),'updatedAt',now())),
      (workspace,'users',account.id::text,jsonb_build_object('uid',account.id,'email',lower(account.email),'displayName',clean_name,
        'role','admin','organizationId',workspace,'organizationIds',jsonb_build_array(workspace),'isPreRegistered',false,'createdAt',now())),
      (workspace,'team_members',account.id::text,jsonb_build_object('name',clean_name,'email',lower(account.email),'authUserId',account.id,
        'role','Gerente de Proyecto','systemRole','admin','organizationId',workspace,'organizationIds',jsonb_build_array(workspace),'createdAt',now())),
      (workspace,'app_config','branding',jsonb_build_object('companyName',org_name));
    -- Copy only immutable product defaults, never another workspace's records.
    insert into public.app_documents(tenant_id,collection_path,doc_id,data)
    select workspace,'roles',role_id,jsonb_build_object('name',role_name,'isDefault',true,'createdAt',now())
    from (values ('default-project-manager','Gerente de Proyecto'),('default-coordinator','Coordinador'),
      ('default-administrative','Administrativo'),('default-field-operator','Operador de Campo'),('default-reviewer','Revisor')) defaults(role_id,role_name);
  end if;
  return (select jsonb_build_object('id',w.id,'name',w.name,'status',w.status,'trial_ends_at',w.trial_ends_at,
    'role',case when m.role in ('owner','admin') then 'admin' else 'user' end,'organization_id',w.id,
    'is_platform_admin',w.legacy_storage and w.owner_id=(select auth.uid()))
    from public.app_workspaces w join public.app_workspace_members m on m.workspace_id=w.id where m.user_id=account.id);
end;
$$;
revoke all on function private.ensure_trial_workspace(text,text) from public,anon;
grant execute on function private.ensure_trial_workspace(text,text) to authenticated;
create or replace function public.ensure_trial_workspace(workspace_name text default '', display_name text default '')
returns jsonb language sql security invoker set search_path='' as $$
  select private.ensure_trial_workspace(workspace_name,display_name);
$$;
revoke all on function public.ensure_trial_workspace(text,text) from public,anon;
grant execute on function public.ensure_trial_workspace(text,text) to authenticated;

notify pgrst,'reload schema';

-- Server-only atomic operations carry the verified tenant into every SQL read,
-- update and idempotency record. This private view keeps legacy business logic
-- scoped even though the API uses a service key.
create view private.contractor_workspace_documents with (security_invoker=true) as
select * from public.app_documents
where tenant_id=nullif(current_setting('pixel.server_workspace',true),'')::uuid
with local check option;
revoke all on private.contractor_workspace_documents from public,anon,authenticated;
grant select,update on private.contractor_workspace_documents to service_role;

alter table private.contractor_route_operations add column tenant_id uuid references public.app_workspaces(id);
alter table private.contractor_account_action_operations add column tenant_id uuid references public.app_workspaces(id);
do $$
declare tab text; workspace uuid;
begin
  select id into workspace from public.app_workspaces where legacy_storage;
  foreach tab in array array['contractor_route_operations','contractor_account_action_operations'] loop
    execute format('update private.%I set tenant_id=$1',tab) using workspace;
    execute format('alter table private.%I alter column tenant_id set not null',tab);
    execute format('alter table private.%I alter column tenant_id set default nullif(current_setting(''pixel.server_workspace'',true),'''')::uuid',tab);
    execute format('alter table private.%I drop constraint %I',tab,tab||'_pkey');
    execute format('alter table private.%I add primary key(tenant_id,operation_id)',tab);
  end loop;
end;
$$;

drop function public.app_apply_contractor_account_action(text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,text,jsonb,text,text,jsonb);
CREATE OR REPLACE FUNCTION public.app_apply_contractor_account_action(p_tenant_id uuid, p_project_id text, p_account_id text, p_action text, p_operation_id text, p_expected_status text, p_expected_stage text, p_expected_assignment_event_id text, p_organization_id text, p_expected_project_config jsonb, p_expected_organization_config jsonb, p_actor jsonb, p_is_global_admin boolean, p_current_owner_aliases jsonb, p_next_assignment jsonb, p_comment text DEFAULT ''::text, p_signature jsonb DEFAULT NULL::jsonb, p_accounting_reference text DEFAULT NULL::text, p_accounting_note text DEFAULT NULL::text, p_payment_support jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_collection_path text;
  v_project jsonb;
  v_organization jsonb := '{}'::jsonb;
  v_project_config jsonb;
  v_organization_config jsonb;
  v_account jsonb;
  v_payment_document jsonb;
  v_verified_payment_support jsonb;
  v_request_payload jsonb;
  v_existing_operation private.contractor_account_action_operations%rowtype;
  v_current_status text;
  v_current_stage text;
  v_current_assignment_event_id text;
  v_current_config_key text;
  v_next_config_key text;
  v_current_configured_id text;
  v_expected_configured_id text;
  v_expected_approver_id text;
  v_locked_primary_organization_id text;
  v_next_status text;
  v_assignment_event_id text;
  v_assignment_id text;
  v_assignment_stage text;
  v_is_owner boolean := false;
  v_has_persisted_owner boolean := false;
  v_owner_aliases jsonb;
  v_requester_aliases jsonb;
  v_now timestamptz := clock_timestamp();
  v_patch jsonb := '{}'::jsonb;
  v_history jsonb;
  v_history_entry jsonb;
  v_result_assignment jsonb := null;
  v_result jsonb;
begin
  if p_tenant_id is null or not exists (select 1 from public.app_workspaces where id=p_tenant_id and (status='active' or (status='trial' and trial_ends_at>now()))) then
    raise exception 'Workspace is not active' using errcode='42501';
  end if;
  perform set_config('pixel.server_workspace',p_tenant_id::text,true);
  if coalesce(btrim(p_project_id), '') = ''
     or coalesce(btrim(p_account_id), '') = ''
     or coalesce(btrim(p_operation_id), '') !~ '^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,119}$'
     or coalesce(p_action, '') not in ('approve', 'account', 'pay', 'return', 'reject', 'reactivate')
     or coalesce(btrim(p_expected_status), '') = ''
     or coalesce(btrim(p_expected_stage), '') = ''
     or coalesce(btrim(p_actor ->> 'id'), '') = ''
     or coalesce(btrim(p_actor ->> 'email'), '') = ''
     or jsonb_typeof(coalesce(p_actor, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_actor -> 'aliases', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_current_owner_aliases, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_next_assignment, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_expected_project_config, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_expected_organization_config, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('applied', false, 'reason', 'invalid_request');
  end if;

  v_request_payload := jsonb_build_object(
    'projectId', btrim(p_project_id),
    'accountId', btrim(p_account_id),
    'action', p_action,
    'expectedStatus', btrim(p_expected_status),
    'expectedStage', btrim(p_expected_stage),
    'expectedAssignmentEventId', coalesce(nullif(btrim(p_expected_assignment_event_id), ''), ''),
    'comment', coalesce(btrim(p_comment), ''),
    'accountingReference', nullif(btrim(p_accounting_reference), ''),
    'accountingNote', nullif(btrim(p_accounting_note), ''),
    'paymentDocumentId', nullif(btrim(p_payment_support ->> 'documentId'), '')
  );

  insert into private.contractor_account_action_operations (
    operation_id,
    project_id,
    account_id,
    action,
    request_payload,
    actor_id
  ) values (
    btrim(p_operation_id),
    btrim(p_project_id),
    btrim(p_account_id),
    p_action,
    v_request_payload,
    btrim(p_actor ->> 'id')
  )
  on conflict do nothing;

  if not found then
    select *
      into v_existing_operation
      from private.contractor_account_action_operations
     where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id)
     for share;

    if v_existing_operation.actor_id is distinct from btrim(p_actor ->> 'id')
       or v_existing_operation.request_payload is distinct from v_request_payload then
      return jsonb_build_object('applied', false, 'reason', 'operation_conflict');
    end if;
    if v_existing_operation.result is not null then
      return v_existing_operation.result || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('applied', false, 'reason', 'operation_in_progress');
  end if;

  -- Route edits use the same organization -> project -> account lock order.
  if coalesce(btrim(p_organization_id), '') <> '' then
    select document.data
      into v_organization
      from private.contractor_workspace_documents as document
     where document.collection_path = 'organizations'
       and document.doc_id = btrim(p_organization_id)
     for update;

    if not found then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'stale_organization');
    end if;
  end if;

  select document.data
    into v_project
    from private.contractor_workspace_documents as document
   where document.collection_path = 'projects'
     and document.doc_id = btrim(p_project_id)
   for update;

  if not found then
    delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'project_not_found');
  end if;

  select btrim(organization_id.value)
    into v_locked_primary_organization_id
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_project -> 'organizationIds') = 'array'
        then v_project -> 'organizationIds'
        else '[]'::jsonb
      end
    ) with ordinality as organization_id(value, ordinal)
   where coalesce(btrim(organization_id.value), '') <> ''
   order by organization_id.ordinal
   limit 1;
  v_locked_primary_organization_id := coalesce(
    v_locked_primary_organization_id,
    nullif(btrim(v_project ->> 'organizationId'), '')
  );
  if coalesce(v_locked_primary_organization_id, '') is distinct from coalesce(nullif(btrim(p_organization_id), ''), '') then
    delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'stale_organization');
  end if;

  v_project_config := case
    when jsonb_typeof(v_project -> 'contractorAccountApprovalConfig') = 'object'
      then v_project -> 'contractorAccountApprovalConfig'
    else '{}'::jsonb
  end;
  v_organization_config := case
    when jsonb_typeof(v_organization -> 'contractorAccountApprovalConfig') = 'object'
      then v_organization -> 'contractorAccountApprovalConfig'
    else '{}'::jsonb
  end;

  if v_project_config is distinct from coalesce(p_expected_project_config, '{}'::jsonb)
     or v_organization_config is distinct from coalesce(p_expected_organization_config, '{}'::jsonb) then
    delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'stale_config');
  end if;

  v_collection_path := format('projects/%s/contractorPaymentRequests', btrim(p_project_id));
  select document.data
    into v_account
    from private.contractor_workspace_documents as document
   where document.collection_path = v_collection_path
     and document.doc_id = btrim(p_account_id)
   for update;

  if not found then
    delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;

  v_current_status := coalesce(nullif(btrim(v_account ->> 'status'), ''), 'submitted');
  v_current_stage := coalesce(nullif(btrim(v_account ->> 'currentApprovalStage'), ''), v_current_status);
  v_current_assignment_event_id := coalesce(nullif(btrim(v_account ->> 'currentAssignmentEventId'), ''), '');

  if v_current_status is distinct from btrim(p_expected_status)
     or v_current_stage is distinct from btrim(p_expected_stage)
     or v_current_assignment_event_id is distinct from coalesce(nullif(btrim(p_expected_assignment_event_id), ''), '') then
    delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
    return jsonb_build_object(
      'applied', false,
      'reason', 'stale_account',
      'currentStatus', v_current_status,
      'currentStage', v_current_stage,
      'currentAssignmentEventId', nullif(v_current_assignment_event_id, '')
    );
  end if;

  v_current_config_key := case v_current_status
    when 'submitted' then 'immediateBossId'
    when 'boss_approved' then 'operationsManagerId'
    when 'operations_approved' then 'qualityComplianceId'
    when 'quality_approved' then 'humanTalentId'
    when 'hr_approved' then 'accountingId'
    when 'accounted' then 'administrationId'
    else null
  end;
  if v_current_config_key = 'administrationId' then
    v_current_configured_id := coalesce(
      nullif(btrim(v_project_config ->> 'administrationId'), ''),
      nullif(btrim(v_organization_config ->> 'administrationId'), ''),
      nullif(btrim(v_project_config ->> 'accountingId'), ''),
      nullif(btrim(v_organization_config ->> 'accountingId'), '')
    );
  elsif v_current_config_key is not null then
    v_current_configured_id := coalesce(
      nullif(btrim(v_project_config ->> v_current_config_key), ''),
      nullif(btrim(v_organization_config ->> v_current_config_key), '')
    );
  end if;

  v_owner_aliases := jsonb_build_array(
    v_account ->> 'currentApproverId',
    v_account ->> 'currentApproverMemberId',
    v_account ->> 'currentApproverAuthUserId',
    v_account ->> 'currentApproverEmail'
  );
  select exists (
    select 1 from jsonb_array_elements_text(v_owner_aliases) as owner_alias(value)
     where coalesce(btrim(owner_alias.value), '') <> ''
  ) into v_has_persisted_owner;
  if not v_has_persisted_owner and v_current_configured_id is not null then
    v_owner_aliases := v_owner_aliases || jsonb_build_array(v_current_configured_id);
  end if;
  v_owner_aliases := v_owner_aliases || coalesce(p_current_owner_aliases, '[]'::jsonb);
  v_expected_approver_id := coalesce(
    nullif(btrim(v_account ->> 'currentApproverId'), ''),
    v_current_configured_id
  );

  select exists (
    select 1
      from jsonb_array_elements_text(coalesce(p_actor -> 'aliases', '[]'::jsonb)) as actor_alias(value)
      cross join jsonb_array_elements_text(v_owner_aliases) as owner_alias(value)
     where coalesce(btrim(actor_alias.value), '') <> ''
       and coalesce(btrim(owner_alias.value), '') <> ''
       and lower(btrim(actor_alias.value)) = lower(btrim(owner_alias.value))
  ) into v_is_owner;

  if not coalesce(p_is_global_admin, false) and not v_is_owner then
    delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'forbidden');
  end if;

  if p_action = 'reactivate' then
    if not coalesce(p_is_global_admin, false) or v_current_status <> 'returned' then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    v_next_status := nullif(btrim(v_account ->> 'returnedFromStage'), '');
    if v_next_status is null or v_next_status not in (
      'submitted', 'boss_approved', 'operations_approved',
      'quality_approved', 'hr_approved', 'accounted'
    ) then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_returned_stage');
    end if;
  elsif p_action = 'approve' then
    v_next_status := case v_current_status
      when 'submitted' then 'boss_approved'
      when 'boss_approved' then 'operations_approved'
      when 'operations_approved' then 'quality_approved'
      when 'quality_approved' then 'hr_approved'
      else null
    end;
    if v_next_status is null then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
  elsif p_action = 'account' then
    if v_current_status <> 'hr_approved' then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    if coalesce(btrim(p_accounting_reference), '') = '' then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_accounting_reference');
    end if;
    v_next_status := 'accounted';
  elsif p_action = 'pay' then
    if v_current_status <> 'accounted' then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    if coalesce(jsonb_typeof(p_payment_support), '') <> 'object'
       or coalesce(btrim(p_payment_support ->> 'documentId'), '') = ''
       or coalesce(btrim(p_payment_support ->> 'storagePath'), '') = '' then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_payment_support');
    end if;
    v_next_status := 'paid';
  elsif p_action in ('return', 'reject') then
    if v_current_status not in (
      'submitted', 'boss_approved', 'operations_approved',
      'quality_approved', 'hr_approved', 'accounted'
    ) then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    if coalesce(btrim(p_comment), '') = '' then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_comment');
    end if;
    v_next_status := case when p_action = 'return' then 'returned' else 'rejected' end;
  end if;

  if p_action in ('approve', 'account', 'pay') then
    if coalesce(jsonb_typeof(p_signature), '') <> 'object'
       or coalesce(btrim(p_signature ->> 'signatureStoragePath'), '') = ''
       or position(
         '/profile_signatures/' || btrim(p_actor ->> 'id') || '_'
         in '/' || btrim(p_signature ->> 'signatureStoragePath')
       ) = 0
       or lower(coalesce(btrim(p_signature ->> 'signerUserId'), '')) <> lower(btrim(p_actor ->> 'id'))
       or lower(coalesce(btrim(p_signature ->> 'email'), '')) <> lower(btrim(p_actor ->> 'email')) then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_signature');
    end if;
  end if;

  if p_action = 'pay' then
    select document.data
      into v_payment_document
      from private.contractor_workspace_documents as document
     where document.collection_path = format('projects/%s/documents', btrim(p_project_id))
       and document.doc_id = btrim(p_payment_support ->> 'documentId')
     for share;

    if not found
       or coalesce(btrim(v_payment_document ->> 'projectId'), '') <> btrim(p_project_id)
       or coalesce(btrim(v_payment_document ->> 'contractorAccountId'), '') <> btrim(p_account_id)
       or coalesce(btrim(v_payment_document ->> 'contractorAccountDocumentKind'), '') <> 'paymentSupport'
       or coalesce(btrim(v_payment_document ->> 'documentContext'), '') <> 'contractorAccountPayment'
       or coalesce(btrim(v_payment_document ->> 'administrativeRequestType'), '') <> 'contractorAccount'
       or coalesce(btrim(v_payment_document ->> 'itemKind'), '') <> 'file'
       or coalesce(btrim(v_payment_document ->> 'storagePath'), '') = ''
       or btrim(v_payment_document ->> 'storagePath') <> btrim(p_payment_support ->> 'storagePath')
       or coalesce(btrim(v_payment_document ->> 'uploadedBy'), '') = ''
       or not exists (
         select 1
           from jsonb_array_elements_text(coalesce(p_actor -> 'aliases', '[]'::jsonb)) as actor_alias(value)
          where lower(btrim(actor_alias.value)) = lower(btrim(v_payment_document ->> 'uploadedBy'))
       ) then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_payment_support');
    end if;

    v_verified_payment_support := jsonb_build_object(
      'kind', 'paymentSupport',
      'label', 'Soporte de pago de cuenta de cobro',
      'documentId', btrim(p_payment_support ->> 'documentId'),
      'fileName', coalesce(v_payment_document ->> 'fileName', v_payment_document ->> 'name', ''),
      'fileSize', coalesce(v_payment_document -> 'fileSize', '0'::jsonb),
      'fileUrl', coalesce(v_payment_document ->> 'downloadURL', v_payment_document ->> 'url', ''),
      'storagePath', btrim(v_payment_document ->> 'storagePath'),
      'uploadedAt', coalesce(v_payment_document -> 'uploadedAt', v_payment_document -> 'createdAt', to_jsonb(v_now)),
      'uploadedBy', btrim(p_actor ->> 'id'),
      'uploadedByName', nullif(btrim(p_actor ->> 'name'), '')
    );
  end if;

  if v_next_status in (
    'submitted', 'boss_approved', 'operations_approved',
    'quality_approved', 'hr_approved', 'accounted', 'returned'
  ) then
    v_assignment_id := nullif(btrim(p_next_assignment ->> 'id'), '');
    v_assignment_stage := nullif(btrim(p_next_assignment ->> 'status'), '');
    if v_assignment_id is null or v_assignment_stage is distinct from v_next_status then
      delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_responsible');
    end if;

    if p_action = 'return' then
      v_requester_aliases := jsonb_build_array(
        v_account #>> '{requesterSignature,signerUserId}',
        v_account ->> 'contractorAuthUserId',
        v_account ->> 'contractorId',
        v_account #>> '{requesterSignature,signerMemberId}',
        v_account ->> 'contractorEmail',
        v_account #>> '{requesterSignature,email}'
      );
      if not exists (
        select 1
          from jsonb_array_elements_text(v_requester_aliases) as requester_alias(value)
         where coalesce(btrim(requester_alias.value), '') <> ''
           and lower(btrim(requester_alias.value)) = lower(v_assignment_id)
      ) or not exists (
        select 1
          from jsonb_array_elements_text(coalesce(p_next_assignment -> 'aliases', '[]'::jsonb)) as assignee_alias(value)
          cross join jsonb_array_elements_text(v_requester_aliases) as requester_alias(value)
         where coalesce(btrim(assignee_alias.value), '') <> ''
           and coalesce(btrim(requester_alias.value), '') <> ''
           and lower(btrim(assignee_alias.value)) = lower(btrim(requester_alias.value))
      ) then
        delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
        return jsonb_build_object('applied', false, 'reason', 'invalid_return_assignee');
      end if;
    else
      v_next_config_key := case v_next_status
        when 'submitted' then 'immediateBossId'
        when 'boss_approved' then 'operationsManagerId'
        when 'operations_approved' then 'qualityComplianceId'
        when 'quality_approved' then 'humanTalentId'
        when 'hr_approved' then 'accountingId'
        when 'accounted' then 'administrationId'
        else null
      end;
      if v_next_config_key = 'administrationId' then
        v_expected_configured_id := coalesce(
          nullif(btrim(v_project_config ->> 'administrationId'), ''),
          nullif(btrim(v_organization_config ->> 'administrationId'), ''),
          nullif(btrim(v_project_config ->> 'accountingId'), ''),
          nullif(btrim(v_organization_config ->> 'accountingId'), '')
        );
      elsif v_next_config_key is not null then
        v_expected_configured_id := coalesce(
          nullif(btrim(v_project_config ->> v_next_config_key), ''),
          nullif(btrim(v_organization_config ->> v_next_config_key), '')
        );
      end if;
      if v_expected_configured_id is null then
        delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
        return jsonb_build_object('applied', false, 'reason', 'missing_responsible');
      end if;
      if lower(v_assignment_id) <> lower(v_expected_configured_id)
         or lower(coalesce(btrim(p_next_assignment ->> 'configuredId'), '')) <> lower(v_expected_configured_id) then
        delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
        return jsonb_build_object('applied', false, 'reason', 'invalid_assignment');
      end if;
    end if;

    v_assignment_event_id := left(
      format('account-action:%s:%s', btrim(p_operation_id), btrim(p_account_id)),
      180
    );
    v_result_assignment := jsonb_build_object(
      'projectId', btrim(p_project_id),
      'accountId', btrim(p_account_id),
      'status', v_next_status,
      'assigneeId', v_assignment_id,
      'assignmentEventId', v_assignment_event_id
    );
    v_patch := v_patch || jsonb_build_object(
      'currentApprovalStage', v_next_status,
      'currentApproverId', v_assignment_id,
      'currentApproverMemberId', nullif(btrim(p_next_assignment ->> 'memberId'), ''),
      'currentApproverAuthUserId', nullif(btrim(p_next_assignment ->> 'authUserId'), ''),
      'currentApproverEmail', nullif(btrim(p_next_assignment ->> 'email'), ''),
      'currentApproverLabel', nullif(btrim(p_next_assignment ->> 'label'), ''),
      'currentAssignmentEventId', v_assignment_event_id
    );
  else
    v_patch := v_patch || jsonb_build_object(
      'currentApprovalStage', null,
      'currentApproverId', null,
      'currentApproverMemberId', null,
      'currentApproverAuthUserId', null,
      'currentApproverEmail', null,
      'currentApproverLabel', null,
      'currentAssignmentEventId', null
    );
  end if;

  v_patch := v_patch || jsonb_build_object('status', v_next_status, 'updatedAt', v_now);

  if p_action in ('approve', 'account', 'pay') then
    v_history := case
      when jsonb_typeof(v_account -> 'approvals') = 'array' then v_account -> 'approvals'
      else '[]'::jsonb
    end;
    v_history_entry := jsonb_build_object(
      'stage', v_next_status,
      'actorId', btrim(p_actor ->> 'id'),
      'actorName', nullif(btrim(p_actor ->> 'name'), ''),
      'actorEmail', lower(btrim(p_actor ->> 'email')),
      'at', v_now,
      'comment', coalesce(
        nullif(btrim(p_comment), ''),
        case when coalesce(p_is_global_admin, false)
          then 'Acción ejecutada por el Administrador Global para soporte o corrección operativa.'
          else ''
        end
      ),
      'signature', p_signature,
      'performedByGlobalAdmin', coalesce(p_is_global_admin, false),
      'expectedApproverId', v_expected_approver_id
    );
    v_patch := v_patch || jsonb_build_object('approvals', v_history || jsonb_build_array(v_history_entry));
  end if;

  if p_action = 'account' then
    v_patch := v_patch || jsonb_build_object(
      'accountingReference', btrim(p_accounting_reference),
      'accountingNote', coalesce(btrim(p_accounting_note), ''),
      'accountedAt', v_now,
      'accountedBy', btrim(p_actor ->> 'id'),
      'accountedByName', nullif(btrim(p_actor ->> 'name'), '')
    );
  elsif p_action = 'pay' then
    v_patch := v_patch || jsonb_build_object(
      'paymentSupport', v_verified_payment_support,
      'paidAt', v_now,
      'paidBy', btrim(p_actor ->> 'id'),
      'paidByName', nullif(btrim(p_actor ->> 'name'), '')
    );
  elsif p_action = 'return' then
    v_history := case
      when jsonb_typeof(v_account -> 'returnHistory') = 'array' then v_account -> 'returnHistory'
      else '[]'::jsonb
    end;
    v_history_entry := jsonb_build_object(
      'fromStage', v_current_status,
      'returnedToId', v_assignment_id,
      'returnedToEmail', nullif(btrim(p_next_assignment ->> 'email'), ''),
      'actorId', btrim(p_actor ->> 'id'),
      'actorName', nullif(btrim(p_actor ->> 'name'), ''),
      'actorEmail', lower(btrim(p_actor ->> 'email')),
      'comment', btrim(p_comment),
      'at', v_now
    );
    v_patch := v_patch || jsonb_build_object(
      'returnComment', btrim(p_comment),
      'returnedFromStage', v_current_status,
      'returnedAt', v_now,
      'returnedBy', btrim(p_actor ->> 'id'),
      'returnedByName', nullif(btrim(p_actor ->> 'name'), ''),
      'correctionAssigneeId', v_assignment_id,
      'correctionAssigneeMemberId', nullif(btrim(p_next_assignment ->> 'memberId'), ''),
      'correctionAssigneeAuthUserId', nullif(btrim(p_next_assignment ->> 'authUserId'), ''),
      'correctionAssigneeEmail', nullif(btrim(p_next_assignment ->> 'email'), ''),
      'returnHistory', v_history || jsonb_build_array(v_history_entry)
    );
  elsif p_action = 'reject' then
    v_history := case
      when jsonb_typeof(v_account -> 'rejectionHistory') = 'array' then v_account -> 'rejectionHistory'
      else '[]'::jsonb
    end;
    v_history_entry := jsonb_build_object(
      'fromStage', v_current_status,
      'actorId', btrim(p_actor ->> 'id'),
      'actorName', nullif(btrim(p_actor ->> 'name'), ''),
      'actorEmail', lower(btrim(p_actor ->> 'email')),
      'comment', btrim(p_comment),
      'at', v_now
    );
    v_patch := v_patch || jsonb_build_object(
      'returnComment', btrim(p_comment),
      'rejectedAt', v_now,
      'rejectedBy', btrim(p_actor ->> 'id'),
      'rejectedByName', nullif(btrim(p_actor ->> 'name'), ''),
      'rejectionHistory', v_history || jsonb_build_array(v_history_entry)
    );
  elsif p_action = 'reactivate' then
    v_history := case
      when jsonb_typeof(v_account -> 'resubmissionHistory') = 'array' then v_account -> 'resubmissionHistory'
      else '[]'::jsonb
    end;
    v_history_entry := jsonb_build_object(
      'actorId', btrim(p_actor ->> 'id'),
      'actorName', nullif(btrim(p_actor ->> 'name'), ''),
      'actorEmail', lower(btrim(p_actor ->> 'email')),
      'targetStage', v_next_status,
      'targetApproverId', v_assignment_id,
      'kind', 'global_reactivation',
      'comment', coalesce(nullif(btrim(p_comment), ''), 'Reactivada en el mismo paso del que fue devuelta.'),
      'at', v_now
    );
    v_patch := v_patch || jsonb_build_object(
      'reactivatedAt', v_now,
      'reactivatedBy', btrim(p_actor ->> 'id'),
      'reactivatedByName', nullif(btrim(p_actor ->> 'name'), ''),
      'correctionAssigneeId', null,
      'correctionAssigneeMemberId', null,
      'correctionAssigneeAuthUserId', null,
      'correctionAssigneeEmail', null,
      'resubmissionHistory', v_history || jsonb_build_array(v_history_entry)
    );
  end if;

  update private.contractor_workspace_documents as document
     set data = v_account || v_patch,
         updated_at = v_now
   where document.collection_path = v_collection_path
     and document.doc_id = btrim(p_account_id)
     and coalesce(nullif(btrim(document.data ->> 'status'), ''), 'submitted') = btrim(p_expected_status)
     and coalesce(
       nullif(btrim(document.data ->> 'currentApprovalStage'), ''),
       coalesce(nullif(btrim(document.data ->> 'status'), ''), 'submitted')
     ) = btrim(p_expected_stage)
     and coalesce(nullif(btrim(document.data ->> 'currentAssignmentEventId'), ''), '') =
         coalesce(nullif(btrim(p_expected_assignment_event_id), ''), '');

  if not found then
    delete from private.contractor_account_action_operations where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'stale_account');
  end if;

  v_result := jsonb_build_object(
    'applied', true,
    'replayed', false,
    'projectId', btrim(p_project_id),
    'accountId', btrim(p_account_id),
    'previousStatus', v_current_status,
    'status', v_next_status,
    'assignment', v_result_assignment
  );
  update private.contractor_account_action_operations
     set result = v_result,
         completed_at = v_now
   where tenant_id = p_tenant_id and operation_id = btrim(p_operation_id);

  return v_result;
end;
$function$;

revoke all on function public.app_apply_contractor_account_action(uuid,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,text,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_apply_contractor_account_action(uuid,text,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,text,jsonb,text,text,jsonb) to service_role;

drop function public.app_reassign_contractor_account_approver(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION public.app_reassign_contractor_account_approver(p_tenant_id uuid, p_project_id text, p_account_id text, p_expected_status text, p_expected_stage text, p_expected_assignment_event_id text, p_expected_approver_id text, p_expected_approver_member_id text, p_expected_approver_auth_user_id text, p_expected_approver_email text, p_next_approver_id text, p_next_approver_member_id text, p_next_approver_auth_user_id text, p_next_approver_email text, p_next_approver_label text, p_next_assignment_event_id text, p_history_entry jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_collection_path text := format('projects/%s/contractorPaymentRequests', p_project_id);
  v_data jsonb;
  v_status text;
  v_stage text;
  v_history jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_tenant_id is null or not exists (select 1 from public.app_workspaces where id=p_tenant_id and (status='active' or (status='trial' and trial_ends_at>now()))) then
    raise exception 'Workspace is not active' using errcode='42501';
  end if;
  perform set_config('pixel.server_workspace',p_tenant_id::text,true);
  select data
    into v_data
    from private.contractor_workspace_documents
   where collection_path = v_collection_path
     and doc_id = p_account_id
   for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;

  v_status := coalesce(nullif(v_data ->> 'status', ''), 'submitted');
  v_stage := coalesce(nullif(v_data ->> 'currentApprovalStage', ''), v_status);

  if v_status <> coalesce(p_expected_status, '')
     or v_stage <> coalesce(p_expected_stage, '') then
    return jsonb_build_object(
      'applied', false,
      'reason', 'stale_stage',
      'currentStatus', v_status,
      'currentStage', v_stage
    );
  end if;

  if coalesce(v_data ->> 'currentAssignmentEventId', '') <> coalesce(p_expected_assignment_event_id, '')
     or coalesce(v_data ->> 'currentApproverId', '') <> coalesce(p_expected_approver_id, '')
     or coalesce(v_data ->> 'currentApproverMemberId', '') <> coalesce(p_expected_approver_member_id, '')
     or coalesce(v_data ->> 'currentApproverAuthUserId', '') <> coalesce(p_expected_approver_auth_user_id, '')
     or lower(coalesce(v_data ->> 'currentApproverEmail', '')) <> lower(coalesce(p_expected_approver_email, '')) then
    return jsonb_build_object('applied', false, 'reason', 'stale_assignment');
  end if;

  v_history := v_data -> 'approvalRouteReassignmentHistory';
  if v_history is null or jsonb_typeof(v_history) <> 'array' then
    v_history := '[]'::jsonb;
  end if;
  if p_history_entry is not null and p_history_entry <> '{}'::jsonb then
    v_history := v_history || jsonb_build_array(p_history_entry);
  end if;

  update private.contractor_workspace_documents
     set data = v_data || jsonb_build_object(
       'currentApprovalStage', v_status,
       'currentApproverId', p_next_approver_id,
       'currentApproverMemberId', p_next_approver_member_id,
       'currentApproverAuthUserId', p_next_approver_auth_user_id,
       'currentApproverEmail', p_next_approver_email,
       'currentApproverLabel', p_next_approver_label,
       'currentAssignmentEventId', p_next_assignment_event_id,
       'approvalRouteReassignmentHistory', v_history,
       'updatedAt', v_now
     ) || case
       when v_status = 'returned' then jsonb_build_object(
         'correctionAssigneeId', p_next_approver_id,
         'correctionAssigneeMemberId', p_next_approver_member_id,
         'correctionAssigneeAuthUserId', p_next_approver_auth_user_id,
         'correctionAssigneeEmail', p_next_approver_email
       )
       else '{}'::jsonb
     end,
         updated_at = v_now
   where collection_path = v_collection_path
     and doc_id = p_account_id;

  return jsonb_build_object(
    'applied', true,
    'reason', 'reassigned',
    'status', v_status,
    'assignmentEventId', p_next_assignment_event_id,
    'assigneeId', p_next_approver_id
  );
end;
$function$;

revoke all on function public.app_reassign_contractor_account_approver(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_reassign_contractor_account_approver(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) to service_role;

drop function public.app_update_contractor_account_approval_route(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text);
CREATE OR REPLACE FUNCTION public.app_update_contractor_account_approval_route(p_tenant_id uuid, p_scope text, p_target_id text, p_expected_config jsonb, p_next_config jsonb, p_target_patch jsonb, p_project_plans jsonb, p_actor jsonb, p_operation_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_target_collection text;
  v_target_data jsonb;
  v_current_config jsonb;
  v_request_payload jsonb;
  v_existing_operation private.contractor_route_operations%rowtype;
  v_project_plan jsonb;
  v_stage_plan jsonb;
  v_project_data jsonb;
  v_account record;
  v_account_path text;
  v_status text;
  v_previous_approver_id text;
  v_next_approver_id text;
  v_responsible_changed boolean;
  v_current_matches boolean;
  v_assignment_event_id text;
  v_history jsonb;
  v_history_entry jsonb;
  v_assignments jsonb := '[]'::jsonb;
  v_reassigned_count integer := 0;
  v_current_revision bigint := 0;
  v_now timestamptz := clock_timestamp();
begin
  if p_tenant_id is null or not exists (select 1 from public.app_workspaces where id=p_tenant_id and (status='active' or (status='trial' and trial_ends_at>now()))) then
    raise exception 'Workspace is not active' using errcode='42501';
  end if;
  perform set_config('pixel.server_workspace',p_tenant_id::text,true);
  if p_scope not in ('project', 'organization')
     or coalesce(p_target_id, '') = ''
     or coalesce(p_operation_id, '') !~ '^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,119}$' then
    return jsonb_build_object('applied', false, 'reason', 'invalid_request');
  end if;

  if jsonb_typeof(coalesce(p_expected_config, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_next_config, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_target_patch, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_project_plans, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_actor, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('applied', false, 'reason', 'invalid_request');
  end if;

  v_request_payload := jsonb_build_object(
    'scope', p_scope,
    'targetId', p_target_id,
    'nextConfig', p_next_config,
    'targetPatch', p_target_patch
  );

  insert into private.contractor_route_operations (
    operation_id,
    request_payload,
    actor_id
  ) values (
    p_operation_id,
    v_request_payload,
    coalesce(p_actor ->> 'id', '')
  )
  on conflict do nothing;

  if not found then
    select *
      into v_existing_operation
      from private.contractor_route_operations
     where tenant_id = p_tenant_id and operation_id = p_operation_id
     for share;

    if v_existing_operation.request_payload is distinct from v_request_payload
       or v_existing_operation.actor_id is distinct from coalesce(p_actor ->> 'id', '') then
      return jsonb_build_object('applied', false, 'reason', 'operation_conflict');
    end if;

    if v_existing_operation.result is not null then
      return v_existing_operation.result || jsonb_build_object('replayed', true);
    end if;

    return jsonb_build_object('applied', false, 'reason', 'operation_in_progress');
  end if;

  v_target_collection := case p_scope
    when 'project' then 'projects'
    else 'organizations'
  end;

  select data
    into v_target_data
    from private.contractor_workspace_documents
   where collection_path = v_target_collection
     and doc_id = p_target_id
   for update;

  if not found then
    delete from private.contractor_route_operations where tenant_id = p_tenant_id and operation_id = p_operation_id;
    return jsonb_build_object('applied', false, 'reason', 'target_not_found');
  end if;

  v_current_config := case
    when jsonb_typeof(v_target_data -> 'contractorAccountApprovalConfig') = 'object'
      then v_target_data -> 'contractorAccountApprovalConfig'
    else '{}'::jsonb
  end;

  if v_current_config is distinct from coalesce(p_expected_config, '{}'::jsonb) then
    delete from private.contractor_route_operations where tenant_id = p_tenant_id and operation_id = p_operation_id;
    return jsonb_build_object('applied', false, 'reason', 'stale_config');
  end if;

  if coalesce(v_target_data ->> 'contractorAccountApprovalConfigRevision', '') ~ '^[0-9]+$' then
    v_current_revision := (v_target_data ->> 'contractorAccountApprovalConfigRevision')::bigint;
  end if;

  -- Lock every affected project in a stable order and verify that a local
  -- override did not change while the server was building the effective route.
  for v_project_plan in
    select value
      from jsonb_array_elements(coalesce(p_project_plans, '[]'::jsonb))
     order by value ->> 'projectId'
  loop
    if p_scope = 'project' and v_project_plan ->> 'projectId' = p_target_id then
      v_project_data := v_target_data;
    else
      select data
        into v_project_data
        from private.contractor_workspace_documents
       where collection_path = 'projects'
         and doc_id = v_project_plan ->> 'projectId'
       for update;

      if not found then
        delete from private.contractor_route_operations where tenant_id = p_tenant_id and operation_id = p_operation_id;
        return jsonb_build_object('applied', false, 'reason', 'stale_project_config');
      end if;
    end if;

    if (
      case
        when jsonb_typeof(v_project_data -> 'contractorAccountApprovalConfig') = 'object'
          then v_project_data -> 'contractorAccountApprovalConfig'
        else '{}'::jsonb
      end
    ) is distinct from coalesce(v_project_plan -> 'expectedProjectConfig', '{}'::jsonb) then
      delete from private.contractor_route_operations where tenant_id = p_tenant_id and operation_id = p_operation_id;
      return jsonb_build_object('applied', false, 'reason', 'stale_project_config');
    end if;
  end loop;

  -- Lock all active accounts before changing either the route or an assignee.
  for v_project_plan in
    select value
      from jsonb_array_elements(coalesce(p_project_plans, '[]'::jsonb))
     order by value ->> 'projectId'
  loop
    v_account_path := format(
      'projects/%s/contractorPaymentRequests',
      v_project_plan ->> 'projectId'
    );
    perform 1
      from private.contractor_workspace_documents
     where collection_path = v_account_path
       and coalesce(nullif(data ->> 'status', ''), 'submitted') in (
         'submitted',
         'boss_approved',
         'operations_approved',
         'quality_approved',
         'hr_approved',
         'accounted'
       )
     order by doc_id
     for update;
  end loop;

  -- Reconcile only when the effective owner of the account's current stage
  -- changed. Historical approvals, signatures, documents and payment
  -- information are untouched.
  for v_project_plan in
    select value
      from jsonb_array_elements(coalesce(p_project_plans, '[]'::jsonb))
     order by value ->> 'projectId'
  loop
    v_account_path := format(
      'projects/%s/contractorPaymentRequests',
      v_project_plan ->> 'projectId'
    );

    for v_account in
      select doc_id, data
        from private.contractor_workspace_documents
       where collection_path = v_account_path
         and coalesce(nullif(data ->> 'status', ''), 'submitted') in (
           'submitted',
           'boss_approved',
           'operations_approved',
           'quality_approved',
           'hr_approved',
           'accounted'
         )
       order by doc_id
       for update
    loop
      v_status := coalesce(nullif(v_account.data ->> 'status', ''), 'submitted');
      v_stage_plan := null;
      select value
        into v_stage_plan
        from jsonb_array_elements(coalesce(v_project_plan -> 'stages', '[]'::jsonb))
       where value ->> 'status' = v_status
       limit 1;

      if v_stage_plan is null then
        delete from private.contractor_route_operations where tenant_id = p_tenant_id and operation_id = p_operation_id;
        return jsonb_build_object(
          'applied', false,
          'reason', 'missing_responsible',
          'projectId', v_project_plan ->> 'projectId',
          'accountId', v_account.doc_id,
          'status', v_status,
          'stageLabel', v_status
        );
      end if;

      v_previous_approver_id := nullif(v_stage_plan ->> 'previousApproverId', '');
      v_next_approver_id := nullif(v_stage_plan ->> 'nextApproverId', '');

      if v_previous_approver_id is null and v_next_approver_id is null then
        v_responsible_changed := false;
      elsif v_previous_approver_id is null or v_next_approver_id is null then
        v_responsible_changed := true;
      else
        select not exists (
          select 1
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(v_stage_plan -> 'previousApproverAliases') = 'array'
                     and jsonb_array_length(v_stage_plan -> 'previousApproverAliases') > 0
                  then v_stage_plan -> 'previousApproverAliases'
                else jsonb_build_array(lower(v_previous_approver_id))
              end
            ) as previous_alias(value)
            cross join jsonb_array_elements_text(
              case
                when jsonb_typeof(v_stage_plan -> 'nextApproverAliases') = 'array'
                     and jsonb_array_length(v_stage_plan -> 'nextApproverAliases') > 0
                  then v_stage_plan -> 'nextApproverAliases'
                else jsonb_build_array(lower(v_next_approver_id))
              end
            ) as next_alias(value)
           where lower(btrim(previous_alias.value)) = lower(btrim(next_alias.value))
             and btrim(previous_alias.value) <> ''
        ) into v_responsible_changed;
      end if;

      if not v_responsible_changed then
        continue;
      end if;

      if v_next_approver_id is null then
        delete from private.contractor_route_operations where tenant_id = p_tenant_id and operation_id = p_operation_id;
        return jsonb_build_object(
          'applied', false,
          'reason', 'missing_responsible',
          'projectId', v_project_plan ->> 'projectId',
          'accountId', v_account.doc_id,
          'status', v_status,
          'stageLabel', coalesce(v_stage_plan ->> 'nextApproverLabel', v_status)
        );
      end if;

      select exists (
        select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(v_stage_plan -> 'nextApproverAliases') = 'array'
                then v_stage_plan -> 'nextApproverAliases'
              else jsonb_build_array(lower(v_next_approver_id))
            end
          ) as alias(value)
         where lower(alias.value) in (
           lower(coalesce(v_account.data ->> 'currentApproverId', '')),
           lower(coalesce(v_account.data ->> 'currentApproverMemberId', '')),
           lower(coalesce(v_account.data ->> 'currentApproverAuthUserId', '')),
           lower(coalesce(v_account.data ->> 'currentApproverEmail', ''))
         )
      ) into v_current_matches;

      if v_current_matches then
        continue;
      end if;

      v_assignment_event_id := left(
        format(
          'route:%s:%s:%s',
          p_operation_id,
          v_project_plan ->> 'projectId',
          v_account.doc_id
        ),
        180
      );
      v_history := case
        when jsonb_typeof(v_account.data -> 'approvalRouteReassignmentHistory') = 'array'
          then v_account.data -> 'approvalRouteReassignmentHistory'
        else '[]'::jsonb
      end;
      v_history_entry := jsonb_build_object(
        'eventId', v_assignment_event_id,
        'operationId', p_operation_id,
        'stage', v_status,
        'configKey', v_stage_plan ->> 'configKey',
        'scope', p_scope,
        'scopeId', p_target_id,
        'fromApproverId', nullif(v_account.data ->> 'currentApproverId', ''),
        'fromApproverMemberId', nullif(v_account.data ->> 'currentApproverMemberId', ''),
        'fromApproverAuthUserId', nullif(v_account.data ->> 'currentApproverAuthUserId', ''),
        'fromApproverEmail', nullif(v_account.data ->> 'currentApproverEmail', ''),
        'fromApproverName', coalesce(
          nullif(v_account.data ->> 'currentApproverName', ''),
          nullif(v_account.data ->> 'currentApproverEmail', ''),
          nullif(v_account.data ->> 'currentApproverId', ''),
          'Sin responsable'
        ),
        'toApproverId', v_next_approver_id,
        'toApproverMemberId', nullif(v_stage_plan ->> 'nextApproverMemberId', ''),
        'toApproverAuthUserId', nullif(v_stage_plan ->> 'nextApproverAuthUserId', ''),
        'toApproverName', nullif(v_stage_plan ->> 'nextApproverName', ''),
        'toApproverEmail', nullif(v_stage_plan ->> 'nextApproverEmail', ''),
        'actorId', nullif(p_actor ->> 'id', ''),
        'actorName', nullif(p_actor ->> 'name', ''),
        'actorEmail', nullif(p_actor ->> 'email', ''),
        'at', v_now
      );

      update private.contractor_workspace_documents
         set data = v_account.data || jsonb_build_object(
           'currentApprovalStage', v_status,
           'currentApproverId', v_next_approver_id,
           'currentApproverMemberId', nullif(v_stage_plan ->> 'nextApproverMemberId', ''),
           'currentApproverAuthUserId', nullif(v_stage_plan ->> 'nextApproverAuthUserId', ''),
           'currentApproverEmail', nullif(v_stage_plan ->> 'nextApproverEmail', ''),
           'currentApproverLabel', v_stage_plan ->> 'nextApproverLabel',
           'currentAssignmentEventId', v_assignment_event_id,
           'approvalRouteReassignmentHistory', v_history || jsonb_build_array(v_history_entry),
           'updatedAt', v_now
         ),
             updated_at = v_now
       where collection_path = v_account_path
         and doc_id = v_account.doc_id;

      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'projectId', v_project_plan ->> 'projectId',
        'accountId', v_account.doc_id,
        'status', v_status,
        'assigneeId', v_next_approver_id,
        'assignmentEventId', v_assignment_event_id
      ));
      v_reassigned_count := v_reassigned_count + 1;
    end loop;
  end loop;

  update private.contractor_workspace_documents
     set data = v_target_data || coalesce(p_target_patch, '{}'::jsonb) || jsonb_build_object(
       'contractorAccountApprovalConfig', p_next_config,
       'contractorAccountApprovalConfigRevision', v_current_revision + 1,
       'contractorAccountApprovalConfigLastOperationId', p_operation_id,
       'contractorAccountApprovalConfigUpdatedAt', v_now,
       'contractorAccountApprovalConfigUpdatedBy', nullif(p_actor ->> 'id', ''),
       'updatedAt', v_now
     ),
         updated_at = v_now
   where collection_path = v_target_collection
     and doc_id = p_target_id;

  v_existing_operation.result := jsonb_build_object(
    'applied', true,
    'replayed', false,
    'scope', p_scope,
    'targetId', p_target_id,
    'revision', v_current_revision + 1,
    'reassignedCount', v_reassigned_count,
    'assignments', v_assignments
  );

  update private.contractor_route_operations
     set result = v_existing_operation.result,
         completed_at = v_now
   where tenant_id = p_tenant_id and operation_id = p_operation_id;

  return v_existing_operation.result;
end;
$function$;

revoke all on function public.app_update_contractor_account_approval_route(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.app_update_contractor_account_approval_route(uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,text) to service_role;
