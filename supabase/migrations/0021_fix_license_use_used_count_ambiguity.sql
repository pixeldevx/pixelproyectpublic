begin;

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

  update public.licenses as l
     set used_count = l.used_count + 1
   where l.id = v_license.id
   returning l.* into v_license;

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

create or replace function public.consume_license_use_v2(
  p_license_key varchar(64),
  p_machine_id varchar(64),
  p_action varchar(100),
  p_items_processed integer default 1,
  p_os_info varchar(100) default null,
  p_client_ip varchar(45) default null,
  p_operation_id uuid default null,
  p_operation_hash text default null
)
returns table (
  license_key varchar(64),
  client_name varchar(255),
  plan_name varchar(100),
  max_uses integer,
  used_count integer,
  remaining_uses integer,
  expiration_date date,
  deduplicated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_license public.licenses%rowtype;
  v_usage public.license_usage_logs%rowtype;
begin
  select *
    into v_license
    from public.licenses
   where licenses.license_key = upper(trim(p_license_key))
   for update;

  if not found then
    raise exception 'LICENSE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_operation_id is not null then
    select *
      into v_usage
      from public.license_usage_logs
     where license_usage_logs.license_key = v_license.license_key
       and license_usage_logs.operation_id = p_operation_id
     for update;

    if found then
      if coalesce(v_usage.operation_hash, '') <> coalesce(p_operation_hash, '') then
        raise exception 'LICENSE_OPERATION_CONFLICT' using errcode = 'P0001';
      end if;

      return query
      select
        v_license.license_key,
        v_license.client_name,
        v_license.plan_name,
        v_license.max_uses,
        v_license.used_count,
        greatest(v_license.max_uses - v_license.used_count, 0),
        v_license.expiration_date,
        true;
      return;
    end if;
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

  update public.licenses as l
     set used_count = l.used_count + 1
   where l.id = v_license.id
   returning l.* into v_license;

  insert into public.license_usage_logs (
    license_key,
    machine_id,
    action,
    items_processed,
    os_info,
    client_ip,
    timestamp,
    operation_id,
    operation_hash
  )
  values (
    v_license.license_key,
    left(trim(p_machine_id), 64),
    left(trim(p_action), 100),
    greatest(coalesce(p_items_processed, 1), 0),
    nullif(left(trim(coalesce(p_os_info, '')), 100), ''),
    nullif(left(trim(coalesce(p_client_ip, '')), 45), ''),
    current_timestamp,
    p_operation_id,
    p_operation_hash
  );

  return query
  select
    v_license.license_key,
    v_license.client_name,
    v_license.plan_name,
    v_license.max_uses,
    v_license.used_count,
    greatest(v_license.max_uses - v_license.used_count, 0),
    v_license.expiration_date,
    false;
end;
$$;

revoke all privileges on function public.consume_license_use(varchar, varchar, varchar, integer, varchar, varchar) from anon, authenticated, public;
revoke all privileges on function public.consume_license_use_v2(varchar, varchar, varchar, integer, varchar, varchar, uuid, text) from anon, authenticated, public;

grant execute on function public.consume_license_use(varchar, varchar, varchar, integer, varchar, varchar) to service_role;
grant execute on function public.consume_license_use_v2(varchar, varchar, varchar, integer, varchar, varchar, uuid, text) to service_role;

commit;
