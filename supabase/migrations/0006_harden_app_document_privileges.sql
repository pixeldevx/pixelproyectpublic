alter function public.set_app_documents_updated_at()
set search_path = public;

revoke all privileges on function public.is_pixel_project_member() from anon;
revoke all privileges on function public.is_pixel_project_member() from public;
grant execute on function public.is_pixel_project_member() to authenticated;
grant execute on function public.is_pixel_project_member() to service_role;

revoke all privileges on function public.set_app_documents_updated_at() from anon;
revoke all privileges on function public.set_app_documents_updated_at() from public;
grant execute on function public.set_app_documents_updated_at() to authenticated;
grant execute on function public.set_app_documents_updated_at() to service_role;

revoke all privileges on table public.app_documents from anon;
revoke all privileges on table public.app_documents from public;
grant select, insert, update, delete on table public.app_documents to authenticated;
grant all privileges on table public.app_documents to service_role;

revoke all privileges on table
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
from anon;

revoke all privileges on table
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
from public;

grant select on table
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

grant select on table
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
to service_role;
