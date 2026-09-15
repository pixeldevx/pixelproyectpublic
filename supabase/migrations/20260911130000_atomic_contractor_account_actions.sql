-- Serializes every state-changing contractor-account action. The HTTP route
-- authenticates the caller and resolves directory aliases; this service-role-
-- only RPC rechecks ownership, route configuration, state and evidence under
-- database locks before committing the account and its audit trail together.
create schema if not exists private;

create table if not exists private.contractor_account_action_operations (
  operation_id text primary key,
  project_id text not null,
  account_id text not null,
  action text not null,
  request_payload jsonb not null,
  actor_id text not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

revoke all on table private.contractor_account_action_operations
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete
  on table private.contractor_account_action_operations to service_role;

create or replace function public.app_apply_contractor_account_action(
  p_project_id text,
  p_account_id text,
  p_action text,
  p_operation_id text,
  p_expected_status text,
  p_expected_stage text,
  p_expected_assignment_event_id text,
  p_organization_id text,
  p_expected_project_config jsonb,
  p_expected_organization_config jsonb,
  p_actor jsonb,
  p_is_global_admin boolean,
  p_current_owner_aliases jsonb,
  p_next_assignment jsonb,
  p_comment text default '',
  p_signature jsonb default null,
  p_accounting_reference text default null,
  p_accounting_note text default null,
  p_payment_support jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
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
     where operation_id = btrim(p_operation_id)
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
      from public.app_documents as document
     where document.collection_path = 'organizations'
       and document.doc_id = btrim(p_organization_id)
     for update;

    if not found then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'stale_organization');
    end if;
  end if;

  select document.data
    into v_project
    from public.app_documents as document
   where document.collection_path = 'projects'
     and document.doc_id = btrim(p_project_id)
   for update;

  if not found then
    delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
    delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
    delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'stale_config');
  end if;

  v_collection_path := format('projects/%s/contractorPaymentRequests', btrim(p_project_id));
  select document.data
    into v_account
    from public.app_documents as document
   where document.collection_path = v_collection_path
     and document.doc_id = btrim(p_account_id)
   for update;

  if not found then
    delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'not_found');
  end if;

  v_current_status := coalesce(nullif(btrim(v_account ->> 'status'), ''), 'submitted');
  v_current_stage := coalesce(nullif(btrim(v_account ->> 'currentApprovalStage'), ''), v_current_status);
  v_current_assignment_event_id := coalesce(nullif(btrim(v_account ->> 'currentAssignmentEventId'), ''), '');

  if v_current_status is distinct from btrim(p_expected_status)
     or v_current_stage is distinct from btrim(p_expected_stage)
     or v_current_assignment_event_id is distinct from coalesce(nullif(btrim(p_expected_assignment_event_id), ''), '') then
    delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
    delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
    return jsonb_build_object('applied', false, 'reason', 'forbidden');
  end if;

  if p_action = 'reactivate' then
    if not coalesce(p_is_global_admin, false) or v_current_status <> 'returned' then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    v_next_status := nullif(btrim(v_account ->> 'returnedFromStage'), '');
    if v_next_status is null or v_next_status not in (
      'submitted', 'boss_approved', 'operations_approved',
      'quality_approved', 'hr_approved', 'accounted'
    ) then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
  elsif p_action = 'account' then
    if v_current_status <> 'hr_approved' then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    if coalesce(btrim(p_accounting_reference), '') = '' then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_accounting_reference');
    end if;
    v_next_status := 'accounted';
  elsif p_action = 'pay' then
    if v_current_status <> 'accounted' then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    if coalesce(jsonb_typeof(p_payment_support), '') <> 'object'
       or coalesce(btrim(p_payment_support ->> 'documentId'), '') = ''
       or coalesce(btrim(p_payment_support ->> 'storagePath'), '') = '' then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_payment_support');
    end if;
    v_next_status := 'paid';
  elsif p_action in ('return', 'reject') then
    if v_current_status not in (
      'submitted', 'boss_approved', 'operations_approved',
      'quality_approved', 'hr_approved', 'accounted'
    ) then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'invalid_transition');
    end if;
    if coalesce(btrim(p_comment), '') = '' then
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
      return jsonb_build_object('applied', false, 'reason', 'missing_signature');
    end if;
  end if;

  if p_action = 'pay' then
    select document.data
      into v_payment_document
      from public.app_documents as document
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
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
      delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
        delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
        delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
        return jsonb_build_object('applied', false, 'reason', 'missing_responsible');
      end if;
      if lower(v_assignment_id) <> lower(v_expected_configured_id)
         or lower(coalesce(btrim(p_next_assignment ->> 'configuredId'), '')) <> lower(v_expected_configured_id) then
        delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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

  update public.app_documents as document
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
    delete from private.contractor_account_action_operations where operation_id = btrim(p_operation_id);
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
   where operation_id = btrim(p_operation_id);

  return v_result;
end;
$$;

revoke all on function public.app_apply_contractor_account_action(
  text, text, text, text, text, text, text, text, jsonb, jsonb,
  jsonb, boolean, jsonb, jsonb, text, jsonb, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.app_apply_contractor_account_action(
  text, text, text, text, text, text, text, text, jsonb, jsonb,
  jsonb, boolean, jsonb, jsonb, text, jsonb, text, text, jsonb
) to service_role;
