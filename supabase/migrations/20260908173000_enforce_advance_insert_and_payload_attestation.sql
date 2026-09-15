begin;

-- updateDoc now issues a real UPDATE, so inserts can once again be protected
-- strictly without interfering with legitimate state transitions.
drop trigger if exists app_documents_validate_new_advance_request_submission on public.app_documents;
drop function if exists private.validate_new_advance_request_submission();

drop policy if exists "advance requests bind creator on insert" on public.app_documents;
create policy "advance requests bind creator on insert"
on public.app_documents
as restrictive
for insert
to authenticated
with check (
  collection_path !~ '^projects/[^/]+/advanceRequests$'
  or (
    data ->> 'projectId' = split_part(collection_path, '/', 2)
    and data ->> 'createdBy' = auth.uid()::text
    and lower(data ->> 'requesterEmail') = lower(auth.jwt() ->> 'email')
    and lower(data ->> 'status') = 'submitted'
  )
);

-- Attest the complete initial JSON payload. The delivery endpoint verifies the
-- current payload against this protected hash before it sends any message, so
-- a later browser-side edit cannot be presented as the creator's submission.
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
begin
  if new.collection_path !~ '^projects/[^/]+/advanceRequests$'
    or lower(coalesce(new.data ->> 'status', '')) <> 'submitted'
  then
    return new;
  end if;

  project_id := split_part(new.collection_path, '/', 2);
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

create or replace function public.app_verify_advance_request_submission_attestation(
  p_project_id text,
  p_advance_id text
)
returns boolean
language sql
stable
security definer
set search_path = public, private, extensions
as $$
  select exists (
    select 1
    from public.app_documents advance
    join public.app_documents attestation
      on attestation.collection_path = 'notification_events'
     and attestation.doc_id = 'advance-request-attestation-' || md5(p_project_id || ':' || p_advance_id)
    where advance.collection_path = 'projects/' || p_project_id || '/advanceRequests'
      and advance.doc_id = p_advance_id
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
  );
$$;

revoke all privileges on function public.app_verify_advance_request_submission_attestation(text, text) from public;
revoke all privileges on function public.app_verify_advance_request_submission_attestation(text, text) from anon;
revoke all privileges on function public.app_verify_advance_request_submission_attestation(text, text) from authenticated;
grant execute on function public.app_verify_advance_request_submission_attestation(text, text) to service_role;

commit;
