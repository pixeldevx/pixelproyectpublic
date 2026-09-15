insert into public.app_documents (collection_path, doc_id, data)
values
  (
    'roles',
    'default-project-manager',
    jsonb_build_object(
      'name', 'Gerente de Proyecto',
      'description', 'Responsable de la planeación, seguimiento y control general del proyecto.',
      'isDefault', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  ),
  (
    'roles',
    'default-coordinator',
    jsonb_build_object(
      'name', 'Coordinador',
      'description', 'Coordina tareas, equipo operativo y avance diario del proyecto.',
      'isDefault', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  ),
  (
    'roles',
    'default-administrative',
    jsonb_build_object(
      'name', 'Administrativo',
      'description', 'Gestiona documentación, facturación, soportes y seguimiento administrativo.',
      'isDefault', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  ),
  (
    'roles',
    'default-field-operator',
    jsonb_build_object(
      'name', 'Operador de Campo',
      'description', 'Ejecuta actividades operativas y reporta avances desde el proyecto.',
      'isDefault', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  ),
  (
    'roles',
    'default-reviewer',
    jsonb_build_object(
      'name', 'Revisor',
      'description', 'Valida entregables, documentos y pasos de aprobación.',
      'isDefault', true,
      'createdAt', now(),
      'updatedAt', now()
    )
  )
on conflict (collection_path, doc_id) do update
  set data = public.app_documents.data || excluded.data,
      updated_at = now();

insert into public.app_documents (collection_path, doc_id, data)
values (
  'app_config',
  'functional-schema',
  jsonb_build_object(
    'version', 1,
    'modules', jsonb_build_array(
      'organizations',
      'users',
      'team_members',
      'roles',
      'projects',
      'documents',
      'tasks',
      'rateCards',
      'budgetLines',
      'invoices',
      'activities',
      'alerts',
      'workflow_templates'
    ),
    'storageBucket', 'pixel-project-files',
    'updatedAt', now()
  )
)
on conflict (collection_path, doc_id) do update
  set data = public.app_documents.data || excluded.data,
      updated_at = now();
