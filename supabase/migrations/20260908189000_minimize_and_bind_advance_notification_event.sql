-- Public instance: the owner disabled advance-request notifications.
-- Do not duplicate financial/personal payloads into notification events.
create or replace function private.attest_advance_request_submission()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions
as $$
begin
  return new;
end;
$$;
