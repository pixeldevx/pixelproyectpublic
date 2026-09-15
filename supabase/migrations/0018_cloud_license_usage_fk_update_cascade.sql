begin;

alter table if exists public.license_usage_logs
drop constraint if exists license_usage_logs_license_key_fkey;

alter table if exists public.license_usage_logs
add constraint license_usage_logs_license_key_fkey
foreign key (license_key)
references public.licenses(license_key)
on update cascade
on delete cascade;

commit;
