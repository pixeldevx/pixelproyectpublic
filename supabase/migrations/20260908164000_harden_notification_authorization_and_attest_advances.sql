begin;

-- A browser may create an advance only for its authenticated identity. This
-- blocks a forged creator from being picked up later by the reconciler.
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

create or replace function private.protect_advance_request_identity()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated'
    or old.collection_path !~ '^projects/[^/]+/advanceRequests$'
  then
    return new;
  end if;

  if old.data -> 'projectId' is distinct from new.data -> 'projectId'
    or old.data -> 'createdBy' is distinct from new.data -> 'createdBy'
    or old.data -> 'requesterId' is distinct from new.data -> 'requesterId'
    or lower(coalesce(old.data ->> 'requesterEmail', '')) is distinct from lower(coalesce(new.data ->> 'requesterEmail', ''))
    or old.data -> 'createdAt' is distinct from new.data -> 'createdAt'
  then
    raise exception 'Advance request identity fields are immutable.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.protect_advance_request_identity() from public;
revoke all privileges on function private.protect_advance_request_identity() from anon;
revoke all privileges on function private.protect_advance_request_identity() from authenticated;

drop trigger if exists app_documents_protect_advance_request_identity on public.app_documents;
create trigger app_documents_protect_advance_request_identity
before update on public.app_documents
for each row
execute function private.protect_advance_request_identity();

create or replace function private.attest_advance_request_submission()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  project_id text;
  attestation_id text;
begin
  if new.collection_path !~ '^projects/[^/]+/advanceRequests$'
    or lower(coalesce(new.data ->> 'status', '')) <> 'submitted'
  then
    return new;
  end if;

  project_id := split_part(new.collection_path, '/', 2);
  attestation_id := 'advance-request-attestation-' || md5(project_id || ':' || new.doc_id);

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

drop trigger if exists app_documents_attest_advance_request_submission on public.app_documents;
create trigger app_documents_attest_advance_request_submission
after insert on public.app_documents
for each row
execute function private.attest_advance_request_submission();

create index if not exists app_documents_advance_submission_attestation_idx
  on public.app_documents (((data ->> 'projectId')), ((data ->> 'advanceId')))
  where collection_path = 'notification_events'
    and data ->> 'eventType' = 'advance_request_submission_attested';

commit;
