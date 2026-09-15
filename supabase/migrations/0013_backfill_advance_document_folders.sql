begin;

create temporary table _advance_document_backfill on commit drop as
select
  documents.collection_path,
  split_part(documents.collection_path, '/', 2) as project_id,
  documents.doc_id as file_document_id,
  documents.data ->> 'administrativeRequestId' as advance_id,
  documents.data ->> 'storagePath' as storage_path,
  coalesce(nullif(documents.data ->> 'category', ''), 'Sin categoría') as category_name,
  coalesce(
    nullif(documents.data ->> 'documentType', ''),
    case
      when documents.data ->> 'storagePath' like '%/recibo-de-caja/%' then 'cash_receipt'
      else 'invoice'
    end
  ) as document_type,
  coalesce(
    category_match.doc_id,
    'legacy-' || substr(md5(lower(coalesce(nullif(documents.data ->> 'category', ''), 'sin-categoria'))), 1, 16)
  ) as category_id,
  coalesce(
    nullif(advance.data ->> 'customId', '') || ' - ' || coalesce(nullif(advance.data ->> 'destination', ''), nullif(advance.data ->> 'purpose', ''), 'Anticipo'),
    coalesce(nullif(advance.data ->> 'destination', ''), nullif(advance.data ->> 'purpose', ''), 'Anticipo') || ' - ' || substr(documents.data ->> 'administrativeRequestId', 1, 8)
  ) as advance_folder_name
from public.app_documents as documents
left join public.app_documents as advance
  on advance.collection_path = 'projects/' || split_part(documents.collection_path, '/', 2) || '/advanceRequests'
 and advance.doc_id = documents.data ->> 'administrativeRequestId'
left join lateral (
  select category.doc_id
  from public.app_documents as category
  where category.collection_path = 'projects/' || split_part(documents.collection_path, '/', 2) || '/expenseCategories'
    and lower(category.data ->> 'name') = lower(documents.data ->> 'category')
  limit 1
) as category_match on true
where documents.collection_path like 'projects/%/documents'
  and documents.data ->> 'documentContext' = 'advanceReceipt'
  and coalesce(documents.data ->> 'administrativeRequestId', '') <> '';

insert into public.app_documents (collection_path, doc_id, data)
select distinct
  collection_path,
  'managed-administrativo',
  jsonb_build_object(
    'projectId', project_id,
    'name', 'Administrativo',
    'type', 'folder',
    'itemKind', 'folder',
    'scope', 'project',
    'parentFolderId', null,
    'createdAt', now(),
    'uploadedAt', now(),
    'accessMode', 'all',
    'allowedMemberIds', '[]'::jsonb,
    'managedFolder', true,
    'documentContext', 'administration',
    'providerPathVersion', 'structured-v2'
  )
from _advance_document_backfill
on conflict (collection_path, doc_id) do nothing;

insert into public.app_documents (collection_path, doc_id, data)
select distinct
  collection_path,
  'managed-administrativo-anticipos',
  jsonb_build_object(
    'projectId', project_id,
    'name', 'Anticipos',
    'type', 'folder',
    'itemKind', 'folder',
    'scope', 'project',
    'parentFolderId', 'managed-administrativo',
    'createdAt', now(),
    'uploadedAt', now(),
    'accessMode', 'inherit',
    'allowedMemberIds', '[]'::jsonb,
    'managedFolder', true,
    'documentContext', 'advanceRepository',
    'providerPathVersion', 'structured-v2'
  )
from _advance_document_backfill
on conflict (collection_path, doc_id) do nothing;

insert into public.app_documents (collection_path, doc_id, data)
select distinct on (collection_path, advance_id)
  collection_path,
  'managed-advance-' || advance_id,
  jsonb_build_object(
    'projectId', project_id,
    'name', advance_folder_name,
    'type', 'folder',
    'itemKind', 'folder',
    'scope', 'project',
    'parentFolderId', 'managed-administrativo-anticipos',
    'createdAt', now(),
    'uploadedAt', now(),
    'accessMode', 'inherit',
    'allowedMemberIds', '[]'::jsonb,
    'managedFolder', true,
    'administrativeRequestId', advance_id,
    'documentContext', 'advanceRepository',
    'providerPathVersion', 'structured-v2'
  )
from _advance_document_backfill
order by collection_path, advance_id
on conflict (collection_path, doc_id) do nothing;

insert into public.app_documents (collection_path, doc_id, data)
select distinct
  collection_path,
  'managed-advance-' || advance_id || '-' || document_type,
  jsonb_build_object(
    'projectId', project_id,
    'name', case when document_type = 'cash_receipt' then 'Recibo de caja' else 'Factura electrónica' end,
    'type', 'folder',
    'itemKind', 'folder',
    'scope', 'project',
    'parentFolderId', 'managed-advance-' || advance_id,
    'createdAt', now(),
    'uploadedAt', now(),
    'accessMode', 'inherit',
    'allowedMemberIds', '[]'::jsonb,
    'managedFolder', true,
    'administrativeRequestId', advance_id,
    'documentType', document_type,
    'providerPathVersion', 'structured-v2'
  )
from _advance_document_backfill
on conflict (collection_path, doc_id) do nothing;

insert into public.app_documents (collection_path, doc_id, data)
select distinct
  collection_path,
  'managed-advance-' || advance_id || '-' || document_type || '-' || category_id,
  jsonb_build_object(
    'projectId', project_id,
    'name', category_name,
    'type', 'folder',
    'itemKind', 'folder',
    'scope', 'project',
    'parentFolderId', 'managed-advance-' || advance_id || '-' || document_type,
    'createdAt', now(),
    'uploadedAt', now(),
    'accessMode', 'inherit',
    'allowedMemberIds', '[]'::jsonb,
    'managedFolder', true,
    'administrativeRequestId', advance_id,
    'documentType', document_type,
    'categoryId', category_id,
    'providerPathVersion', 'structured-v2'
  )
from _advance_document_backfill
on conflict (collection_path, doc_id) do nothing;

update public.app_documents as documents
set data = documents.data || jsonb_build_object(
  'parentFolderId', 'managed-advance-' || backfill.advance_id || '-' || backfill.document_type || '-' || backfill.category_id,
  'accessMode', 'inherit',
  'allowedMemberIds', '[]'::jsonb,
  'accessPolicyVersion', 'folder-inheritance-v1',
  'providerPathVersion', 'structured-v2',
  'storageFolder', regexp_replace(backfill.storage_path, '/[^/]+$', '')
)
from _advance_document_backfill as backfill
where documents.collection_path = backfill.collection_path
  and documents.doc_id = backfill.file_document_id;

update public.app_documents as advance
set data = jsonb_set(
  advance.data,
  '{receipts}',
  coalesce((
    select jsonb_agg(
      case
        when backfill.file_document_id is not null
          then receipt.value || jsonb_build_object('documentId', backfill.file_document_id)
        else receipt.value
      end
      order by receipt.ordinality
    )
    from jsonb_array_elements(advance.data -> 'receipts') with ordinality as receipt(value, ordinality)
    left join _advance_document_backfill as backfill
      on backfill.project_id = split_part(advance.collection_path, '/', 2)
     and backfill.advance_id = advance.doc_id
     and backfill.storage_path = receipt.value ->> 'storagePath'
  ), '[]'::jsonb),
  true
)
where advance.collection_path like 'projects/%/advanceRequests'
  and jsonb_typeof(advance.data -> 'receipts') = 'array'
  and exists (
    select 1
    from _advance_document_backfill as backfill
    where backfill.project_id = split_part(advance.collection_path, '/', 2)
      and backfill.advance_id = advance.doc_id
  );

commit;
