begin;

-- Authorization entries must be provisioned deliberately from a trusted
-- server/DB operation, never inferred from browser-editable profile roles.
delete from public.app_documents
where collection_path = 'notification_configuration_admins'
  and data ->> 'authorizationSource' = 'global_admin_snapshot';

commit;
