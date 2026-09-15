begin;

-- Browser versions already in the field may still implement updateDoc with
-- INSERT ... ON CONFLICT DO UPDATE. Validate in the AFTER INSERT trigger so it
-- runs only when Postgres really inserted a new request, never on the UPDATE
-- branch of an upsert.
drop policy if exists "advance requests bind creator on insert" on public.app_documents;

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

  -- The global administrator authorizes this server-only membership snapshot
  -- whenever the notification rule is saved. Without it, the request remains
  -- valid but cannot generate an additional alert.
  if rule_data is null
    or coalesce((rule_data ->> 'enabled')::boolean, true) is false
    or not exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(rule_data -> 'authorizedRequesterUserIds', '[]'::jsonb)
      ) requester(user_id)
      where requester.user_id = new.data ->> 'createdBy'
    )
  then
    return new;
  end if;

  attestation_id := 'advance-request-attestation-' || md5(project_id || ':' || new.doc_id);
  data_hash := encode(digest(convert_to(new.data::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.app_documents (collection_path, doc_id, data, created_at, updated_at)
  values (
    'notification_events',
    attestation_id,
    jsonb_build_object(
      'eventType', 'advance_request_submission_attested',
      'projectId', project_id,
      'advanceId', new.doc_id,
      'creatorUserId', new.data ->> 'createdBy',
      'requesterId', new.data ->> 'requesterId',
      'requesterEmail', lower(new.data ->> 'requesterEmail'),
      'notificationRuleVersion', coalesce((rule_data ->> 'version')::integer, 0),
      'advanceCreatedAt', new.created_at,
      'advanceDataHash', data_hash,
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

commit;
