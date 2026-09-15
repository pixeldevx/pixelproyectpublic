create or replace function public.is_pixel_project_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.app_documents
      where collection_path = 'team_members'
        and lower(data ->> 'email') = lower(auth.jwt() ->> 'email')
    )
    or exists (
      select 1
      from public.app_documents
      where collection_path = 'users'
        and lower(data ->> 'email') = lower(auth.jwt() ->> 'email')
    ),
    false
  );
$$;
