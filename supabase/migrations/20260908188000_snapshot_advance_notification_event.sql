-- Fresh public installs skip the superseded full-payload snapshot function.
-- The following migration installs the minimized event implementation.
create index if not exists app_documents_advance_submission_attested_at_idx
  on public.app_documents (created_at desc, doc_id)
  where collection_path = 'notification_events'
    and data ->> 'eventType' = 'advance_request_submission_attested';

commit;
