-- Global support is a separate server-only surface. Tenant RLS remains isolated.
alter table public.app_workspace_members add column suspended_at timestamptz;
create table public.platform_support_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  actor_email text not null,
  workspace_id uuid references public.app_workspaces(id),
  target_id text not null,
  action text not null,
  reason text not null check (char_length(reason) between 5 and 500),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index platform_support_audit_workspace_time_idx on public.platform_support_audit(workspace_id,created_at desc);
alter table public.platform_support_audit enable row level security;
revoke all on public.platform_support_audit from public,anon,authenticated;
grant select,insert on public.platform_support_audit to service_role;

create or replace function private.current_workspace_id()
returns uuid language sql stable security definer set search_path='' as $$
  select workspace_id from public.app_workspace_members where user_id=(select auth.uid()) and suspended_at is null;
$$;
create or replace function private.workspace_is_active()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_workspaces w join public.app_workspace_members m on m.workspace_id=w.id
    where m.user_id=(select auth.uid()) and m.suspended_at is null
    and (w.status='active' or (w.status='trial' and w.trial_ends_at>now())));
$$;
create or replace function private.workspace_is_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_workspace_members where user_id=(select auth.uid()) and suspended_at is null and role in ('owner','admin'));
$$;
create or replace function private.can_access_workspace_file(object_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.app_workspace_members m join public.app_workspaces w on w.id=m.workspace_id
    where m.user_id=(select auth.uid()) and m.suspended_at is null
    and (w.status='active' or (w.status='trial' and w.trial_ends_at>now()))
    and (object_name like 'workspaces/'||w.id::text||'/%' or (w.legacy_storage and object_name not like 'workspaces/%'))
    and object_name !~ '(^|/)\.\.(/|$)');
$$;

-- Guard onboarding without duplicating the already-tested provisioning transaction.
alter function private.ensure_trial_workspace(text,text) rename to provision_trial_workspace;
revoke all on function private.provision_trial_workspace(text,text) from public,anon,authenticated;
create function private.ensure_trial_workspace(workspace_name text,display_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if exists(select 1 from public.app_workspace_members where user_id=auth.uid() and suspended_at is not null) then
    raise exception 'Tu cuenta está pausada. Contacta al soporte de Pixel.' using errcode='42501';
  end if;
  return private.provision_trial_workspace(workspace_name,display_name);
end;
$$;
revoke all on function private.ensure_trial_workspace(text,text) from public,anon;
grant execute on function private.ensure_trial_workspace(text,text) to authenticated;

-- This check supplements the server's private bootstrap email allowlist. A caller
-- cannot fabricate the actor even if a future endpoint passes the wrong id.
create function private.platform_actor(p_actor_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare actor_email text;
begin
  select u.email into actor_email from auth.users u
    join public.app_workspaces w on w.owner_id=u.id and w.legacy_storage
    join public.app_workspace_members m on m.workspace_id=w.id and m.user_id=u.id
    where u.id=p_actor_id and u.email_confirmed_at is not null and m.suspended_at is null and m.role='owner';
  if actor_email is null then raise exception 'Administrador de plataforma requerido' using errcode='42501'; end if;
  return actor_email;
end;
$$;
create function private.platform_reason(p_reason text)
returns text language plpgsql immutable set search_path='' as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then
    raise exception 'Indica un motivo de 5 a 500 caracteres' using errcode='22023';
  end if;
  return btrim(p_reason);
end;
$$;

create view private.platform_workspace_rows with(security_invoker=true) as
select w.*,u.email as owner_email,
  (select count(*) from public.app_workspace_members m where m.workspace_id=w.id) as member_count,
  (select count(*) from public.app_documents d where d.tenant_id=w.id and d.collection_path='organizations') as organization_count
from public.app_workspaces w join auth.users u on u.id=w.owner_id;
create view private.platform_user_rows with(security_invoker=true) as
select u.id,u.email,coalesce(d.data->>'displayName',u.raw_user_meta_data->>'displayName',split_part(u.email,'@',1)) as "displayName",
  m.workspace_id,w.name as workspace_name,m.role as membership_role,d.data->>'role' as "systemRole",
  coalesce(d.data->'organizationIds','[]'::jsonb) as "organizationIds",m.suspended_at,
  u.email_confirmed_at,u.invited_at,u.last_sign_in_at,u.created_at
from auth.users u left join public.app_workspace_members m on m.user_id=u.id
left join public.app_workspaces w on w.id=m.workspace_id
left join public.app_documents d on d.tenant_id=m.workspace_id and d.collection_path='users' and d.doc_id=u.id::text;
create view private.platform_organization_rows with(security_invoker=true) as
select d.doc_id as id,d.tenant_id as workspace_id,w.name as workspace_name,coalesce(d.data->>'name','Organización') as name,
  (select count(*) from public.app_documents p where p.tenant_id=d.tenant_id and p.collection_path='users' and p.data->'organizationIds' ? d.doc_id) as member_count
from public.app_documents d join public.app_workspaces w on w.id=d.tenant_id where d.collection_path='organizations';
revoke all on private.platform_workspace_rows,private.platform_user_rows,private.platform_organization_rows from public,anon,authenticated;

create function private.platform_overview(p_actor_id uuid,p_view text,p_page integer,p_query text,p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_rows jsonb; result_total bigint; summary jsonb; page_number integer:=greatest(1,least(coalesce(p_page,1),100000));
  search_text text:=lower(left(btrim(coalesce(p_query,'')),150));
begin
  perform private.platform_actor(p_actor_id);
  if p_view='workspaces' then
    select count(*) into result_total from private.platform_workspace_rows w where
      (p_workspace_id is null or w.id=p_workspace_id) and strpos(lower(w.name||' '||coalesce(w.owner_email,'')),search_text)>0;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result_rows from
      (select * from private.platform_workspace_rows w where (p_workspace_id is null or w.id=p_workspace_id)
        and strpos(lower(w.name||' '||coalesce(w.owner_email,'')),search_text)>0 order by created_at desc,id limit 20 offset (page_number-1)*20) x;
  elsif p_view='users' then
    select count(*) into result_total from private.platform_user_rows u where (p_workspace_id is null or u.workspace_id=p_workspace_id)
      and strpos(lower(coalesce(u.email,'')||' '||u."displayName"||' '||coalesce(u.workspace_name,'')),search_text)>0;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result_rows from
      (select * from private.platform_user_rows u where (p_workspace_id is null or u.workspace_id=p_workspace_id)
        and strpos(lower(coalesce(u.email,'')||' '||u."displayName"||' '||coalesce(u.workspace_name,'')),search_text)>0 order by created_at desc,id limit 20 offset (page_number-1)*20) x;
  elsif p_view='organizations' then
    select count(*) into result_total from private.platform_organization_rows o where (p_workspace_id is null or o.workspace_id=p_workspace_id)
      and strpos(lower(o.name||' '||o.workspace_name),search_text)>0;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into result_rows from
      (select * from private.platform_organization_rows o where (p_workspace_id is null or o.workspace_id=p_workspace_id)
        and strpos(lower(o.name||' '||o.workspace_name),search_text)>0 order by name,workspace_id,id limit 20 offset (page_number-1)*20) x;
  else raise exception 'Vista no válida' using errcode='22023'; end if;
  select jsonb_build_object('workspaces',count(*),'trialWorkspaces',count(*) filter(where status='trial'),
    'activeWorkspaces',count(*) filter(where status='active'),'suspendedWorkspaces',count(*) filter(where status='suspended'),
    'users',(select count(*) from auth.users),'organizations',(select count(*) from private.platform_organization_rows)) into summary from public.app_workspaces;
  return jsonb_build_object('summary',summary,'rows',result_rows,'total',result_total,'page',page_number,'pageSize',20);
end;
$$;

create function private.platform_workspace(p_actor_id uuid,p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare workspace_row jsonb;
begin
  perform private.platform_actor(p_actor_id);
  select to_jsonb(w) into workspace_row from private.platform_workspace_rows w where id=p_workspace_id;
  if workspace_row is null then raise exception 'Espacio no encontrado' using errcode='P0002'; end if;
  return jsonb_build_object('workspace',workspace_row,
    'organizations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from private.platform_organization_rows o where workspace_id=p_workspace_id),
    'users',(select coalesce(jsonb_agg(to_jsonb(u)),'[]'::jsonb) from (select * from private.platform_user_rows where workspace_id=p_workspace_id order by created_at,id limit 200) u),
    'audit',(select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from (select id,action,reason,created_at,actor_email,target_id from public.platform_support_audit where workspace_id=p_workspace_id order by created_at desc,id limit 50) a));
end;
$$;

create function private.platform_update_workspace(p_actor_id uuid,p_workspace_id uuid,p_changes jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_email text:=private.platform_actor(p_actor_id); reason text:=private.platform_reason(p_reason);
  prior public.app_workspaces%rowtype; new_name text; new_status text; new_end timestamptz;
begin
  select * into prior from public.app_workspaces where id=p_workspace_id for update;
  if not found then raise exception 'Espacio no encontrado' using errcode='P0002'; end if;
  new_name:=case when p_changes ? 'name' then btrim(p_changes->>'name') else prior.name end;
  new_status:=case when p_changes ? 'status' then p_changes->>'status' else prior.status end;
  new_end:=case when p_changes ? 'trialEndsAt' then (p_changes->>'trialEndsAt')::timestamptz else prior.trial_ends_at end;
  if new_name is null or char_length(new_name) not between 2 and 100 or new_status is null or new_status not in ('trial','active','suspended') then
    raise exception 'Nombre o estado no válido' using errcode='22023'; end if;
  if prior.legacy_storage and new_status<>'active' then raise exception 'El espacio de plataforma debe permanecer activo' using errcode='22023'; end if;
  if new_status='trial' and (new_end is null or new_end<=now()) then raise exception 'La prueba debe finalizar en el futuro' using errcode='22023'; end if;
  update public.app_workspaces set name=new_name,status=new_status,trial_ends_at=new_end where id=p_workspace_id;
  if new_name is distinct from prior.name then
    update public.app_documents set data=data||jsonb_build_object('name',new_name,'updatedAt',now()) where tenant_id=p_workspace_id and collection_path='organizations' and doc_id=p_workspace_id::text;
    update public.app_documents set data=data||jsonb_build_object('companyName',new_name) where tenant_id=p_workspace_id and collection_path='app_config' and doc_id='branding';
  end if;
  insert into public.platform_support_audit(actor_id,actor_email,workspace_id,target_id,action,reason,changes)
  values(p_actor_id,actor_email,p_workspace_id,p_workspace_id::text,'workspace.update',reason,
    jsonb_build_object('before',jsonb_build_object('name',prior.name,'status',prior.status,'trialEndsAt',prior.trial_ends_at),'after',jsonb_build_object('name',new_name,'status',new_status,'trialEndsAt',new_end)));
  return jsonb_build_object('message','Espacio actualizado.');
end;
$$;

create function private.platform_update_user(p_actor_id uuid,p_user_id uuid,p_changes jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_email text:=private.platform_actor(p_actor_id); reason text:=private.platform_reason(p_reason);
  member public.app_workspace_members%rowtype; profile jsonb; new_name text; new_role text; org_ids jsonb; new_suspended timestamptz; account_email text;
begin
  select * into member from public.app_workspace_members where user_id=p_user_id for update;
  if not found then raise exception 'La cuenta aún no tiene espacio. Debe confirmar su registro.' using errcode='22023'; end if;
  select data into profile from public.app_documents where tenant_id=member.workspace_id and collection_path='users' and doc_id=p_user_id::text for update;
  if profile is null then raise exception 'Perfil no encontrado' using errcode='P0002'; end if;
  select email into account_email from auth.users where id=p_user_id;
  new_name:=case when p_changes ? 'displayName' then btrim(p_changes->>'displayName') else profile->>'displayName' end;
  new_role:=coalesce(p_changes->>'systemRole',profile->>'role');
  if new_name is null or char_length(new_name) not between 2 and 100 or new_role is null or new_role not in ('admin','org_admin','manager','coordinador','administrativo','user') then
    raise exception 'Nombre o rol no válido' using errcode='22023'; end if;
  if member.role='owner' and new_role<>'admin' then raise exception 'El propietario debe conservar su rol de administrador' using errcode='22023'; end if;
  new_suspended:=member.suspended_at;
  if p_changes ? 'suspended' then
    if jsonb_typeof(p_changes->'suspended')<>'boolean' then raise exception 'Estado de usuario no válido' using errcode='22023'; end if;
    new_suspended:=case when (p_changes->>'suspended')::boolean then coalesce(member.suspended_at,now()) else null end;
    if p_user_id=p_actor_id and new_suspended is not null then raise exception 'No puedes pausar tu propia cuenta' using errcode='22023'; end if;
  end if;
  org_ids:=coalesce(p_changes->'organizationIds',profile->'organizationIds','[]'::jsonb);
  if jsonb_typeof(org_ids)<>'array' then raise exception 'Organizaciones no válidas' using errcode='22023'; end if;
  if jsonb_array_length(org_ids)>30 then raise exception 'Demasiadas organizaciones' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(org_ids) v where jsonb_typeof(v)<>'string') then raise exception 'Organizaciones no válidas' using errcode='22023'; end if;
  select jsonb_agg(distinct value) into org_ids from jsonb_array_elements(org_ids||jsonb_build_array(member.workspace_id::text));
  if exists(select 1 from jsonb_array_elements_text(org_ids) v where not exists(select 1 from public.app_documents d where d.tenant_id=member.workspace_id and d.collection_path='organizations' and d.doc_id=v)) then
    raise exception 'Las organizaciones deben pertenecer al espacio del usuario' using errcode='22023'; end if;
  update public.app_workspace_members set role=case when member.role='owner' then 'owner' when new_role in ('admin','org_admin') then 'admin' else 'member' end,suspended_at=new_suspended where user_id=p_user_id;
  update public.app_documents set data=data||jsonb_build_object('displayName',new_name,'role',new_role,'organizationId',member.workspace_id,'organizationIds',org_ids,'updatedAt',now()) where tenant_id=member.workspace_id and collection_path='users' and doc_id=p_user_id::text;
  update public.app_documents set data=data||jsonb_build_object('name',new_name,'displayName',new_name,'systemRole',new_role,'organizationId',member.workspace_id,'organizationIds',org_ids,'updatedAt',now()) where tenant_id=member.workspace_id and collection_path='team_members' and (doc_id=p_user_id::text or data->>'authUserId'=p_user_id::text or lower(data->>'email')=lower(account_email));
  insert into public.platform_support_audit(actor_id,actor_email,workspace_id,target_id,action,reason,changes)
  values(p_actor_id,actor_email,member.workspace_id,p_user_id::text,'user.update',reason,
    jsonb_build_object('before',jsonb_build_object('displayName',profile->>'displayName','systemRole',profile->>'role','organizationIds',profile->'organizationIds','suspended_at',member.suspended_at),
      'after',jsonb_build_object('displayName',new_name,'systemRole',new_role,'organizationIds',org_ids,'suspended_at',new_suspended)));
  return jsonb_build_object('message','Usuario actualizado.');
end;
$$;

create function private.platform_update_organization(p_actor_id uuid,p_workspace_id uuid,p_organization_id text,p_name text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_email text:=private.platform_actor(p_actor_id); reason text:=private.platform_reason(p_reason); old_name text;
begin
  if p_name is null or char_length(btrim(p_name)) not between 2 and 100 then raise exception 'Nombre no válido' using errcode='22023'; end if;
  select data->>'name' into old_name from public.app_documents where tenant_id=p_workspace_id and collection_path='organizations' and doc_id=p_organization_id for update;
  if not found then raise exception 'Organización no encontrada' using errcode='P0002'; end if;
  if p_organization_id=p_workspace_id::text then
    return private.platform_update_workspace(p_actor_id,p_workspace_id,jsonb_build_object('name',btrim(p_name)),reason);
  end if;
  update public.app_documents set data=data||jsonb_build_object('name',btrim(p_name),'updatedAt',now()) where tenant_id=p_workspace_id and collection_path='organizations' and doc_id=p_organization_id;
  insert into public.platform_support_audit(actor_id,actor_email,workspace_id,target_id,action,reason,changes)
  values(p_actor_id,actor_email,p_workspace_id,p_organization_id,'organization.update',reason,jsonb_build_object('before',old_name,'after',btrim(p_name)));
  return jsonb_build_object('message','Organización actualizada.');
end;
$$;

create function private.platform_log_access(p_actor_id uuid,p_workspace_id uuid,p_target_id text,p_action text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_email text:=private.platform_actor(p_actor_id); reason text:=private.platform_reason(p_reason);
begin
  if p_action not in ('access.invite','access.recovery','user.invite.request','user.invite.complete') then raise exception 'Acción no válida' using errcode='22023'; end if;
  insert into public.platform_support_audit(actor_id,actor_email,workspace_id,target_id,action,reason)
  values(p_actor_id,actor_email,p_workspace_id,left(p_target_id,254),p_action,reason);
  return jsonb_build_object('recorded',true);
end;
$$;

-- Public RPC wrappers never bypass security themselves. Only the server service
-- role can execute them; the browser's anon/authenticated roles have no grants.
create function public.app_platform_overview(p_actor_id uuid,p_view text,p_page integer,p_query text,p_workspace_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.platform_overview(p_actor_id,p_view,p_page,p_query,p_workspace_id); $$;
create function public.app_platform_workspace(p_actor_id uuid,p_workspace_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.platform_workspace(p_actor_id,p_workspace_id); $$;
create function public.app_platform_update_workspace(p_actor_id uuid,p_workspace_id uuid,p_changes jsonb,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.platform_update_workspace(p_actor_id,p_workspace_id,p_changes,p_reason); $$;
create function public.app_platform_update_user(p_actor_id uuid,p_user_id uuid,p_changes jsonb,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.platform_update_user(p_actor_id,p_user_id,p_changes,p_reason); $$;
create function public.app_platform_update_organization(p_actor_id uuid,p_workspace_id uuid,p_organization_id text,p_name text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.platform_update_organization(p_actor_id,p_workspace_id,p_organization_id,p_name,p_reason); $$;
create function public.app_platform_log_access(p_actor_id uuid,p_workspace_id uuid,p_target_id text,p_action text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.platform_log_access(p_actor_id,p_workspace_id,p_target_id,p_action,p_reason); $$;
do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname like 'platform_%') or (n.nspname='public' and p.proname like 'app_platform_%') loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
grant usage on schema private to service_role;
notify pgrst,'reload schema';
