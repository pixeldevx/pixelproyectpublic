do $$
declare
  -- Optional before running this migration:
  -- set app.bootstrap_admin_email = 'admin@example.com';
  -- set app.bootstrap_admin_name = 'Administrador Global';
  admin_email text := lower(nullif(current_setting('app.bootstrap_admin_email', true), ''));
  admin_name text := coalesce(nullif(current_setting('app.bootstrap_admin_name', true), ''), 'Administrador Global');
begin
  if admin_email is null or admin_email = 'admin@example.com' then
    raise notice 'Bootstrap skipped: configure app.bootstrap_admin_email with a real administrator.';
    return;
  end if;

  insert into public.app_documents (collection_path, doc_id, data)
  values (
    'team_members',
    'bootstrap-global-admin-member',
    jsonb_build_object(
      'email', lower(admin_email),
      'name', admin_name,
      'roleId', 'global_admin',
      'roleName', 'Administrador Global',
      'systemRole', 'admin',
      'isBootstrapAdmin', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  )
  on conflict (collection_path, doc_id) do update
    set data = excluded.data,
        updated_at = now();

  insert into public.app_documents (collection_path, doc_id, data)
  values (
    'users',
    'bootstrap-global-admin-user',
    jsonb_build_object(
      'email', lower(admin_email),
      'displayName', admin_name,
      'role', 'admin',
      'isPreRegistered', true,
      'isBootstrapAdmin', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  )
  on conflict (collection_path, doc_id) do update
    set data = excluded.data,
        updated_at = now();
end $$;
