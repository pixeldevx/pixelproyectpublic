-- Run only after workspace_trials. Every test account, workspace, document and
-- Storage metadata row is temporary to this transaction. No emails or passwords.
begin;

create temporary table workspace_test_fixture (
  user_a uuid, user_b uuid, unconfirmed_user uuid,
  workspace_a uuid, workspace_b uuid,
  layer_a uuid, layer_b uuid,
  started_at timestamptz
) on commit drop;
insert into workspace_test_fixture(user_a,user_b,unconfirmed_user,layer_a,layer_b,started_at)
values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),now());
grant select,update on workspace_test_fixture to authenticated;
grant select on workspace_test_fixture to anon;

create function pg_temp.assert_true(condition boolean, label text) returns void
language plpgsql as $$ begin
  if condition is distinct from true then raise exception 'ISOLATION TEST FAILED: %',label; end if;
end $$;
create function pg_temp.expect_rejected(statement text, label text) returns void
language plpgsql as $$ begin
  begin
    execute statement;
  exception when insufficient_privilege or check_violation or foreign_key_violation then
    return;
  end;
  raise exception 'ISOLATION TEST FAILED (write unexpectedly succeeded): %',label;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous,raw_user_meta_data)
select user_a,'authenticated','authenticated','pixel-isolation-'||user_a||'@example.invalid',now(),false,
  '{"role":"platform_admin","workspace_id":"forged-metadata-is-ignored"}'::jsonb from workspace_test_fixture
union all
select user_b,'authenticated','authenticated','pixel-isolation-'||user_b||'@example.invalid',now(),false,'{}'::jsonb from workspace_test_fixture
union all
select unconfirmed_user,'authenticated','authenticated','pixel-isolation-'||unconfirmed_user||'@example.invalid',null,false,'{}'::jsonb from workspace_test_fixture;

select set_config('request.jwt.claim.sub',user_a::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',user_a,'role','authenticated','email','pixel-isolation-'||user_a||'@example.invalid')::text,true)
from workspace_test_fixture;
set local role authenticated;
update workspace_test_fixture set workspace_a=(public.ensure_trial_workspace('Organización A de prueba','Ana de prueba')->>'id')::uuid;
select pg_temp.assert_true(
  (public.ensure_trial_workspace('No debe crear otro espacio','Otro nombre')->>'id')::uuid=workspace_a,
  'onboarding retries reuse the same workspace') from workspace_test_fixture;
select pg_temp.assert_true(
  (select count(*) from public.app_workspaces)=1 and (select count(*) from public.app_workspace_members)=1,
  'workspace owner only sees one workspace and its own membership');
select pg_temp.assert_true(
  public.my_workspace()->>'name'='Organización A de prueba' and public.my_workspace()->>'role'='admin',
  'display metadata cannot set a platform role or replace the workspace');
select pg_temp.assert_true(
  (public.my_workspace()->>'trial_ends_at')::timestamptz between now()+interval '13 days 23 hours' and now()+interval '14 days 1 hour',
  'trial duration is fixed by the database');

insert into public.app_documents(tenant_id,collection_path,doc_id,data)
select workspace_a,'settings','isolation-shared-id','{"marker":"A"}' from workspace_test_fixture;
insert into public.app_documents(tenant_id,collection_path,doc_id,data)
select workspace_a,'projects','isolation-shared-project','{"name":"Proyecto A"}' from workspace_test_fixture;
insert into public.app_documents(tenant_id,collection_path,doc_id,data)
select workspace_a,'projects/isolation-shared-project/tasks','isolation-shared-task','{"title":"Tarea A"}' from workspace_test_fixture;
insert into public.project_spatial_layers(id,tenant_id,project_id,name,storage_path)
select layer_a,workspace_a,'isolation-shared-project','Capa A','workspaces/'||workspace_a||'/isolation-a.geojson' from workspace_test_fixture;
insert into public.project_spatial_features(tenant_id,layer_id,project_id,properties)
select workspace_a,layer_a,'isolation-shared-project','{"marker":"A"}' from workspace_test_fixture;
insert into public.project_spatial_annotations(tenant_id,project_id,annotation_type,title,geometry)
select workspace_a,'isolation-shared-project','label','Anotación A','{}' from workspace_test_fixture;
insert into storage.objects(bucket_id,name,owner)
select 'pixel-project-files','workspaces/'||workspace_a||'/isolation-test.txt',user_a from workspace_test_fixture;

reset role;
select set_config('request.jwt.claim.sub',user_b::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',user_b,'role','authenticated','email','pixel-isolation-'||user_b||'@example.invalid')::text,true)
from workspace_test_fixture;
set local role authenticated;
update workspace_test_fixture set workspace_b=(public.ensure_trial_workspace('Organización B de prueba','Bruno de prueba')->>'id')::uuid;
select pg_temp.assert_true(workspace_a<>workspace_b,'different users receive different workspaces') from workspace_test_fixture;
select pg_temp.assert_true(
  (select count(*) from public.app_workspaces)=1 and (select count(*) from public.app_workspace_members)=1,
  'user B cannot enumerate user A membership or workspace');
insert into public.app_documents(tenant_id,collection_path,doc_id,data)
select workspace_b,'settings','isolation-shared-id','{"marker":"B"}' from workspace_test_fixture;
insert into public.app_documents(tenant_id,collection_path,doc_id,data)
select workspace_b,'projects','isolation-shared-project','{"name":"Proyecto B"}' from workspace_test_fixture;
insert into public.app_documents(tenant_id,collection_path,doc_id,data)
select workspace_b,'projects/isolation-shared-project/tasks','isolation-shared-task','{"title":"Tarea B"}' from workspace_test_fixture;
insert into public.project_spatial_layers(id,tenant_id,project_id,name,storage_path)
select layer_b,workspace_b,'isolation-shared-project','Capa B','workspaces/'||workspace_b||'/isolation-b.geojson' from workspace_test_fixture;
insert into public.project_spatial_features(tenant_id,layer_id,project_id,properties)
select workspace_b,layer_b,'isolation-shared-project','{"marker":"B"}' from workspace_test_fixture;
insert into public.project_spatial_annotations(tenant_id,project_id,annotation_type,title,geometry)
select workspace_b,'isolation-shared-project','label','Anotación B','{}' from workspace_test_fixture;
insert into storage.objects(bucket_id,name,owner)
select 'pixel-project-files','workspaces/'||workspace_b||'/isolation-test.txt',user_b from workspace_test_fixture;
select pg_temp.assert_true(
  (select count(*) from public.app_documents where collection_path='settings' and doc_id='isolation-shared-id')=1
  and (select data->>'marker' from public.app_documents where collection_path='settings' and doc_id='isolation-shared-id')='B',
  'identical setting IDs are isolated');
select pg_temp.assert_true(
  (select count(*) from public.app_documents where collection_group='tasks' and doc_id='isolation-shared-task')=1
  and (select data->>'title' from public.app_documents where collection_group='tasks' and doc_id='isolation-shared-task')='Tarea B',
  'nested and collection-group reads remain isolated');
select pg_temp.assert_true(
  (select count(*) from public.project_spatial_layers where project_id='isolation-shared-project')=1
  and (select count(*) from public.project_spatial_features where project_id='isolation-shared-project')=1
  and (select count(*) from public.project_spatial_annotations where project_id='isolation-shared-project')=1,
  'all spatial tables enforce the workspace');
select pg_temp.assert_true(
  (select count(*) from storage.objects where name like 'workspaces/%/isolation-test.txt')=1,
  'Storage metadata read only sees own object');

select pg_temp.expect_rejected(format('insert into public.app_documents(tenant_id,collection_path,doc_id,data) values (%L,''projects'',''forged'',''{}'')',workspace_a),'forged tenant insert') from workspace_test_fixture;
select pg_temp.expect_rejected(format('insert into public.app_documents(tenant_id,collection_path,doc_id,data) values (%L,''settings'',''isolation-shared-id'',''{"marker":"ATTACK"}'') on conflict(tenant_id,collection_path,doc_id) do update set data=excluded.data',workspace_a),'cross-tenant upsert') from workspace_test_fixture;
select pg_temp.expect_rejected(format('update public.app_documents set tenant_id=%L where collection_path=''settings'' and doc_id=''isolation-shared-id''',workspace_a),'moving own document into another workspace') from workspace_test_fixture;
with changed as (
  update public.app_documents set data='{"marker":"ATTACK"}' where tenant_id=(select workspace_a from workspace_test_fixture) returning 1
) select pg_temp.assert_true(count(*)=0,'cross-tenant update affects no records') from changed;
with deleted as (
  delete from public.app_documents where tenant_id=(select workspace_a from workspace_test_fixture) returning 1
) select pg_temp.assert_true(count(*)=0,'cross-tenant delete affects no records') from deleted;
select pg_temp.expect_rejected('update public.app_documents set data=data||''{"role":"superadmin"}''::jsonb where collection_path=''users''','own profile cannot change role');
select pg_temp.expect_rejected(format('update public.app_documents set data=data||jsonb_build_object(''organizationId'',%L) where collection_path=''users''',workspace_a),'profile cannot choose another organization') from workspace_test_fixture;
select pg_temp.expect_rejected(format('insert into public.app_documents(tenant_id,collection_path,doc_id,data) values (%L,''users'',''fake-user'',''{"role":"admin"}'')',workspace_b),'browser cannot provision profiles') from workspace_test_fixture;
select pg_temp.expect_rejected('update public.app_workspace_members set role=''owner''','membership role cannot be changed by the browser');
select pg_temp.expect_rejected(format('update public.app_workspace_members set workspace_id=%L',workspace_a),'membership cannot move into another workspace') from workspace_test_fixture;
select pg_temp.expect_rejected('update public.app_workspaces set status=''active'',trial_ends_at=null','trial cannot be upgraded by the browser');
select pg_temp.expect_rejected(format('insert into public.project_spatial_features(tenant_id,layer_id,project_id) values (%L,%L,''isolation-shared-project'')',workspace_b,layer_a),'feature cannot refer to a foreign workspace layer') from workspace_test_fixture;
select pg_temp.expect_rejected(format('insert into storage.objects(bucket_id,name) values (''pixel-project-files'',%L)','workspaces/'||workspace_a||'/forged.txt'),'upload cannot use another workspace prefix') from workspace_test_fixture;
select pg_temp.expect_rejected('insert into storage.objects(bucket_id,name) values (''pixel-project-files'',''legacy/unscoped-test.txt'')','trial cannot upload to legacy unscoped storage');
select pg_temp.assert_true(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('app_apply_contractor_account_action','app_update_contractor_account_approval_route','app_reassign_contractor_account_approver')
    and has_function_privilege(current_user,p.oid,'execute')
),'contractor privileged RPC execution is denied to browser accounts');

-- The same SELECT predicates used to authorize Realtime rows must reject
-- another tenant; no websocket delivery is simulated by this database test.
select pg_temp.assert_true(
  not exists(select 1 from public.app_documents where tenant_id=(select workspace_a from workspace_test_fixture)),
  'Realtime SELECT authorization does not reveal another tenant');
reset role;
select pg_temp.assert_true(
  (select data->>'marker' from public.app_documents where tenant_id=workspace_a and collection_path='settings' and doc_id='isolation-shared-id')='A',
  'user A data survived all attempted writes') from workspace_test_fixture;

-- Unconfirmed email cannot activate an organization.
select set_config('request.jwt.claim.sub',unconfirmed_user::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',unconfirmed_user,'role','authenticated')::text,true)
from workspace_test_fixture;
set local role authenticated;
select pg_temp.expect_rejected('select public.ensure_trial_workspace(''Premature workspace'',''Unconfirmed'')','unconfirmed registration denied');
select pg_temp.assert_true(public.my_workspace() is null,'unconfirmed account has no workspace');
reset role;

-- Expiry is enforced by the database even if the browser clock is wrong.
update public.app_workspaces set trial_ends_at=now()-interval '1 second'
where id=(select workspace_b from workspace_test_fixture);
select set_config('request.jwt.claim.sub',user_b::text,true),
  set_config('request.jwt.claims',jsonb_build_object('sub',user_b,'role','authenticated','email','pixel-isolation-'||user_b||'@example.invalid')::text,true)
from workspace_test_fixture;
set local role authenticated;
select pg_temp.assert_true(
  (select count(*) from public.app_documents)=1
  and exists(select 1 from public.app_documents where collection_path='users' and doc_id=auth.uid()::text),
  'expired user retains own profile access only');
select pg_temp.assert_true((public.ensure_trial_workspace(''::text,''::text)->>'id')::uuid=workspace_b
  and (public.my_workspace()->>'trial_ends_at')::timestamptz<now(),
  'retrying expired onboarding neither duplicates nor renews trial') from workspace_test_fixture;
select pg_temp.expect_rejected(format('insert into public.app_documents(tenant_id,collection_path,doc_id,data) values (%L,''projects'',''after-expiry'',''{}'')',workspace_b),'expired workspace rejects writes') from workspace_test_fixture;
select pg_temp.assert_true((select count(*) from public.project_spatial_layers)=0
  and (select count(*) from public.project_spatial_features)=0
  and (select count(*) from public.project_spatial_annotations)=0,
  'expired workspace cannot read spatial data');
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id='pixel-project-files')=0,'expired workspace cannot read files');
select pg_temp.expect_rejected(format('insert into storage.objects(bucket_id,name) values (''pixel-project-files'',%L)','workspaces/'||workspace_b||'/expired.txt'),'expired workspace cannot upload') from workspace_test_fixture;
reset role;

select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.expect_rejected('select * from public.app_documents','anonymous document access denied');
select pg_temp.expect_rejected('select * from public.app_workspaces','anonymous workspace access denied');
select pg_temp.expect_rejected('select * from public.app_workspace_members','anonymous membership access denied');
select pg_temp.expect_rejected('select public.ensure_trial_workspace(''Anonymous'',''Anonymous'')','anonymous onboarding denied');
reset role;

select pg_temp.assert_true(not coalesce((select pubdelete from pg_publication where pubname='supabase_realtime'),false),
  'Realtime does not publish DELETE events that bypass row isolation');

select 'PASS: onboarding, tenant isolation, nested documents, profiles, memberships, spatial data, private storage, expiry and anonymous denial' as result;
rollback;
