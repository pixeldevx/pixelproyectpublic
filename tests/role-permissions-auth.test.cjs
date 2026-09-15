const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function harness() {
  let auth = { user: null, workspace: null, loading: true, workspaceExpired: false };
  let stateCursor = 0;
  let effectCursor = 0;
  const states = [];
  const effects = [];
  const pendingEffects = [];
  const subscriptions = [];
  const react = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useMemo(callback) { return callback(); },
    useEffect(callback, dependencies) {
      const index = effectCursor++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, key) => previous.dependencies[key] !== value)) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { dependencies, cleanup: callback() };
        });
      }
    },
  };
  const imports = {
    react,
    '@/hooks/useAuth': { useAuth: () => auth },
    '@/lib/backend': { db: {} },
    '@/lib/permissions': {
      DEFAULT_ROLE_PERMISSIONS: { marker: 'default' },
      normalizeRolePermissions: (value) => value || { marker: 'default' },
      resolveRolePermissions: (value) => value,
    },
    '@/lib/supabase/document-store': {
      doc: (_db, collection, id) => ({ collection, id }),
      onSnapshot(_ref, next, error) {
        assert.ok(auth.user && auth.workspace && !auth.loading && !auth.workspaceExpired, 'subscription starts only after workspace initialization');
        const entry = { scope: auth.workspace.id, next, error, cancelled: false };
        subscriptions.push(entry);
        return () => { entry.cancelled = true; };
      },
    },
  };
  const source = ts.transpileModule(fs.readFileSync('hooks/useRolePermissions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)((name) => imports[name], module, module.exports);
  const render = () => { stateCursor = 0; effectCursor = 0; return module.exports.useRolePermissions('user'); };
  const flush = () => { pendingEffects.splice(0).forEach((effect) => effect()); };
  return { render, flush, subscriptions, setAuth(value) { auth = { ...auth, ...value }; }, emit(index, marker) { subscriptions[index].next({ exists: () => true, data: () => ({ marker }) }); } };
}

test('permissions wait through initial and signed-in auth loading, then subscribe once ready', () => {
  const app = harness();
  assert.equal(app.render().loading, true); app.flush();
  assert.equal(app.subscriptions.length, 0);
  app.setAuth({ user: { uid: 'a' }, workspace: { id: 'wa' } });
  app.render(); app.flush(); assert.equal(app.subscriptions.length, 0);
  app.setAuth({ loading: false }); app.render(); app.flush();
  assert.equal(app.subscriptions.length, 1);
  app.emit(0, 'workspace-a');
  assert.deepEqual(app.render(), { permissions: { marker: 'workspace-a' }, settings: { marker: 'workspace-a' }, loading: false });
});

test('workspace switches immediately hide old settings and ignore its late callbacks', () => {
  const app = harness();
  app.setAuth({ user: { uid: 'a' }, workspace: { id: 'wa' }, loading: false });
  app.render(); app.flush(); app.emit(0, 'workspace-a');
  assert.equal(app.render().settings.marker, 'workspace-a');
  app.setAuth({ user: { uid: 'b' }, workspace: { id: 'wb' } });
  const transition = app.render();
  assert.equal(transition.settings.marker, 'default'); assert.equal(transition.loading, true);
  app.flush(); assert.equal(app.subscriptions[0].cancelled, true);
  assert.equal(app.subscriptions.length, 2);
  app.emit(1, 'workspace-b'); app.emit(0, 'late-workspace-a');
  assert.equal(app.render().settings.marker, 'workspace-b');
});

test('logout and expiry cancel listeners and clear settings until a valid workspace resumes', () => {
  const app = harness();
  app.setAuth({ user: { uid: 'a' }, workspace: { id: 'wa' }, loading: false });
  app.render(); app.flush(); app.emit(0, 'workspace-a');
  app.setAuth({ workspaceExpired: true });
  assert.equal(app.render().settings.marker, 'default'); app.flush();
  assert.equal(app.subscriptions[0].cancelled, true);
  app.setAuth({ user: null, workspace: null, workspaceExpired: false });
  app.render(); app.flush(); app.emit(0, 'late-after-logout');
  assert.equal(app.render().settings.marker, 'default');
  assert.equal(app.subscriptions.length, 1);
  app.setAuth({ user: { uid: 'a' }, workspace: { id: 'wa' } });
  app.render(); app.flush(); assert.equal(app.subscriptions.length, 2);
});
