begin;

create extension if not exists pgcrypto;

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  license_key varchar(64) unique not null,
  client_name varchar(255) not null,
  plan_name varchar(100) default 'Estándar',
  max_uses integer not null default 100 check (max_uses >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  active boolean not null default true,
  expiration_date date,
  created_at timestamptz default current_timestamp,
  updated_at timestamptz default current_timestamp
);

create table if not exists public.license_usage_logs (
  id uuid primary key default gen_random_uuid(),
  license_key varchar(64) references public.licenses(license_key) on update cascade on delete cascade,
  machine_id varchar(64) not null,
  action varchar(100) not null,
  items_processed integer default 1 check (items_processed >= 0),
  os_info varchar(100),
  client_ip varchar(45),
  timestamp timestamptz default current_timestamp
);

create index if not exists licenses_license_key_idx
on public.licenses (license_key);

create index if not exists license_usage_logs_license_key_timestamp_idx
on public.license_usage_logs (license_key, timestamp desc);

create index if not exists license_usage_logs_machine_id_idx
on public.license_usage_logs (machine_id);

create or replace function public.set_licenses_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = current_timestamp;
  return new;
end;
$$;

drop trigger if exists set_licenses_updated_at on public.licenses;
create trigger set_licenses_updated_at
before update on public.licenses
for each row
execute function public.set_licenses_updated_at();

create or replace function public.consume_license_use(
  p_license_key varchar(64),
  p_machine_id varchar(64),
  p_action varchar(100),
  p_items_processed integer default 1,
  p_os_info varchar(100) default null,
  p_client_ip varchar(45) default null
)
returns table (
  license_key varchar(64),
  client_name varchar(255),
  plan_name varchar(100),
  max_uses integer,
  used_count integer,
  remaining_uses integer,
  expiration_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_license public.licenses%rowtype;
begin
  select *
    into v_license
    from public.licenses
   where licenses.license_key = upper(trim(p_license_key))
   for update;

  if not found then
    raise exception 'LICENSE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not v_license.active then
    raise exception 'LICENSE_INACTIVE' using errcode = 'P0001';
  end if;

  if v_license.expiration_date is not null and v_license.expiration_date < current_date then
    raise exception 'LICENSE_EXPIRED' using errcode = 'P0001';
  end if;

  if v_license.used_count >= v_license.max_uses then
    raise exception 'LICENSE_EXHAUSTED' using errcode = 'P0001';
  end if;

  update public.licenses
     set used_count = used_count + 1
   where id = v_license.id
   returning * into v_license;

  insert into public.license_usage_logs (
    license_key,
    machine_id,
    action,
    items_processed,
    os_info,
    client_ip,
    timestamp
  )
  values (
    v_license.license_key,
    left(trim(p_machine_id), 64),
    left(trim(p_action), 100),
    greatest(coalesce(p_items_processed, 1), 0),
    nullif(left(trim(coalesce(p_os_info, '')), 100), ''),
    nullif(left(trim(coalesce(p_client_ip, '')), 45), ''),
    current_timestamp
  );

  return query
  select
    v_license.license_key,
    v_license.client_name,
    v_license.plan_name,
    v_license.max_uses,
    v_license.used_count,
    greatest(v_license.max_uses - v_license.used_count, 0),
    v_license.expiration_date;
end;
$$;

alter table public.licenses enable row level security;
alter table public.license_usage_logs enable row level security;

revoke all privileges on table public.licenses from anon, authenticated, public;
revoke all privileges on table public.license_usage_logs from anon, authenticated, public;
revoke all privileges on function public.set_licenses_updated_at() from anon, authenticated, public;
revoke all privileges on function public.consume_license_use(varchar, varchar, varchar, integer, varchar, varchar) from anon, authenticated, public;

grant all privileges on table public.licenses to service_role;
grant all privileges on table public.license_usage_logs to service_role;
grant execute on function public.set_licenses_updated_at() to service_role;
grant execute on function public.consume_license_use(varchar, varchar, varchar, integer, varchar, varchar) to service_role;

commit;
