create or replace function public.app_reassign_contractor_account_approver(
  p_project_id text,
  p_account_id text,
  p_expected_status text,
  p_expected_stage text,
  p_expected_assignment_event_id text,
  p_expected_approver_id text,
  p_expected_approver_member_id text,
  p_expected_approver_auth_user_id text,
  p_expected_approver_email text,
  p_next_approver_id text,
  p_next_approver_member_id text,
  p_next_approver_auth_user_id text,
  p_next_approver_email text,
  p_next_approver_label text,
  p_next_assignment_event_id text,
  p_history_entry jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_collection_path text := format('projects/%s/contractorPaymentRequests', p_project_id);
  v_data jsonb;
  v_status text;
  v_stage text;
  v_history jsonb;
  v_now timestamptz := clock_timestamp();
begin
  select data
    into v_data
    from public.app_documents
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

  update public.app_documents
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
$$;

revoke all on function public.app_reassign_contractor_account_approver(
  text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.app_reassign_contractor_account_approver(
  text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, text, jsonb
) to service_role;

create schema if not exists private;

create table if not exists private.contractor_route_operations (
  operation_id text primary key,
  request_payload jsonb not null,
  actor_id text not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

revoke all on schema private from public, anon;
revoke all on table private.contractor_route_operations from public, anon, authenticated;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on table private.contractor_route_operations to service_role;

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

-- Preserve the legacy behavior during the split: existing routes initially use
-- their former accounting/payment owner for the new Administration step. An
-- administrator can then select a different person in the new field.
update public.app_documents
   set data = jsonb_set(
     data,
     '{contractorAccountApprovalConfig,administrationId}',
     to_jsonb(data -> 'contractorAccountApprovalConfig' ->> 'accountingId'),
     true
   ),
       updated_at = clock_timestamp()
 where collection_path in ('projects', 'organizations')
   and jsonb_typeof(data -> 'contractorAccountApprovalConfig') = 'object'
   and coalesce(data -> 'contractorAccountApprovalConfig' ->> 'accountingId', '') <> ''
   and coalesce(data -> 'contractorAccountApprovalConfig' ->> 'administrationId', '') = '';

-- Bring already-open accounts into line with the effective route. This repairs
-- assignments created before route edits started reconciling the live inbox.
with account_context as (
  select
    account.collection_path,
    account.doc_id,
    account.data,
    project.doc_id as project_id,
    project.data as project_data,
    organization.data as organization_data,
    coalesce(nullif(account.data ->> 'status', ''), 'submitted') as status,
    case coalesce(nullif(account.data ->> 'status', ''), 'submitted')
      when 'submitted' then 'immediateBossId'
      when 'boss_approved' then 'operationsManagerId'
      when 'operations_approved' then 'qualityComplianceId'
      when 'quality_approved' then 'humanTalentId'
      when 'hr_approved' then 'accountingId'
      when 'accounted' then 'administrationId'
    end as config_key
  from public.app_documents account
  join public.app_documents project
    on project.collection_path = 'projects'
   and account.collection_path = format(
     'projects/%s/contractorPaymentRequests',
     project.doc_id
   )
  left join public.app_documents organization
    on organization.collection_path = 'organizations'
   and organization.doc_id = coalesce(
     project.data -> 'organizationIds' ->> 0,
     project.data ->> 'organizationId'
   )
  where coalesce(nullif(account.data ->> 'status', ''), 'submitted') in (
    'submitted',
    'boss_approved',
    'operations_approved',
    'quality_approved',
    'hr_approved',
    'accounted'
  )
), desired_route as (
  select
    context.*,
    coalesce(
      nullif(context.project_data -> 'contractorAccountApprovalConfig' ->> context.config_key, ''),
      nullif(context.organization_data -> 'contractorAccountApprovalConfig' ->> context.config_key, ''),
      case when context.config_key = 'administrationId' then
        coalesce(
          nullif(context.project_data -> 'contractorAccountApprovalConfig' ->> 'accountingId', ''),
          nullif(context.organization_data -> 'contractorAccountApprovalConfig' ->> 'accountingId', '')
        )
      end
    ) as route_id
  from account_context context
), resolved_route as (
  select desired.*, person.*
  from desired_route desired
  left join lateral (
    select
      candidate.member_id,
      candidate.auth_user_id,
      candidate.email,
      candidate.display_name
    from (
      select
        0 as priority,
        member.doc_id as member_id,
        coalesce(
          nullif(member.data ->> 'authUserId', ''),
          nullif(member.data ->> 'userId', ''),
          nullif(member.data ->> 'uid', ''),
          linked_user.doc_id
        ) as auth_user_id,
        lower(coalesce(nullif(member.data ->> 'email', ''), linked_user.data ->> 'email')) as email,
        coalesce(
          nullif(member.data ->> 'name', ''),
          nullif(member.data ->> 'displayName', ''),
          nullif(member.data ->> 'fullName', ''),
          nullif(linked_user.data ->> 'displayName', ''),
          nullif(linked_user.data ->> 'name', ''),
          nullif(member.data ->> 'email', ''),
          member.doc_id
        ) as display_name
      from public.app_documents member
      left join lateral (
        select user_profile.doc_id, user_profile.data
        from public.app_documents user_profile
        where user_profile.collection_path = 'users'
          and (
            user_profile.doc_id = member.data ->> 'authUserId'
            or lower(coalesce(user_profile.data ->> 'email', '')) = lower(coalesce(member.data ->> 'email', ''))
          )
        order by (user_profile.doc_id = member.data ->> 'authUserId') desc, user_profile.doc_id
        limit 1
      ) linked_user on true
      where member.collection_path = 'team_members'
        and (
          member.doc_id = desired.route_id
          or member.data ->> 'id' = desired.route_id
          or member.data ->> 'authUserId' = desired.route_id
          or member.data ->> 'userId' = desired.route_id
          or member.data ->> 'uid' = desired.route_id
          or lower(coalesce(member.data ->> 'email', '')) = lower(coalesce(desired.route_id, ''))
        )

      union all

      select
        1 as priority,
        desired.route_id as member_id,
        user_profile.doc_id as auth_user_id,
        lower(nullif(user_profile.data ->> 'email', '')) as email,
        coalesce(
          nullif(user_profile.data ->> 'displayName', ''),
          nullif(user_profile.data ->> 'name', ''),
          nullif(user_profile.data ->> 'email', ''),
          user_profile.doc_id
        ) as display_name
      from public.app_documents user_profile
      where user_profile.collection_path = 'users'
        and (
          user_profile.doc_id = desired.route_id
          or user_profile.data ->> 'id' = desired.route_id
          or user_profile.data ->> 'authUserId' = desired.route_id
          or user_profile.data ->> 'uid' = desired.route_id
          or lower(coalesce(user_profile.data ->> 'email', '')) = lower(coalesce(desired.route_id, ''))
        )
    ) candidate
    order by candidate.priority, candidate.member_id
    limit 1
  ) person on true
), accounts_to_update as (
  select *
  from resolved_route resolved
  where coalesce(resolved.route_id, '') <> ''
    and coalesce(resolved.member_id, '') <> ''
    and not exists (
      select 1
      from unnest(array[
        resolved.data ->> 'currentApproverId',
        resolved.data ->> 'currentApproverMemberId',
        resolved.data ->> 'currentApproverAuthUserId',
        resolved.data ->> 'currentApproverEmail'
      ]) current_alias(value)
      cross join unnest(array[
        resolved.route_id,
        resolved.member_id,
        resolved.auth_user_id,
        resolved.email
      ]) desired_alias(value)
      where coalesce(current_alias.value, '') <> ''
        and coalesce(desired_alias.value, '') <> ''
        and lower(current_alias.value) = lower(desired_alias.value)
    )
), updated_accounts as (
  update public.app_documents target
     set data = target.data || jsonb_build_object(
       'currentApprovalStage', source.status,
       'currentApproverId', source.route_id,
       'currentApproverMemberId', source.member_id,
       'currentApproverAuthUserId', source.auth_user_id,
       'currentApproverEmail', source.email,
       'currentApproverLabel', case source.status
         when 'submitted' then 'Jefe inmediato'
         when 'boss_approved' then 'Gerencia de operaciones'
         when 'operations_approved' then 'Calidad y cumplimiento'
         when 'quality_approved' then 'Talento humano'
         when 'hr_approved' then 'Contabilidad'
         when 'accounted' then 'Administración y pago'
       end,
       'currentAssignmentEventId', left(format('route:migration-20260911:%s', source.doc_id), 180),
       'approvalRouteReassignmentHistory', (
         case
           when jsonb_typeof(target.data -> 'approvalRouteReassignmentHistory') = 'array'
             then target.data -> 'approvalRouteReassignmentHistory'
           else '[]'::jsonb
         end
       ) || jsonb_build_array(jsonb_build_object(
         'eventId', left(format('route:migration-20260911:%s', source.doc_id), 180),
         'operationId', 'migration-20260911',
         'stage', source.status,
         'configKey', source.config_key,
         'scope', 'project',
         'scopeId', source.project_id,
         'fromApproverId', nullif(target.data ->> 'currentApproverId', ''),
         'fromApproverMemberId', nullif(target.data ->> 'currentApproverMemberId', ''),
         'fromApproverAuthUserId', nullif(target.data ->> 'currentApproverAuthUserId', ''),
         'fromApproverEmail', nullif(target.data ->> 'currentApproverEmail', ''),
         'fromApproverName', coalesce(
           nullif(target.data ->> 'currentApproverEmail', ''),
           nullif(target.data ->> 'currentApproverId', ''),
           'Sin responsable'
         ),
         'toApproverId', source.route_id,
         'toApproverMemberId', source.member_id,
         'toApproverAuthUserId', source.auth_user_id,
         'toApproverName', source.display_name,
         'toApproverEmail', source.email,
         'actorName', 'Actualización automática de Pixel',
         'reason', 'Conciliación inicial de la ruta de cuentas de cobro',
         'at', clock_timestamp()
       )),
       'updatedAt', clock_timestamp()
     ),
         updated_at = clock_timestamp()
    from accounts_to_update source
   where target.collection_path = source.collection_path
     and target.doc_id = source.doc_id
  returning target.collection_path, target.doc_id, target.data
), superseded_alerts as (
  update public.app_documents alert
     set data = alert.data || jsonb_build_object(
       'status', 'superseded',
       'supersededAt', clock_timestamp(),
       'supersededByAssigneeId', updated.data ->> 'currentApproverId',
       'updatedAt', clock_timestamp()
     ),
         updated_at = clock_timestamp()
    from updated_accounts updated
   where alert.collection_path = 'alerts'
     and alert.data ->> 'projectId' = split_part(updated.collection_path, '/', 2)
     and alert.data ->> 'taskId' = updated.doc_id
     and alert.data ->> 'type' = 'administrative_approval'
     and coalesce(alert.data ->> 'status', 'unread') not in ('read', 'superseded', 'dismissed')
  returning alert.doc_id
)
insert into public.app_documents (collection_path, doc_id, data, created_at, updated_at)
select
  'alerts',
  left(updated.data ->> 'currentAssignmentEventId', 170) || ':alert',
  jsonb_build_object(
    'userId', coalesce(
      nullif(updated.data ->> 'currentApproverAuthUserId', ''),
      updated.data ->> 'currentApproverId'
    ),
    'email', nullif(updated.data ->> 'currentApproverEmail', ''),
    'type', 'administrative_approval',
    'status', 'unread',
    'title', 'Cuenta de cobro pendiente',
    'message', format(
      'Revisar cuenta de cobro de %s',
      coalesce(nullif(updated.data ->> 'contractorName', ''), 'contratista')
    ),
    'projectId', split_part(updated.collection_path, '/', 2),
    'taskId', updated.doc_id,
    'eventType', 'contractor_account_assigned',
    'actionUrl', format(
      '/projects/%s?tab=administration&workspace=contractorAccounts&contractorAccountId=%s',
      split_part(updated.collection_path, '/', 2),
      updated.doc_id
    ),
    'createdAt', clock_timestamp(),
    'updatedAt', clock_timestamp()
  ),
  clock_timestamp(),
  clock_timestamp()
from updated_accounts updated
on conflict (collection_path, doc_id) do update
set data = excluded.data,
    updated_at = excluded.updated_at;

create or replace function public.app_protect_contractor_account_route_config()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated'
     and new.collection_path in ('projects', 'organizations')
     and (
       new.data -> 'contractorAccountApprovalConfig' is distinct from old.data -> 'contractorAccountApprovalConfig'
       or new.data -> 'contractorAccountApprovalConfigRevision' is distinct from old.data -> 'contractorAccountApprovalConfigRevision'
       or new.data -> 'contractorAccountApprovalConfigLastOperationId' is distinct from old.data -> 'contractorAccountApprovalConfigLastOperationId'
     ) then
    raise exception 'contractor_account_route_must_be_updated_by_server'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists app_protect_contractor_account_route_config
  on public.app_documents;

create trigger app_protect_contractor_account_route_config
before update of data on public.app_documents
for each row
execute function public.app_protect_contractor_account_route_config();

revoke all on function public.app_protect_contractor_account_route_config()
  from public, anon, authenticated;
