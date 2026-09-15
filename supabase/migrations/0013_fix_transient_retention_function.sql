create or replace function public.purge_transient_app_documents(
  notification_retention_days integer default 30,
  alert_retention_days integer default 45,
  max_rows_per_collection integer default 5000
)
returns table(collection_group text, deleted_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if notification_retention_days < 7 or alert_retention_days < 7 then
    raise exception 'Retention must be at least 7 days.';
  end if;

  if max_rows_per_collection < 100 then
    raise exception 'max_rows_per_collection must be at least 100.';
  end if;

  return query
  with deleted as (
    delete from public.app_documents as documents
    where documents.ctid in (
      select candidate.ctid
      from public.app_documents as candidate
      where candidate.collection_group = 'notification_events'
        and candidate.updated_at < now() - make_interval(days => notification_retention_days)
      order by candidate.updated_at asc
      limit max_rows_per_collection
    )
    returning 1
  )
  select 'notification_events'::text, count(*)::integer
  from deleted;

  return query
  with deleted as (
    delete from public.app_documents as documents
    where documents.ctid in (
      select candidate.ctid
      from public.app_documents as candidate
      where candidate.collection_group = 'alerts'
        and candidate.updated_at < now() - make_interval(days => alert_retention_days)
        and (
          lower(coalesce(candidate.data ->> 'read', 'false')) = 'true'
          or lower(coalesce(candidate.data ->> 'dismissed', 'false')) = 'true'
          or lower(coalesce(candidate.data ->> 'resolved', 'false')) = 'true'
          or lower(coalesce(candidate.data ->> 'status', '')) in ('read', 'dismissed', 'resolved', 'closed', 'archived')
        )
      order by candidate.updated_at asc
      limit max_rows_per_collection
    )
    returning 1
  )
  select 'alerts'::text, count(*)::integer
  from deleted;
end;
$$;

revoke all privileges on function public.purge_transient_app_documents(integer, integer, integer) from public;
revoke all privileges on function public.purge_transient_app_documents(integer, integer, integer) from anon;
revoke all privileges on function public.purge_transient_app_documents(integer, integer, integer) from authenticated;
grant execute on function public.purge_transient_app_documents(integer, integer, integer) to service_role;
