-- Synthetic accounts only, all changes including audit rows are rolled back.
begin;
create temporary table platform_fixture(actor uuid,account_a uuid,account_b uuid,workspace_a uuid,workspace_b uuid) on commit drop;
insert into platform_fixture(actor,account_a,account_b)
select owner_id,gen_random_uuid(),gen_random_uuid() from public.app_workspaces where legacy_storage limit 1;
grant select,update on platform_fixture to authenticated,service_role;
create function pg_temp.platform_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'PLATFORM TEST FAILED: %',label; end if; end $$;
create function pg_temp.platform_rejected(statement text,label text) returns void language plpgsql as $$
begin
  begin execute statement; exception when insufficient_privilege or invalid_parameter_value then return; end;
  raise exception 'PLATFORM TEST FAILED: operation was accepted: %',label;
end $$;
insert into auth.users(id,email,email_confirmed_at,aud,role)
select account_a,'platform-fixture-'||account_a||'@example.invalid',now(),'authenticated','authenticated' from platform_fixture
union all select account_b,'platform-fixture-'||account_b||'@example.invalid',now(),'authenticated','authenticated' from platform_fixture;
select set_config('request.jwt.claim.sub',account_a::text,true) from platform_fixture;
set local role authenticated;
update platform_fixture set workspace_a=(public.ensure_trial_workspace('Soporte A','Persona A')->>'id')::uuid;
select set_config('request.jwt.claim.sub',account_b::text,true) from platform_fixture;
update platform_fixture set workspace_b=(public.ensure_trial_workspace('Soporte B','Persona B')->>'id')::uuid;
select pg_temp.platform_rejected(format('select public.app_platform_overview(%L,''users'',1,'''',null)',actor),'tenant cannot call global RPC') from platform_fixture;
select pg_temp.platform_rejected('select * from public.platform_support_audit','tenant cannot read support audit');
reset role;
set local role service_role;
select pg_temp.platform_rejected(format('select public.app_platform_overview(%L,''users'',1,'''',null)',account_a),'service cannot fabricate a tenant actor') from platform_fixture;
select pg_temp.platform_assert((public.app_platform_overview(actor,'users',1,'platform-fixture-',null)->>'total')::integer=2,'global search finds both accounts') from platform_fixture;
select pg_temp.platform_assert(jsonb_array_length(public.app_platform_workspace(actor,workspace_a)->'users')=1,'workspace detail is scoped') from platform_fixture;
select public.app_platform_update_workspace(actor,workspace_a,'{"name":"Organización corregida","status":"active"}', 'Solicitud de prueba') from platform_fixture;
select pg_temp.platform_assert((public.app_platform_workspace(actor,workspace_a)->'workspace'->>'name')='Organización corregida','workspace rename applied') from platform_fixture;
select pg_temp.platform_assert((public.app_platform_workspace(actor,workspace_a)->'organizations'->0->>'name')='Organización corregida','primary organization rename follows workspace') from platform_fixture;
select pg_temp.platform_rejected(format('select public.app_platform_update_user(%L,%L,%L,''Motivo válido'')',actor,account_a,jsonb_build_object('systemRole','user')),'owner cannot lose administrator role') from platform_fixture;
select pg_temp.platform_rejected(format('select public.app_platform_update_user(%L,%L,%L,''Motivo válido'')',actor,account_a,jsonb_build_object('organizationIds',jsonb_build_array(workspace_b))),'support cannot cross-assign organization membership') from platform_fixture;
select pg_temp.platform_rejected(format('select public.app_platform_update_user(%L,%L,''{"suspended":true}'',''Motivo válido'')',actor,actor),'platform account cannot suspend itself') from platform_fixture;
select public.app_platform_update_user(actor,account_a,'{"displayName":"Nombre corregido","suspended":true}','Pausa de soporte de prueba') from platform_fixture;
reset role;
select set_config('request.jwt.claim.sub',account_a::text,true) from platform_fixture;
set local role authenticated;
select pg_temp.platform_assert((select count(*) from public.app_documents)=0,'suspension blocks all document reads with an existing JWT');
select pg_temp.platform_assert(not private.can_access_workspace_file('workspaces/'||workspace_a||'/demo.pdf'),'suspension blocks storage with existing JWT') from platform_fixture;
select pg_temp.platform_rejected('select public.ensure_trial_workspace(''Nueva cuenta'',''Persona A'')','suspension cannot be bypassed by onboarding');
reset role;
set local role service_role;
select public.app_platform_update_user(actor,account_a,'{"suspended":false}','Reactivación de prueba') from platform_fixture;
select pg_temp.platform_assert((select count(*) from public.platform_support_audit a where a.workspace_id=workspace_a)=3,'exactly successful mutations are audited') from platform_fixture;
select pg_temp.platform_assert((public.app_platform_overview(actor,'users',1,'Nombre corregido',workspace_a)->>'total')::integer=1,'support profile update can be searched') from platform_fixture;
reset role;
set local role authenticated;
select pg_temp.platform_assert(public.ensure_trial_workspace('Intento de duplicar','Persona A')->>'id'=workspace_a::text,'reactivation restores the existing workspace') from platform_fixture;
select pg_temp.platform_assert((select count(*) from public.app_workspaces)=1,'reactivated account still cannot list another workspace');
reset role;
select 'PASS: global authorization, updates, audit, cross-organization denial, suspension and reactivation' as result;
rollback;
