create table if not exists public.project_spatial_annotations (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  annotation_type text not null
    check (annotation_type in ('polygon', 'label')),
  title text not null default '',
  body text not null default '',
  geometry jsonb not null,
  style_config jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  rotation numeric not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_spatial_annotations_project_idx
  on public.project_spatial_annotations (project_id);

create or replace function public.set_project_spatial_annotations_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_spatial_annotations_set_updated_at on public.project_spatial_annotations;
create trigger project_spatial_annotations_set_updated_at
before update on public.project_spatial_annotations
for each row
execute function public.set_project_spatial_annotations_updated_at();

alter table public.project_spatial_annotations enable row level security;

drop policy if exists "members can read project spatial annotations" on public.project_spatial_annotations;
create policy "members can read project spatial annotations"
on public.project_spatial_annotations
for select
to authenticated
using (public.is_pixel_project_member());

drop policy if exists "members can create project spatial annotations" on public.project_spatial_annotations;
create policy "members can create project spatial annotations"
on public.project_spatial_annotations
for insert
to authenticated
with check (public.is_pixel_project_member());

drop policy if exists "members can update project spatial annotations" on public.project_spatial_annotations;
create policy "members can update project spatial annotations"
on public.project_spatial_annotations
for update
to authenticated
using (public.is_pixel_project_member())
with check (public.is_pixel_project_member());

drop policy if exists "members can delete project spatial annotations" on public.project_spatial_annotations;
create policy "members can delete project spatial annotations"
on public.project_spatial_annotations
for delete
to authenticated
using (public.is_pixel_project_member());

grant select, insert, update, delete on public.project_spatial_annotations to authenticated;
grant execute on function public.set_project_spatial_annotations_updated_at() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_spatial_annotations'
  ) then
    alter publication supabase_realtime add table public.project_spatial_annotations;
  end if;
end;
$$;
