begin;

revoke all privileges on function public.app_projects_share_organization(text, text)
from anon, authenticated, public;

grant execute on function public.app_projects_share_organization(text, text)
to service_role;

commit;
