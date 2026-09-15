begin;

-- A requester can continue managing the documentary file of their own advance
-- even if their direct project assignment changed after the request was created.
-- This closes the gap between the administrative UI authorization and the
-- project-document RLS policy without exposing documents from other advances.
create or replace function public.app_can_access_owned_advance_document(
  document_collection_path text,
  document_id text,
  document_data jsonb
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with document_context as (
    select
      split_part(document_collection_path, '/', 2) as project_id,
      nullif(document_data ->> 'administrativeRequestId', '') as advance_id,
      public.app_current_identity_values() as identities
  )
  select coalesce(
    exists (
      select 1
      from document_context as context
      where auth.uid() is not null
        and document_collection_path = format('projects/%s/documents', context.project_id)
        and document_data ->> 'projectId' = context.project_id
        and (
          document_id in ('managed-administrativo', 'managed-administrativo-anticipos')
          or (
            context.advance_id is not null
            and (
              document_id like 'managed-advance-%'
              or document_data ->> 'documentContext' in (
                'advanceRepository',
                'advanceReceipt',
                'advancePayment',
                'advanceReconciliation',
                'advanceReturn',
                'advanceCompensation'
              )
            )
          )
        )
        and exists (
          select 1
          from public.app_documents as advance
          where advance.collection_path = format('projects/%s/advanceRequests', context.project_id)
            and (
              context.advance_id is null
              or advance.doc_id = context.advance_id
            )
            and (
              advance.data ->> 'requesterId' = any(context.identities)
              or advance.data ->> 'createdBy' = any(context.identities)
              or lower(advance.data ->> 'requesterEmail') = any(context.identities)
            )
        )
    ),
    false
  );
$$;

revoke all privileges
on function public.app_can_access_owned_advance_document(text, text, jsonb)
from public, anon;

grant execute
on function public.app_can_access_owned_advance_document(text, text, jsonb)
to authenticated, service_role;

drop policy if exists "advance owners can read their administrative documents" on public.app_documents;
create policy "advance owners can read their administrative documents"
on public.app_documents
for select
to authenticated
using (
  (select public.is_pixel_project_member())
  and public.app_can_access_owned_advance_document(collection_path, doc_id, data)
);

drop policy if exists "advance owners can create their administrative documents" on public.app_documents;
create policy "advance owners can create their administrative documents"
on public.app_documents
for insert
to authenticated
with check (
  (select public.is_pixel_project_member())
  and public.app_can_access_owned_advance_document(collection_path, doc_id, data)
);

drop policy if exists "advance owners can update their administrative documents" on public.app_documents;
create policy "advance owners can update their administrative documents"
on public.app_documents
for update
to authenticated
using (
  (select public.is_pixel_project_member())
  and public.app_can_access_owned_advance_document(collection_path, doc_id, data)
)
with check (
  (select public.is_pixel_project_member())
  and public.app_can_access_owned_advance_document(collection_path, doc_id, data)
);

comment on function public.app_can_access_owned_advance_document(text, text, jsonb) is
  'Allows an authenticated requester to index and read only the managed documents that belong to their own advance.';

commit;
