-- Real service-role RPC regression: identical account IDs in two workspaces.
-- Every fixture and changed record is rolled back; no provider APIs are called.
begin;
create temporary table rpc_tenants (a uuid, b uuid) on commit drop;
insert into rpc_tenants values(gen_random_uuid(),gen_random_uuid());
grant select on rpc_tenants to service_role;
insert into auth.users(id,email,email_confirmed_at,is_anonymous)
select a,'rpc-a-'||a||'@example.invalid',now(),false from rpc_tenants
union all select b,'rpc-b-'||b||'@example.invalid',now(),false from rpc_tenants;
insert into public.app_workspaces(id,owner_id,name,status)
select a,a,'RPC tenant A','active' from rpc_tenants
union all select b,b,'RPC tenant B','active' from rpc_tenants;
insert into public.app_documents(tenant_id,collection_path,doc_id,data)
select a,'projects/shared-project/contractorPaymentRequests','shared-account','{"status":"submitted","marker":"A"}'::jsonb from rpc_tenants
union all select b,'projects/shared-project/contractorPaymentRequests','shared-account','{"status":"submitted","marker":"B"}'::jsonb from rpc_tenants;

create function pg_temp.assert_rpc(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'RPC TEST FAILED: %',label; end if; end;
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.assert_rpc((public.app_reassign_contractor_account_approver(
  a,'shared-project','shared-account','submitted','submitted','','','','','',
  'new-approver-a','member-a','auth-a','a@example.invalid','A','event-a','{}'::jsonb)->>'applied')::boolean,
  'tenant A reassignment succeeds') from rpc_tenants;
select pg_temp.assert_rpc((public.app_reassign_contractor_account_approver(
  b,'shared-project','shared-account','submitted','submitted','','','','','',
  'new-approver-b','member-b','auth-b','b@example.invalid','B','event-b','{}'::jsonb)->>'applied')::boolean,
  'tenant B can reassign the same IDs independently') from rpc_tenants;
reset role;
select pg_temp.assert_rpc(
  (select data->>'currentApproverId' from public.app_documents where tenant_id=a and doc_id='shared-account')='new-approver-a'
  and (select data->>'currentApproverId' from public.app_documents where tenant_id=b and doc_id='shared-account')='new-approver-b',
  'service-role RPC isolates reads, row locks and updates') from rpc_tenants;

-- Operation replay IDs are unique within each workspace, not across tenants.
select set_config('pixel.server_workspace',a::text,true) from rpc_tenants;
set local role service_role;
insert into private.contractor_route_operations(operation_id,request_payload,actor_id)
values('shared-rpc-operation','{"tenant":"A"}','owner-a');
reset role;
select set_config('pixel.server_workspace',b::text,true) from rpc_tenants;
set local role service_role;
insert into private.contractor_route_operations(operation_id,request_payload,actor_id)
values('shared-rpc-operation','{"tenant":"B"}','owner-b');
reset role;
select pg_temp.assert_rpc(
  (select count(*) from private.contractor_route_operations where operation_id='shared-rpc-operation')=2,
  'idempotency operation IDs do not collide between workspaces');
select 'PASS: scoped service-role account RPC and independent idempotency keys' as result;
rollback;
