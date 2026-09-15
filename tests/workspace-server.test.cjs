const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const output = ts.transpileModule(fs.readFileSync('lib/workspaces/server.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', output)(
  (name) => name === '@/lib/bootstrap-admins' ? { getBootstrapAdminEmailSet: () => new Set(['platform@example.test']) } : require(name),
  loaded, loaded.exports,
);
const { scopeWorkspaceClient, isPlatformAdministrator } = loaded.exports;
const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const context = { workspaceId: tenantA, user: { id: 'owner-a' }, role: 'owner', token: 'jwt' };

const fixture = () => {
  const calls = [];
  const platform = {
    from(table) {
      const builder = { then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); } };
      for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'order', 'range', 'maybeSingle']) {
        builder[method] = (...args) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    },
    rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: true }); },
    auth: { admin: { deleteUser: () => { throw new Error('Unscoped delete reached'); } } },
  };
  return { client: scopeWorkspaceClient(platform, context), calls };
};

test('reads and destructive operations always bind the verified tenant', () => {
  const { client, calls } = fixture();
  client.from('app_documents').select('*').eq('doc_id', 'other-tenant-id');
  client.from('app_documents').delete().eq('doc_id', 'other-tenant-id');
  assert.equal(calls.filter((call) => call.method === 'eq' && call.args[0] === 'tenant_id' && call.args[1] === tenantA).length, 2);
});

test('payload tenant forgery cannot move an insert, update or upsert to another workspace', () => {
  const { client, calls } = fixture();
  for (const method of ['insert', 'update', 'upsert']) client.from('app_documents')[method]({ tenant_id: tenantB, collection_path: 'settings', doc_id: 'shared-id' });
  for (const call of calls.filter((call) => ['insert', 'update', 'upsert'].includes(call.method))) assert.equal(call.args[0].tenant_id, tenantA);
  assert.equal(calls.find((call) => call.method === 'upsert').args[1].onConflict, 'tenant_id,collection_path,doc_id');
});

test('batch upserts apply tenant to every row and override unsafe conflict keys', () => {
  const { client, calls } = fixture();
  client.from('app_documents').upsert([{ doc_id: 'a', tenant_id: tenantB }, { doc_id: 'b' }], { onConflict: 'collection_path,doc_id' });
  const call = calls[0];
  assert.deepEqual(call.args[0].map((row) => row.tenant_id), [tenantA, tenantA]);
  assert.equal(call.args[1].onConflict, 'tenant_id,collection_path,doc_id');
});

test('unknown tables and RPCs are denied; whitelisted RPCs cannot forge the tenant', () => {
  const { client, calls } = fixture();
  assert.throws(() => client.from('app_workspace_members'), /fuera/);
  assert.throws(() => client.from('licenses'), /fuera/);
  assert.throws(() => client.rpc('arbitrary_privileged_function'), /habilitada/);
  client.rpc('app_apply_contractor_account_action', { p_tenant_id: tenantB });
  assert.equal(calls[0].args.p_tenant_id, tenantA);
});

test('workspace owner cannot use Auth admin to delete a user outside its membership', async () => {
  const { client } = fixture();
  await assert.rejects(client.auth.admin.deleteUser('victim-b'), /no pertenece/);
});

test('invite cannot annex a concurrent public signup into the requester workspace', async () => {
  let membershipWrites = 0;
  const client = scopeWorkspaceClient({
    auth: { admin: {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      generateLink: async (params) => ({ data: { user: {
        id: 'concurrent-signup', invited_at: new Date().toISOString(),
        user_metadata: { ...params.options.data, workspaceName: 'My independent workspace' },
      } }, error: null }),
    } },
    from() { return { insert() { membershipWrites += 1; return { error: null }; } }; },
  }, context);
  await assert.rejects(client.auth.admin.generateLink({ type: 'invite', email: 'new@example.test' }), /propio registro/);
  assert.equal(membershipWrites, 0);
});

test('an invitation result without this request nonce cannot obtain membership', async () => {
  let membershipWrites = 0;
  const client = scopeWorkspaceClient({
    auth: { admin: {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      generateLink: async () => ({ data: { user: {
        id: 'unrelated-invite', invited_at: new Date().toISOString(), user_metadata: {},
      } }, error: null }),
    } },
    from() { return { insert() { membershipWrites += 1; return { error: null }; } }; },
  }, context);
  await assert.rejects(client.auth.admin.generateLink({ type: 'invite', email: 'new@example.test' }), /propio registro/);
  assert.equal(membershipWrites, 0);
});

test('tenant profile admin role never becomes platform administration', () => {
  assert.equal(isPlatformAdministrator({ email: 'tenant@example.test', role: 'admin' }), false);
  assert.equal(isPlatformAdministrator({ email: 'platform@example.test' }), true);
});

const authenticationFixture = (options = {}) => {
  const calls = [];
  const account = options.account === undefined ? { id: 'verified-user', email_confirmed_at: '2026-09-01T00:00:00Z' } : options.account;
  const platform = {
    auth: { getUser: async (token) => { calls.push(['jwt', token]); return { data: { user: account }, error: null }; } },
    from(table) {
      const query = {};
      for (const method of ['select', 'eq']) query[method] = (...args) => { calls.push([table, method, ...args]); return query; };
      query.maybeSingle = async () => ({ error: null, data: table === 'app_workspace_members'
        ? (options.member === null ? null : { workspace_id: tenantA, role: 'owner', suspended_at: options.suspendedAt || null })
        : { id: tenantA, status: options.status || 'active', trial_ends_at: options.endsAt || null } });
      return query;
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(
    (name) => name === '@supabase/supabase-js' ? { createClient: () => platform }
      : name === '@/lib/bootstrap-admins' ? { getBootstrapAdminEmailSet: () => new Set() } : require(name), module, module.exports,
  );
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-placeholder';
  return { authorize: module.exports.requireWorkspaceContext, calls };
};

test('membership lookup uses verified JWT identity, ignoring forged tenant headers', async () => {
  const { authorize, calls } = authenticationFixture();
  const result = await authorize(new Request('https://pixel.test/api', { headers: { authorization: 'Bearer signed-token', 'x-workspace-id': tenantB } }));
  assert.equal(result.workspaceId, tenantA);
  assert.ok(calls.some((call) => call[0] === 'app_workspace_members' && call[1] === 'eq' && call[2] === 'user_id' && call[3] === 'verified-user'));
});

test('missing membership and unconfirmed email cannot access server tenant data', async () => {
  for (const options of [{ member: null }, { account: { id: 'new-user' } }]) {
    const { authorize } = authenticationFixture(options);
    await assert.rejects(authorize(new Request('https://pixel.test/api', { headers: { authorization: 'Bearer token' } })));
  }
});

test('expired trial and suspended workspace are rejected by server boundaries', async () => {
  for (const options of [{ status: 'trial', endsAt: '2000-01-01T00:00:00Z' }, { status: 'suspended' }, { suspendedAt: '2026-09-01T00:00:00Z' }]) {
    const { authorize } = authenticationFixture(options);
    await assert.rejects(authorize(new Request('https://pixel.test/api', { headers: { authorization: 'Bearer token' } })), (error) => error.status === 403);
  }
});
