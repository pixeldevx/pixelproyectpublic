begin;

-- The browser document adapter intentionally uses INSERT ... ON CONFLICT DO
-- UPDATE for both setDoc and updateDoc. An INSERT RLS policy that only accepts
-- the initial `submitted` payload is therefore also evaluated during every
-- legitimate update. Validate only genuinely new advance rows in a trigger,
-- while existing rows continue through the normal UPDATE RLS policies and the
-- immutable-identity trigger.
drop policy if exists "advance requests bind creator on insert" on public.app_documents;

create or replace function private.validate_new_advance_request_submission()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated'
    or new.collection_path !~ '^projects/[^/]+/advanceRequests$'
  then
    return new;
  end if;

  -- BEFORE INSERT triggers also run for INSERT ... ON CONFLICT DO UPDATE.
  -- Let an existing document reach the UPDATE branch, where UPDATE RLS and
  -- protect_advance_request_identity() remain authoritative.
  if exists (
    select 1
    from public.app_documents existing
    where existing.collection_path = new.collection_path
      and existing.doc_id = new.doc_id
  ) then
    return new;
  end if;

  if new.data ->> 'projectId' is distinct from split_part(new.collection_path, '/', 2)
    or new.data ->> 'createdBy' is distinct from auth.uid()::text
    or lower(coalesce(new.data ->> 'requesterEmail', ''))
      is distinct from lower(coalesce(auth.jwt() ->> 'email', ''))
    or lower(coalesce(new.data ->> 'status', '')) <> 'submitted'
  then
    raise exception 'Advance request creator does not match the authenticated user.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all privileges on function private.validate_new_advance_request_submission() from public;
revoke all privileges on function private.validate_new_advance_request_submission() from anon;
revoke all privileges on function private.validate_new_advance_request_submission() from authenticated;

drop trigger if exists app_documents_validate_new_advance_request_submission on public.app_documents;
create trigger app_documents_validate_new_advance_request_submission
before insert on public.app_documents
for each row
execute function private.validate_new_advance_request_submission();

commit;
