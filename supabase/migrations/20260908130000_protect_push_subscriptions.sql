-- Push endpoints and encryption keys are credentials owned by authenticated
-- server routes. Browser clients must not be able to enumerate, replace,
-- deactivate, or delete another user's subscription.

drop policy if exists "push subscriptions server read" on public.app_documents;
create policy "push subscriptions server read"
on public.app_documents
as restrictive
for select
to authenticated
using (collection_path <> 'push_subscriptions');

drop policy if exists "push subscriptions server insert" on public.app_documents;
create policy "push subscriptions server insert"
on public.app_documents
as restrictive
for insert
to authenticated
with check (collection_path <> 'push_subscriptions');

drop policy if exists "push subscriptions server update" on public.app_documents;
create policy "push subscriptions server update"
on public.app_documents
as restrictive
for update
to authenticated
using (collection_path <> 'push_subscriptions')
with check (collection_path <> 'push_subscriptions');

drop policy if exists "push subscriptions server delete" on public.app_documents;
create policy "push subscriptions server delete"
on public.app_documents
as restrictive
for delete
to authenticated
using (collection_path <> 'push_subscriptions');

create index if not exists app_documents_push_subscription_owner_idx
  on public.app_documents (((data ->> 'userId')), updated_at desc)
  where collection_path = 'push_subscriptions';
