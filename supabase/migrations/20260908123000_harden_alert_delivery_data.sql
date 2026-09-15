-- Durable delivery reservations for advance-request notifications are owned by
-- authenticated server routes. This policy is intentionally limited to the
-- new collection so it cannot change the behavior of existing alert flows.

drop policy if exists "advance notification deliveries server read" on public.app_documents;
create policy "advance notification deliveries server read"
on public.app_documents
as restrictive
for select
to authenticated
using (
  collection_path !~ '^projects/[^/]+/administrativeNotificationDeliveries$'
);

drop policy if exists "advance notification deliveries server insert" on public.app_documents;
create policy "advance notification deliveries server insert"
on public.app_documents
as restrictive
for insert
to authenticated
with check (
  collection_path !~ '^projects/[^/]+/administrativeNotificationDeliveries$'
);

drop policy if exists "advance notification deliveries server update" on public.app_documents;
create policy "advance notification deliveries server update"
on public.app_documents
as restrictive
for update
to authenticated
using (
  collection_path !~ '^projects/[^/]+/administrativeNotificationDeliveries$'
)
with check (
  collection_path !~ '^projects/[^/]+/administrativeNotificationDeliveries$'
);

drop policy if exists "advance notification deliveries server delete" on public.app_documents;
create policy "advance notification deliveries server delete"
on public.app_documents
as restrictive
for delete
to authenticated
using (
  collection_path !~ '^projects/[^/]+/administrativeNotificationDeliveries$'
);

create index if not exists app_documents_advance_notification_delivery_idx
  on public.app_documents (
    ((data ->> 'advanceId')),
    ((data ->> 'recipientUserId')),
    updated_at desc
  )
  where collection_path ~ '^projects/[^/]+/administrativeNotificationDeliveries$'
    and data ->> 'eventType' = 'advance_request_submitted';
