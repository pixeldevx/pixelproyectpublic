create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.project_spatial_layers (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  name text not null,
  file_name text,
  source_type text not null default 'geojson'
    check (source_type in ('geojson', 'shapefile')),
  storage_path text not null unique,
  download_url text,
  bounds jsonb,
  feature_count integer not null default 0 check (feature_count >= 0),
  attributes jsonb not null default '[]'::jsonb,
  visible boolean not null default true,
  join_config jsonb not null default '{"layerAttribute": "", "taskAttribute": "externalWorkflowId"}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_spatial_features (
  id uuid primary key default gen_random_uuid(),
  layer_id uuid not null references public.project_spatial_layers(id) on delete cascade,
  project_id text not null,
  feature_index integer not null default 0 check (feature_index >= 0),
  join_key text,
  properties jsonb not null default '{}'::jsonb,
  geom extensions.geometry(Geometry, 4326),
  created_at timestamptz not null default now()
);

create index if not exists project_spatial_layers_project_idx
  on public.project_spatial_layers (project_id);

create index if not exists project_spatial_features_project_idx
  on public.project_spatial_features (project_id);

create index if not exists project_spatial_features_layer_idx
  on public.project_spatial_features (layer_id);

create index if not exists project_spatial_features_join_key_idx
  on public.project_spatial_features (project_id, join_key);

create index if not exists project_spatial_features_geom_idx
  on public.project_spatial_features using gist (geom);

create or replace function public.set_project_spatial_layers_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists project_spatial_layers_set_updated_at on public.project_spatial_layers;
create trigger project_spatial_layers_set_updated_at
before update on public.project_spatial_layers
for each row
execute function public.set_project_spatial_layers_updated_at();

alter table public.project_spatial_layers enable row level security;
alter table public.project_spatial_features enable row level security;

drop policy if exists "members can read project spatial layers" on public.project_spatial_layers;
create policy "members can read project spatial layers"
on public.project_spatial_layers
for select
to authenticated
using (public.is_pixel_project_member());

drop policy if exists "members can create project spatial layers" on public.project_spatial_layers;
create policy "members can create project spatial layers"
on public.project_spatial_layers
for insert
to authenticated
with check (public.is_pixel_project_member());

drop policy if exists "members can update project spatial layers" on public.project_spatial_layers;
create policy "members can update project spatial layers"
on public.project_spatial_layers
for update
to authenticated
using (public.is_pixel_project_member())
with check (public.is_pixel_project_member());

drop policy if exists "members can delete project spatial layers" on public.project_spatial_layers;
create policy "members can delete project spatial layers"
on public.project_spatial_layers
for delete
to authenticated
using (public.is_pixel_project_member());

drop policy if exists "members can read project spatial features" on public.project_spatial_features;
create policy "members can read project spatial features"
on public.project_spatial_features
for select
to authenticated
using (public.is_pixel_project_member());

drop policy if exists "members can create project spatial features" on public.project_spatial_features;
create policy "members can create project spatial features"
on public.project_spatial_features
for insert
to authenticated
with check (public.is_pixel_project_member());

drop policy if exists "members can update project spatial features" on public.project_spatial_features;
create policy "members can update project spatial features"
on public.project_spatial_features
for update
to authenticated
using (public.is_pixel_project_member())
with check (public.is_pixel_project_member());

drop policy if exists "members can delete project spatial features" on public.project_spatial_features;
create policy "members can delete project spatial features"
on public.project_spatial_features
for delete
to authenticated
using (public.is_pixel_project_member());

grant usage on schema public to authenticated;
grant usage on schema extensions to authenticated;
grant select, insert, update, delete on public.project_spatial_layers to authenticated;
grant select, insert, update, delete on public.project_spatial_features to authenticated;
grant execute on function public.set_project_spatial_layers_updated_at() to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_spatial_layers'
  ) then
    alter publication supabase_realtime add table public.project_spatial_layers;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'project_spatial_features'
  ) then
    alter publication supabase_realtime add table public.project_spatial_features;
  end if;
end;
$$;
