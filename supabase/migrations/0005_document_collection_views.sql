create or replace view public.app_collection_overview
with (security_invoker = true) as
select
  collection_path,
  count(*)::integer as document_count,
  min(created_at) as first_created_at,
  max(updated_at) as last_updated_at
from public.app_documents
group by collection_path;

create or replace view public.app_organizations
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'ownerId' as owner_id,
  data ->> 'createdAt' as document_created_at,
  data ->> 'updatedAt' as document_updated_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'organizations';

create or replace view public.app_projects
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'description' as description,
  data ->> 'status' as status,
  data ->> 'ownerId' as owner_id,
  data ->> 'organizationId' as organization_id,
  data -> 'assignedUsers' as assigned_users,
  data -> 'assignedTeamMembers' as assigned_team_members,
  data -> 'assignedEmails' as assigned_emails,
  data ->> 'createdAt' as document_created_at,
  data ->> 'updatedAt' as document_updated_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'projects';

create or replace view public.app_users
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'authUserId' as auth_user_id,
  data ->> 'email' as email,
  data ->> 'displayName' as display_name,
  data ->> 'role' as system_role,
  data ->> 'organizationId' as organization_id,
  data ->> 'inviteStatus' as invite_status,
  data ->> 'invitedAt' as invited_at,
  data ->> 'lastLoginAt' as last_login_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'users';

create or replace view public.app_team_members
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'authUserId' as auth_user_id,
  data ->> 'email' as email,
  data ->> 'name' as name,
  data ->> 'roleId' as role_id,
  data ->> 'roleName' as role_name,
  data ->> 'organizationId' as organization_id,
  data ->> 'inviteStatus' as invite_status,
  data ->> 'invitedAt' as invited_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'team_members';

create or replace view public.app_roles
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'description' as description,
  data ->> 'organizationId' as organization_id,
  coalesce((data ->> 'isDefault')::boolean, false) as is_default,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'roles';

create or replace view public.app_alert_rules
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'type' as type,
  data ->> 'projectId' as project_id,
  data ->> 'userId' as user_id,
  data ->> 'createdAt' as document_created_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'alert_rules';

create or replace view public.app_alerts
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'title' as title,
  data ->> 'message' as message,
  data ->> 'type' as type,
  data ->> 'status' as status,
  data ->> 'projectId' as project_id,
  data ->> 'userId' as user_id,
  data ->> 'createdAt' as document_created_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'alerts';

create or replace view public.app_workflow_templates
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'description' as description,
  data -> 'steps' as steps,
  data ->> 'createdBy' as created_by,
  data ->> 'createdAt' as document_created_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'workflow_templates';

create or replace view public.app_project_documents
with (security_invoker = true) as
select
  split_part(collection_path, '/', 2) as project_id,
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'fileName' as file_name,
  data ->> 'fileType' as file_type,
  data ->> 'url' as url,
  data ->> 'taskId' as task_id,
  data ->> 'uploadedBy' as uploaded_by,
  data ->> 'createdAt' as document_created_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path ~ '^projects/[^/]+/documents$';

create or replace view public.app_project_tasks
with (security_invoker = true) as
select
  split_part(collection_path, '/', 2) as project_id,
  doc_id as id,
  data ->> 'title' as title,
  data ->> 'description' as description,
  data ->> 'status' as status,
  data ->> 'assignedTo' as assigned_to,
  data ->> 'parentTaskId' as parent_task_id,
  data ->> 'rateCardId' as rate_card_id,
  data ->> 'indicator' as indicator,
  data ->> 'indicatorValue' as indicator_value,
  data ->> 'progress' as progress,
  data ->> 'displayOrder' as display_order,
  data ->> 'dueDate' as due_date,
  data ->> 'createdBy' as created_by,
  data ->> 'createdAt' as document_created_at,
  data ->> 'updatedAt' as document_updated_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path ~ '^projects/[^/]+/tasks$';

create or replace view public.app_project_rate_cards
with (security_invoker = true) as
select
  split_part(collection_path, '/', 2) as project_id,
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'indicator' as indicator,
  data ->> 'rate' as rate,
  data ->> 'currency' as currency,
  data ->> 'budgetLineId' as budget_line_id,
  data ->> 'currentValue' as current_value,
  data ->> 'reworkValue' as rework_value,
  data ->> 'syncExternal' as sync_external,
  data ->> 'createdBy' as created_by,
  data ->> 'createdAt' as document_created_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path ~ '^projects/[^/]+/rateCards$';

create or replace view public.app_project_budget_lines
with (security_invoker = true) as
select
  split_part(collection_path, '/', 2) as project_id,
  doc_id as id,
  data ->> 'name' as name,
  data ->> 'plannedAmount' as planned_amount,
  data ->> 'currency' as currency,
  data ->> 'createdAt' as document_created_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path ~ '^projects/[^/]+/budgetLines$';

create or replace view public.app_project_invoices
with (security_invoker = true) as
select
  split_part(collection_path, '/', 2) as project_id,
  doc_id as id,
  data ->> 'invoiceNumber' as invoice_number,
  data ->> 'description' as description,
  data ->> 'amount' as amount,
  data ->> 'date' as invoice_date,
  data ->> 'status' as status,
  data ->> 'createdBy' as created_by,
  data ->> 'createdAt' as document_created_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path ~ '^projects/[^/]+/invoices$';

create or replace view public.app_project_activities
with (security_invoker = true) as
select
  split_part(collection_path, '/', 2) as project_id,
  doc_id as id,
  data ->> 'title' as title,
  data ->> 'description' as description,
  data ->> 'assignedTo' as assigned_to,
  data ->> 'status' as status,
  data ->> 'createdBy' as created_by,
  data ->> 'createdAt' as document_created_at,
  data ->> 'updatedAt' as document_updated_at,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path ~ '^projects/[^/]+/activities$';

create or replace view public.app_project_org_charts
with (security_invoker = true) as
select
  split_part(collection_path, '/', 2) as project_id,
  doc_id as id,
  data -> 'nodes' as nodes,
  data -> 'edges' as edges,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path ~ '^projects/[^/]+/orgChart$';

create or replace view public.app_config_documents
with (security_invoker = true) as
select
  doc_id as id,
  data ->> 'version' as version,
  data -> 'modules' as modules,
  data ->> 'storageBucket' as storage_bucket,
  data as raw_data,
  created_at,
  updated_at
from public.app_documents
where collection_path = 'app_config';

grant select on
  public.app_collection_overview,
  public.app_organizations,
  public.app_projects,
  public.app_users,
  public.app_team_members,
  public.app_roles,
  public.app_alert_rules,
  public.app_alerts,
  public.app_workflow_templates,
  public.app_project_documents,
  public.app_project_tasks,
  public.app_project_rate_cards,
  public.app_project_budget_lines,
  public.app_project_invoices,
  public.app_project_activities,
  public.app_project_org_charts,
  public.app_config_documents
to authenticated;
