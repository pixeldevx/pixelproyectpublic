const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function transpile(path, imports) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => imports?.[name] || require(name), module, module.exports);
  return module.exports;
}
const workspaceTypes = transpile('lib/workspaces/types.ts');
const trial = { id: 'workspace-a', organization_id: 'workspace-a', name: 'Equipo A', role: 'admin', status: 'trial', trial_ends_at: '2099-01-01T00:00:00Z' };
const identity = { uid: 'user-a', id: 'user-a', email: 'a@example.test', displayName: 'A' };

function harness({ rpcError = null, profile = null, rpcPromise = null } = {}) {
  const slots = [];
  const effects = [];
  const events = [];
  let cursor = 0;
  let collecting = true;
  let authListener;
  let currentContext;
  let clientWorkspace = null;
  let signouts = 0;
  const react = {
    createContext: () => ({ Provider: {} }),
    useContext: () => currentContext,
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => { if (collecting) effects.push(fn); },
    createElement: (_type, props) => { currentContext = props.value; },
  };
  const auth = { currentUser: identity, onAuthStateChanged: (listener) => { authListener = listener; return () => {}; } };
  const module = transpile('hooks/useAuth.ts', {
    react,
    '@/lib/backend': { auth, db: {} },
    '@/lib/supabase/auth-shim': { clearLocalAuthState: () => {}, signOut: async () => { signouts++; }, signInWithEmailAndPassword: async () => {}, resetPasswordForEmail: async () => {} },
    '@/lib/supabase/document-store': {
      doc: (_db, collection, id) => ({ collection, id }),
      getDoc: async (ref) => {
        events.push(['profile', ref.collection, ref.id, clientWorkspace]);
        return { exists: () => true, data: () => profile || { role: 'admin', organizationIds: [trial.organization_id] } };
      },
    },
    '@/lib/supabase/client': { supabase: {
      auth: { getUser: async () => ({ data: { user: { id: identity.id, user_metadata: { role: 'root', workspace_id: 'victim', displayName: 'Ana', workspaceName: 'Equipo A' } } }, error: null }) },
      rpc: async (name, params) => {
        events.push(['rpc', name, params]);
        return rpcPromise ? await rpcPromise : { data: rpcError ? null : trial, error: rpcError };
      },
    } },
    '@/lib/organizations': { getOrganizationIds: (value) => value.organizationIds || [] },
    '@/lib/workspaces/types': workspaceTypes,
    '@/lib/workspaces/client-context': { setClientWorkspace: (id) => { clientWorkspace = id; events.push(['workspace', id]); } },
  });
  const render = () => { cursor = 0; module.AuthProvider({ children: null }); return currentContext; };
  render();
  collecting = false;
  effects.forEach((effect) => effect());
  return { render, emit: (user) => authListener(user), events, workspace: () => clientWorkspace, signouts: () => signouts };
}

test('profile verification derives role from protected profile and scopes before reading it', async () => {
  const app = harness({ profile: { role: 'user', organizationIds: ['workspace-a'] } });
  await app.emit(identity);
  const state = app.render();
  assert.equal(state.userRole, 'user');
  assert.equal(state.userOrganizationId, 'workspace-a');
  assert.equal(state.workspace.id, 'workspace-a');
  assert.equal(state.loading, false);
  assert.deepEqual(app.events.find((event) => event[0] === 'rpc'), ['rpc', 'ensure_trial_workspace', { workspace_name: 'Equipo A', display_name: 'Ana' }]);
  assert.deepEqual(app.events.find((event) => event[0] === 'profile'), ['profile', 'users', 'user-a', 'workspace-a']);
});

test('provisioning failures retain the signed-in account with retry and no role', async () => {
  const app = harness({ rpcError: { code: 'TEMPORARY' } });
  await app.emit(identity);
  const state = app.render();
  assert.equal(state.user.uid, 'user-a');
  assert.equal(state.userRole, null);
  assert.equal(state.workspace, null);
  assert.equal(state.loading, false);
  assert.match(state.accessError, /reintentar/i);
  assert.equal(app.signouts(), 0);
  assert.equal(app.workspace(), null);
});

test('a completed provisioning request cannot restore workspace after logout', async () => {
  let resolve;
  const rpcPromise = new Promise((done) => { resolve = done; });
  const app = harness({ rpcPromise });
  const verification = app.emit(identity);
  await Promise.resolve();
  await app.render().logout();
  resolve({ data: trial, error: null });
  await verification;
  const state = app.render();
  assert.equal(state.user, null);
  assert.equal(state.workspace, null);
  assert.equal(app.workspace(), null);
  assert.equal(app.events.some((event) => event[0] === 'profile'), false);
});

test('trial ends at the exact boundary and inactive or malformed workspaces stay blocked', () => {
  const end = Date.parse(trial.trial_ends_at);
  assert.equal(workspaceTypes.isWorkspaceExpired(trial, end - 1), false);
  assert.equal(workspaceTypes.isWorkspaceExpired(trial, end), true);
  assert.equal(workspaceTypes.isWorkspaceExpired({ ...trial, trial_ends_at: null }, end), true);
  assert.equal(workspaceTypes.isWorkspaceExpired({ ...trial, trial_ends_at: 'bad' }, end), true);
  assert.equal(workspaceTypes.isWorkspaceExpired({ ...trial, status: 'suspended' }, end - 1), true);
  assert.equal(workspaceTypes.isWorkspaceExpired({ ...trial, status: 'active', trial_ends_at: null }, end), false);
});
