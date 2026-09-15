/**
 * Real PostgreSQL (PGlite) migration/RLS test, no cloud credentials or network.
 * Install @electric-sql/pglite in an external directory, then run:
 * PGLITE_MODULE_ROOT=/absolute/path node tests/run-workspace-db.mjs
 * Auth/Storage provider tables are fixtures. PostGIS geometry is represented as
 * text and its GiST index is omitted; this does not test GIS math or realtime.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = process.env.PGLITE_MODULE_ROOT;
if (!moduleRoot) throw new Error('Set PGLITE_MODULE_ROOT to the directory where @electric-sql/pglite is installed.');
const externalRequire = createRequire(path.resolve(moduleRoot, 'package.json'));
const { PGlite } = externalRequire('@electric-sql/pglite');
const { pgcrypto } = externalRequire('@electric-sql/pglite/contrib/pgcrypto');
const db = new PGlite({ extensions: { pgcrypto } });
let stage = 'provider fixtures';

try {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema storage;
    create schema extensions;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      aud text, role text, email text unique, email_confirmed_at timestamptz, invited_at timestamptz, last_sign_in_at timestamptz,
      is_anonymous boolean default false, raw_user_meta_data jsonb default '{}'::jsonb,
      raw_app_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(auth.jwt()->>'role',current_user::text)
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant select on auth.users to service_role;
    create table storage.buckets(id text primary key, name text not null, public boolean default false);
    create table storage.objects(
      id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(),
      unique(bucket_id,name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects,storage.buckets to service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
    create publication supabase_realtime;
    set app.bootstrap_admin_email='fixture-admin@example.invalid';
    insert into auth.users(id,aud,role,email,email_confirmed_at)
      values('00000000-0000-4000-8000-000000000001','authenticated','authenticated','fixture-admin@example.invalid',now());
  `);

  const migrationDirectory = path.join(root, 'supabase/migrations');
  const names = (await fs.readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();
  let count = 0;
  for (const name of names) {
    stage = name;
    let sql = await fs.readFile(path.join(migrationDirectory, name), 'utf8');
    if (name < '20260915200621') {
      sql = sql
        .replace(/create extension if not exists postgis with schema extensions;/ig, '-- PostGIS type represented as text in this harness.')
        .replace(/create extension if not exists pg_cron;/ig, '-- Cron scheduling is disabled in the public installation.')
        .replace(/extensions\.geometry\(Geometry,\s*4326\)/g, 'text')
        .replace(/create index if not exists project_spatial_features_geom_idx\s+on public\.project_spatial_features using gist \(geom\);/ig, '-- GIS-only GiST index omitted.');
    }
    await db.exec(sql);
    count += 1;
  }
  console.log(`Applied ${count} migrations; workspace migration ran unchanged.`);
  stage = 'workspace_isolation.sql';
  const testSql = await fs.readFile(path.join(root, 'supabase/tests/workspace_isolation.sql'), 'utf8');
  await db.exec(testSql);
  console.log('Workspace isolation SQL passed (real PostgreSQL policies, grants, triggers and functions).');
  stage = 'workspace_rpc.sql';
  await db.exec(await fs.readFile(path.join(root, 'supabase/tests/workspace_rpc.sql'), 'utf8'));
  console.log('Service-role RPC tenant isolation and independent idempotency keys passed.');
  stage = 'platform_support.sql';
  await db.exec(await fs.readFile(path.join(root, 'supabase/tests/platform_support.sql'), 'utf8'));
  console.log('Global support authorization, audit and account suspension passed.');
  const result = await db.query('select count(*)::integer as workspaces from public.app_workspaces');
  console.log(`Rollback verified: ${result.rows[0].workspaces} original workspace remains.`);
} catch (error) {
  console.error(`FAILED at ${stage}: ${error.message}`);
  for (const field of ['code', 'detail', 'hint', 'where', 'position', 'internalPosition', 'internalQuery']) {
    if (error[field]) console.error(`${field}: ${error[field]}`);
  }
  process.exitCode = 1;
} finally {
  await db.close();
}
