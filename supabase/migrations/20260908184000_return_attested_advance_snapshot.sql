begin;

-- Return the exact payload validated by PostgreSQL in the same statement. A
-- boolean check followed by use of an earlier browser-readable snapshot leaves
-- a race where the payload can change between those two moments.
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
  select advance.data || jsonb_build_object(
    'id', advance.doc_id,
    '_createdAt', advance.created_at,
    '_updatedAt', advance.updated_at
  )
  from public.app_documents advance
  join public.app_documents attestation
    on attestation.collection_path = 'notification_events'
   and attestation.doc_id = 'advance-request-attestation-' || md5(p_project_id || ':' || p_advance_id)
  join public.app_documents settings
    on settings.collection_path = 'projects/' || p_project_id || '/administrativeNotificationSettings'
   and settings.doc_id = 'advanceRequestSubmitted'
  where advance.collection_path = 'projects/' || p_project_id || '/advanceRequests'
    and advance.doc_id = p_advance_id
    and lower(coalesce(advance.data ->> 'status', '')) = 'submitted'
    and coalesce((settings.data ->> 'enabled')::boolean, true) is true
    and exists (
      select 1
      from jsonb_array_elements_text(
        coalesce(settings.data -> 'authorizedRequesterUserIds', '[]'::jsonb)
      ) requester(user_id)
      where requester.user_id = advance.data ->> 'createdBy'
    )
    and attestation.data ->> 'eventType' = 'advance_request_submission_attested'
    and attestation.data ->> 'projectId' = p_project_id
    and attestation.data ->> 'advanceId' = p_advance_id
    and attestation.data ->> 'creatorUserId' = advance.data ->> 'createdBy'
    and coalesce(attestation.data ->> 'requesterId', '') = coalesce(advance.data ->> 'requesterId', '')
    and lower(coalesce(attestation.data ->> 'requesterEmail', '')) = lower(coalesce(advance.data ->> 'requesterEmail', ''))
    and (attestation.data ->> 'advanceCreatedAt')::timestamptz = advance.created_at
    and attestation.data ->> 'advanceDataHash' = encode(
      digest(convert_to(advance.data::text, 'UTF8'), 'sha256'),
      'hex'
    )
  limit 1;
$$;

revoke all privileges on function public.app_get_attested_advance_request(text, text) from public;
revoke all privileges on function public.app_get_attested_advance_request(text, text) from anon;
revoke all privileges on function public.app_get_attested_advance_request(text, text) from authenticated;
grant execute on function public.app_get_attested_advance_request(text, text) to service_role;

commit;
