begin;

create schema if not exists private;

revoke all privileges on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.app_can_access_owned_advance_document(
  document_collection_path text,
  document_id text,
  document_data jsonb
)
returns boolean
language sql
stable
security definer
set search_path = ''
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
on function private.app_can_access_owned_advance_document(text, text, jsonb)
from public, anon;

grant execute
on function private.app_can_access_owned_advance_document(text, text, jsonb)
to authenticated, service_role;

alter policy "authenticated users can read app documents"
on public.app_documents
using (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or private.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
);

alter policy "authenticated users can create app documents"
on public.app_documents
with check (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or private.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
);

alter policy "authenticated users can update app documents"
on public.app_documents
using (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or private.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
)
with check (
  (select public.is_pixel_project_member())
  and (
    collection_path !~ '^projects/[^/]+/documents$'
    or public.app_can_access_project_document_with_context(
      collection_path,
      doc_id,
      data,
      (select public.app_current_document_access_context())
    )
    or private.app_can_access_owned_advance_document(collection_path, doc_id, data)
  )
);

drop function public.app_can_access_owned_advance_document(text, text, jsonb);

comment on function private.app_can_access_owned_advance_document(text, text, jsonb) is
  'Private RLS helper for managed documents that belong to the authenticated requester own advance.';

commit;
