begin;

-- Only create an event when a notification rule is active at submission time.
-- Persist the minimum payload required for delivery and bind the rule version,
-- recipients and channels so later configuration changes cannot rewrite who
-- should receive an already-created event.
create or replace function private.attest_advance_request_submission()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  project_id text;
  attestation_id text;
  data_hash text;
  rule_data jsonb;
  rule_enabled boolean := false;
  rule_version integer := 0;
  recipient_ids jsonb := '[]'::jsonb;
  advance_snapshot jsonb;
  rule_snapshot jsonb;
begin
  if new.collection_path !~ '^projects/[^/]+/advanceRequests$' then
    return new;
  end if;

  project_id := split_part(new.collection_path, '/', 2);

  if coalesce(auth.role(), '') = 'authenticated'
    and (
      new.data ->> 'projectId' is distinct from project_id
      or new.data ->> 'createdBy' is distinct from auth.uid()::text
      or lower(coalesce(new.data ->> 'requesterEmail', ''))
        is distinct from lower(coalesce(auth.jwt() ->> 'email', ''))
      or lower(coalesce(new.data ->> 'status', '')) <> 'submitted'
    )
  then
    raise exception 'Advance request creator does not match the authenticated user.'
      using errcode = '42501';
  end if;

  if lower(coalesce(new.data ->> 'status', '')) <> 'submitted' then
    return new;
  end if;

  select settings.data
  into rule_data
  from public.app_documents settings
  where settings.collection_path = 'projects/' || project_id || '/administrativeNotificationSettings'
    and settings.doc_id = 'advanceRequestSubmitted';

  rule_enabled := case lower(coalesce(rule_data ->> 'enabled', 'true'))
    when 'true' then true
    else false
  end;

  if rule_data is null
    or not rule_enabled
    or jsonb_typeof(rule_data -> 'recipientIds') <> 'array'
  then
    return new;
  end if;

  select coalesce(jsonb_agg(recipient.user_id order by recipient.ordinality), '[]'::jsonb)
  into recipient_ids
  from (
    select value as user_id, ordinality
    from jsonb_array_elements_text(rule_data -> 'recipientIds') with ordinality
    where value ~ '^[A-Za-z0-9_-]{1,180}$'
    order by ordinality
    limit 25
  ) recipient;

  if jsonb_array_length(recipient_ids) = 0 then
    return new;
  end if;

  if coalesce(rule_data ->> 'version', '') ~ '^[0-9]{1,9}$' then
    rule_version := (rule_data ->> 'version')::integer;
  end if;

  advance_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'projectId', project_id,
    'createdBy', new.data ->> 'createdBy',
    'requesterEmail', lower(new.data ->> 'requesterEmail'),
    'status', 'submitted',
    'amountRequested', new.data -> 'amountRequested',
    'purpose', coalesce(new.data -> 'purpose', new.data -> 'description'),
    'destination', new.data -> 'destination',
    'municipality', new.data -> 'municipality',
    'department', new.data -> 'department',
    'travelStart', new.data -> 'travelStart',
    'travelEnd', new.data -> 'travelEnd',
    'costCenterName', new.data -> 'costCenterName'
  ));

  rule_snapshot := jsonb_build_object(
    'enabled', true,
    'recipientIds', recipient_ids,
    'channels', jsonb_build_object(
      'inApp', true,
      'email', case lower(coalesce(rule_data #>> '{channels,email}', 'true'))
        when 'false' then false else true end,
      'push', case lower(coalesce(rule_data #>> '{channels,push}', 'true'))
        when 'false' then false else true end
    ),
    'version', rule_version
  );

  attestation_id := 'advance-request-attestation-' || md5(project_id || ':' || new.doc_id);
  data_hash := encode(digest(convert_to(advance_snapshot::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.app_documents (collection_path, doc_id, data, created_at, updated_at)
  values (
    'notification_events',
    attestation_id,
    jsonb_build_object(
      'eventType', 'advance_request_submission_attested',
      'projectId', project_id,
      'advanceId', new.doc_id,
      'creatorUserId', new.data ->> 'createdBy',
      'requesterEmail', lower(new.data ->> 'requesterEmail'),
      'notificationRuleVersion', rule_version,
      'notificationRuleSnapshot', rule_snapshot,
      'advanceCreatedAt', new.created_at,
      'advanceDataHash', data_hash,
      'advanceSnapshot', advance_snapshot,
      'attestedAt', now()
    ),
    now(),
    now()
  )
  on conflict (collection_path, doc_id) do nothing;

  return new;
end;
$$;

revoke all privileges on function private.attest_advance_request_submission() from public;
revoke all privileges on function private.attest_advance_request_submission() from anon;
revoke all privileges on function private.attest_advance_request_submission() from authenticated;

create or replace function public.app_get_attested_advance_request(
  p_project_id text,
  p_advance_id text
)
returns jsonb
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select (attestation.data -> 'advanceSnapshot') || jsonb_build_object(
    'id', attestation.data ->> 'advanceId',
    '_createdAt', attestation.data ->> 'advanceCreatedAt',
    '_updatedAt', attestation.data ->> 'attestedAt',
    '_notificationRule', attestation.data -> 'notificationRuleSnapshot'
  )
  from public.app_documents attestation
  where attestation.collection_path = 'notification_events'
    and attestation.doc_id = 'advance-request-attestation-' || md5(p_project_id || ':' || p_advance_id)
    and attestation.data ->> 'eventType' = 'advance_request_submission_attested'
    and attestation.data ->> 'projectId' = p_project_id
    and attestation.data ->> 'advanceId' = p_advance_id
    and jsonb_typeof(attestation.data -> 'advanceSnapshot') = 'object'
    and jsonb_typeof(attestation.data -> 'notificationRuleSnapshot') = 'object'
    and jsonb_typeof(attestation.data #> '{notificationRuleSnapshot,recipientIds}') = 'array'
    and jsonb_array_length(attestation.data #> '{notificationRuleSnapshot,recipientIds}') > 0
    and attestation.data #>> '{notificationRuleSnapshot,enabled}' = 'true'
    and attestation.data -> 'advanceSnapshot' ->> 'projectId' = p_project_id
    and attestation.data -> 'advanceSnapshot' ->> 'createdBy' = attestation.data ->> 'creatorUserId'
    and lower(coalesce(attestation.data -> 'advanceSnapshot' ->> 'requesterEmail', ''))
      = lower(coalesce(attestation.data ->> 'requesterEmail', ''))
    and lower(coalesce(attestation.data -> 'advanceSnapshot' ->> 'status', '')) = 'submitted'
    and attestation.data ->> 'advanceDataHash' = encode(
      digest(convert_to((attestation.data -> 'advanceSnapshot')::text, 'UTF8'), 'sha256'),
      'hex'
    )
  limit 1;
$$;

revoke all privileges on function public.app_get_attested_advance_request(text, text) from public;
revoke all privileges on function public.app_get_attested_advance_request(text, text) from anon;
revoke all privileges on function public.app_get_attested_advance_request(text, text) from authenticated;
grant execute on function public.app_get_attested_advance_request(text, text) to service_role;

commit;
