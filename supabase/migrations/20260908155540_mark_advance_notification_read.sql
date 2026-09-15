-- Mark one durable advance notification as read without replacing the whole
-- delivery document. Only authenticated server routes using service_role may
-- execute this RPC.

create or replace function public.mark_advance_notification_read(
  p_project_id text,
  p_delivery_id text,
  p_recipient_user_id text
)
returns table(marked boolean, result text, read_at text)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_path text;
  v_read_at text := to_char(
    clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_updated_count integer := 0;
  v_delivery jsonb;
  v_lease_is_active boolean := false;
begin
  if coalesce(p_project_id, '') !~ '^[A-Za-z0-9_-]{1,180}$'
    or coalesce(p_delivery_id, '') !~ '^[A-Za-z0-9_-]{1,180}$'
    or coalesce(p_recipient_user_id, '') !~ '^[A-Za-z0-9_-]{1,180}$'
  then
    return query select false, 'invalid_identifier'::text, null::text;
    return;
  end if;

  v_path := 'projects/' || p_project_id || '/administrativeNotificationDeliveries';

  return query
  with updated as (
    update public.app_documents as delivery
    set data = jsonb_set(
      jsonb_set(
        delivery.data,
        '{inAppAlert,status}',
        to_jsonb('read'::text),
        true
      ),
      '{inAppAlert,readAt}',
      to_jsonb(v_read_at),
      true
    )
    where delivery.collection_path = v_path
      and delivery.doc_id = p_delivery_id
      and delivery.data ->> 'eventType' = 'advance_request_submitted'
      and delivery.data ->> 'projectId' = p_project_id
      and delivery.data ->> 'recipientUserId' = p_recipient_user_id
      and delivery.data ->> 'inAppCompleted' = 'true'
      and jsonb_typeof(delivery.data -> 'inAppAlert') = 'object'
      and (
        delivery.data #>> '{inAppAlert,status}' is distinct from 'read'
        or nullif(delivery.data #>> '{inAppAlert,readAt}', '') is null
      )
      and not (
        coalesce(delivery.data ->> 'status', '') = 'processing'
        and case
          when coalesce(delivery.data ->> 'leaseUntil', '') ~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
          then (delivery.data ->> 'leaseUntil')::timestamptz > statement_timestamp()
          else false
        end
      )
    returning delivery.data #>> '{inAppAlert,readAt}' as stored_read_at
  )
  select true, 'updated'::text, updated.stored_read_at
  from updated;

  get diagnostics v_updated_count = row_count;
  if v_updated_count > 0 then
    return;
  end if;

  select delivery.data
  into v_delivery
  from public.app_documents as delivery
  where delivery.collection_path = v_path
    and delivery.doc_id = p_delivery_id
    and delivery.data ->> 'eventType' = 'advance_request_submitted'
    and delivery.data ->> 'projectId' = p_project_id
    and delivery.data ->> 'recipientUserId' = p_recipient_user_id
    and delivery.data ->> 'inAppCompleted' = 'true'
    and jsonb_typeof(delivery.data -> 'inAppAlert') = 'object'
  limit 1;

  if not found then
    return query select false, 'not_available'::text, null::text;
    return;
  end if;

  if v_delivery #>> '{inAppAlert,status}' = 'read' then
    return query select false, 'already_read'::text, v_delivery #>> '{inAppAlert,readAt}';
    return;
  end if;

  v_lease_is_active := coalesce(v_delivery ->> 'status', '') = 'processing'
    and case
      when coalesce(v_delivery ->> 'leaseUntil', '') ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
      then (v_delivery ->> 'leaseUntil')::timestamptz > statement_timestamp()
      else false
    end;

  return query select false,
    case when v_lease_is_active then 'delivery_processing' else 'not_available' end,
    null::text;
end;
$function$;

comment on function public.mark_advance_notification_read(text, text, text)
  is 'Atomically marks one completed in-app advance notification as read for its exact recipient without replacing delivery checkpoints.';

revoke all privileges on function public.mark_advance_notification_read(text, text, text) from public;
revoke all privileges on function public.mark_advance_notification_read(text, text, text) from anon;
revoke all privileges on function public.mark_advance_notification_read(text, text, text) from authenticated;
grant execute on function public.mark_advance_notification_read(text, text, text) to service_role;

create index if not exists app_documents_advance_notification_inbox_idx
  on public.app_documents ((data ->> 'recipientUserId'), updated_at desc)
  where collection_group = 'administrativeNotificationDeliveries'
    and data ->> 'eventType' = 'advance_request_submitted';
