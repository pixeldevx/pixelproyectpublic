create table if not exists public.user_reassignment_audit (
  operation_id uuid primary key,
  status text not null check (status in ('processing', 'completed', 'failed')),
  source_user_id text not null,
  source_email text not null,
  target_user_id text not null,
  target_email text not null,
  reason text not null,
  requested_by_id text not null,
  requested_by_email text not null,
  counts jsonb not null default '{}'::jsonb,
  affected_project_ids text[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_reassignment_audit_source_idx
  on public.user_reassignment_audit (source_user_id, created_at desc);

create index if not exists user_reassignment_audit_target_idx
  on public.user_reassignment_audit (target_user_id, created_at desc);

alter table public.user_reassignment_audit enable row level security;

revoke all privileges on table public.user_reassignment_audit from public;
revoke all privileges on table public.user_reassignment_audit from anon;
revoke all privileges on table public.user_reassignment_audit from authenticated;
grant select, insert, update on table public.user_reassignment_audit to service_role;

comment on table public.user_reassignment_audit is
  'Private audit trail for global-admin operational user reassignments. Historical rates remain untouched.';
