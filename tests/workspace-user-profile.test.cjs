const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { NextRequest } = require('next/server');
const targetId = '10000000-0000-4000-a000-000000000001';
const workspaceId = '20000000-0000-4000-a000-000000000001';

function fixture({ foreignUser = false, foreignOrg = false, owner = false } = {}) {
  const calls = [];
  const client = {
    workspace: { workspaceId },
    auth: { admin: {
      getUserById: async (id) => {
        calls.push(['membership', id]);
        if (foreignUser) throw Object.assign(new Error('La cuenta no pertenece a tu espacio.'), { status: 403 });
        return { data: { user: { id, email: 'member@example.test' } }, error: null };
      },
      setWorkspaceRole: async (id, role) => {
        calls.push(['role', id, role]);
        if (owner && role !== 'admin') throw Object.assign(new Error('El propietario debe conservar su rol.'), { status: 400 });
        return { error: null };
      },
    } },
    from: () => {
      const query = {
        collection: '',
        select() { return this; },
        eq(key, value) { if (key === 'collection_path') this.collection = value; return this; },
        in(_key, values) { this.values = values; return this; },
        maybeSingle: async () => ({ data: { data: { role: 'user', displayName: 'Miembro', organizationIds: [workspaceId] } }, error: null }),
        then(resolve) { return Promise.resolve({ data: this.collection === 'organizations' ? (foreignOrg ? [{ doc_id: workspaceId }] : this.values.map((id) => ({ doc_id: id }))) : [], error: null }).then(resolve); },
        upsert: async (row) => { calls.push(['write', row]); return { error: null }; },
      };
      return query;
    },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('app/api/admin/users/profile/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)((name) => name === '@/lib/workspaces/server' ? {
    getWorkspaceServerClient: async () => client, workspaceErrorStatus: (error) => error.status || 500,
  } : require(name), module, module.exports);
  return { calls, patch: (body) => module.exports.PATCH(new NextRequest('https://public.example.test/api/admin/users/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) };
}

test('profile API rejects foreign membership before reading or writing profile fields', async () => {
  const app = fixture({ foreignUser: true });
  assert.equal((await app.patch({ userId: targetId, systemRole: 'admin' })).status, 403);
  assert.deepEqual(app.calls, [['membership', targetId]]);
});

test('profile API validates all organization choices inside the current workspace', async () => {
  const app = fixture({ foreignOrg: true });
  assert.equal((await app.patch({ userId: targetId, organizationIds: ['foreign-organization'] })).status, 400);
  assert.equal(app.calls.some((call) => call[0] === 'role' || call[0] === 'write'), false);
});

test('tenant admin profile retains workspace organization and syncs authoritative membership', async () => {
  const app = fixture();
  assert.equal((await app.patch({ userId: targetId, displayName: 'Ana', systemRole: 'admin', organizationIds: [] })).status, 200);
  assert.deepEqual(app.calls.find((call) => call[0] === 'role'), ['role', targetId, 'admin']);
  const row = app.calls.find((call) => call[0] === 'write')[1];
  assert.equal(row.data.organizationId, workspaceId);
  assert.deepEqual(row.data.organizationIds, [workspaceId]);
  assert.equal(row.data.uid, targetId);
});

test('the owner cannot lose the administrator role through profile management', async () => {
  const app = fixture({ owner: true });
  assert.equal((await app.patch({ userId: targetId, systemRole: 'user' })).status, 400);
  assert.equal(app.calls.some((call) => call[0] === 'write'), false);
});
