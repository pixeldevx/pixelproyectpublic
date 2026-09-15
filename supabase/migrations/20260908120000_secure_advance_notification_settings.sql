-- Advance-notification configuration and delivery reservations are owned by
-- authenticated server routes. Restrictive policies prevent a browser from
-- changing recipients, forging audit metadata, or reserving an event to
-- suppress a legitimate notification.

drop policy if exists "advance notification private documents server read" on public.app_documents;
create policy "advance notification private documents server read"
on public.app_documents
as restrictive
for select
to authenticated
using (
  collection_path <> 'notification_events'
  and collection_path !~ '^projects/[^/]+/administrativeNotificationSettings$'
);

drop policy if exists "advance notification private documents server insert" on public.app_documents;
create policy "advance notification private documents server insert"
on public.app_documents
as restrictive
for insert
to authenticated
with check (
  collection_path <> 'notification_events'
  and collection_path !~ '^projects/[^/]+/administrativeNotificationSettings$'
);

drop policy if exists "advance notification private documents server update" on public.app_documents;
create policy "advance notification private documents server update"
on public.app_documents
as restrictive
for update
to authenticated
using (
  collection_path <> 'notification_events'
  and collection_path !~ '^projects/[^/]+/administrativeNotificationSettings$'
)
with check (
  collection_path <> 'notification_events'
  and collection_path !~ '^projects/[^/]+/administrativeNotificationSettings$'
);

drop policy if exists "advance notification private documents server delete" on public.app_documents;
create policy "advance notification private documents server delete"
on public.app_documents
as restrictive
for delete
to authenticated
using (
  collection_path <> 'notification_events'
  and collection_path !~ '^projects/[^/]+/administrativeNotificationSettings$'
);

create index if not exists app_documents_advance_notification_settings_idx
  on public.app_documents (collection_path, doc_id)
  where collection_path ~ '^projects/[^/]+/administrativeNotificationSettings$';

create index if not exists app_documents_advance_notification_event_idx
  on public.app_documents (((data ->> 'projectId')), ((data ->> 'advanceId')), updated_at desc)
  where collection_path = 'notification_events'
    and data ->> 'eventType' = 'advance_request_submitted';
