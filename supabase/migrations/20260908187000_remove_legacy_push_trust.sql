begin;

-- Legacy push rows predate server-side ownership attestation and cannot be
-- trusted retroactively. Remove the temporary marker; sensitive notification
-- types only use subscriptions re-registered through the protected API.
update public.app_documents
set data = data - 'serverProtectedLegacy' - 'serverProtectedAt',
    updated_at = now()
where collection_path = 'push_subscriptions'
  and (
    data ? 'serverProtectedLegacy'
    or data ? 'serverProtectedAt'
  );

commit;
