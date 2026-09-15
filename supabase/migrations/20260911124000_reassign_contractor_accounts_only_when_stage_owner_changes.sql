-- Replaces the route RPC after the initial rollout so normal route edits only
-- move accounts whose current stage actually changed owner.
create or replace function public.app_update_contractor_account_approval_route(
  p_scope text,
  p_target_id text,
  p_expected_config jsonb,
  p_next_config jsonb,
  p_target_patch jsonb,
  p_project_plans jsonb,
  p_actor jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, private
as $$
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
     where operation_id = p_operation_id
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
    from public.app_documents
   where collection_path = v_target_collection
     and doc_id = p_target_id
   for update;

  if not found then
    delete from private.contractor_route_operations where operation_id = p_operation_id;
    return jsonb_build_object('applied', false, 'reason', 'target_not_found');
  end if;

  v_current_config := case
    when jsonb_typeof(v_target_data -> 'contractorAccountApprovalConfig') = 'object'
      then v_target_data -> 'contractorAccountApprovalConfig'
    else '{}'::jsonb
  end;

  if v_current_config is distinct from coalesce(p_expected_config, '{}'::jsonb) then
    delete from private.contractor_route_operations where operation_id = p_operation_id;
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
        from public.app_documents
       where collection_path = 'projects'
         and doc_id = v_project_plan ->> 'projectId'
       for update;

      if not found then
        delete from private.contractor_route_operations where operation_id = p_operation_id;
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
      delete from private.contractor_route_operations where operation_id = p_operation_id;
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
      from public.app_documents
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
        from public.app_documents
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
        delete from private.contractor_route_operations where operation_id = p_operation_id;
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
        delete from private.contractor_route_operations where operation_id = p_operation_id;
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

      update public.app_documents
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

  update public.app_documents
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
   where operation_id = p_operation_id;

  return v_existing_operation.result;
end;
$$;

revoke all on function public.app_update_contractor_account_approval_route(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text
) from public, anon, authenticated;

grant execute on function public.app_update_contractor_account_approval_route(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, text
) to service_role;
