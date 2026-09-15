create table if not exists public.app_documents (
  collection_path text not null,
  doc_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection_path, doc_id)
);

create index if not exists app_documents_collection_path_idx
  on public.app_documents (collection_path);

create index if not exists app_documents_data_gin_idx
  on public.app_documents using gin (data);

create or replace function public.set_app_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_documents_set_updated_at on public.app_documents;
create trigger app_documents_set_updated_at
before update on public.app_documents
for each row
execute function public.set_app_documents_updated_at();

alter table public.app_documents enable row level security;

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

drop policy if exists "authenticated users can read app documents" on public.app_documents;
create policy "authenticated users can read app documents"
on public.app_documents
for select
to authenticated
using (public.is_pixel_project_member());

drop policy if exists "authenticated users can create app documents" on public.app_documents;
create policy "authenticated users can create app documents"
on public.app_documents
for insert
to authenticated
with check (public.is_pixel_project_member());

drop policy if exists "authenticated users can update app documents" on public.app_documents;
create policy "authenticated users can update app documents"
on public.app_documents
for update
to authenticated
using (public.is_pixel_project_member())
with check (public.is_pixel_project_member());

drop policy if exists "authenticated users can delete app documents" on public.app_documents;
create policy "authenticated users can delete app documents"
on public.app_documents
for delete
to authenticated
using (public.is_pixel_project_member());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_documents'
  ) then
    alter publication supabase_realtime add table public.app_documents;
  end if;
end;
$$;

insert into storage.buckets (id, name, public)
values ('pixel-project-files', 'pixel-project-files', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "authenticated users can read pixel project files" on storage.objects;
create policy "authenticated users can read pixel project files"
on storage.objects
for select
to authenticated
using (bucket_id = 'pixel-project-files' and public.is_pixel_project_member());

drop policy if exists "authenticated users can upload pixel project files" on storage.objects;
create policy "authenticated users can upload pixel project files"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'pixel-project-files' and public.is_pixel_project_member());

drop policy if exists "authenticated users can update pixel project files" on storage.objects;
create policy "authenticated users can update pixel project files"
on storage.objects
for update
to authenticated
using (bucket_id = 'pixel-project-files' and public.is_pixel_project_member())
with check (bucket_id = 'pixel-project-files' and public.is_pixel_project_member());

drop policy if exists "authenticated users can delete pixel project files" on storage.objects;
create policy "authenticated users can delete pixel project files"
on storage.objects
for delete
to authenticated
using (bucket_id = 'pixel-project-files' and public.is_pixel_project_member());
