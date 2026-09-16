const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness() {
  const states = [];
  const effects = [];
  const pendingEffects = [];
  const navigations = [];
  const logins = [];
  const resets = [];
  const request = deferred();
  let stateCursor = 0;
  let effectCursor = 0;
  let reloads = 0;
  let auth = {
    user: null,
    workspace: null,
    workspaceExpired: false,
    loading: false,
    accessError: '',
    loginWithEmail: (email, password) => { logins.push({ email, password }); return request.promise; },
    requestPasswordReset: async (email) => { resets.push(email); },
    logout: async () => {},
  };
  const router = { replace: (path) => { navigations.push(path); } };
  const react = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
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
  const jsx = (type, props) => ({ type, props: props || {} });
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/link': { default: 'a' },
    'next/navigation': { useRouter: () => router },
    'lucide-react': { ArrowLeft: 'icon', Lock: 'icon', Mail: 'icon' },
    '@/components/ui/button': { Button: 'button' },
    '@/hooks/useAuth': { useAuth: () => auth },
    '@/components/auth/WorkspaceAccessState': { WorkspaceAccessState: 'workspace-access-state' },
  };
  const source = ts.transpileModule(fs.readFileSync('app/login/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  const browser = {
    setTimeout: () => 1,
    clearTimeout: () => {},
    location: { reload: () => { reloads++; } },
  };
  new Function('require', 'module', 'exports', 'window', 'console', source)(
    (name) => { assert.ok(name in imports, `Unexpected import: ${name}`); return imports[name]; },
    module, module.exports, browser, { error: () => {} },
  );
  return {
    render() { stateCursor = 0; effectCursor = 0; return module.exports.default(); },
    flush() { pendingEffects.splice(0).forEach((effect) => effect()); },
    setAuth(value) { auth = { ...auth, ...value }; },
    request, navigations, logins, resets,
    reloads: () => reloads,
  };
}

function allNodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(allNodes);
  return [tree, ...allNodes(tree.props?.children)];
}

function find(tree, predicate) {
  const node = allNodes(tree).find(predicate);
  assert.ok(node, 'Expected an element matching the requested control');
  return node;
}

function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join('');
  return text(tree.props?.children);
}

function enterCredentials(app) {
  const view = app.render();
  app.flush();
  find(view, (node) => node.props.id === 'login-email').props.onChange({ target: { value: 'person@example.test' } });
  find(view, (node) => node.props.id === 'login-password').props.onChange({ target: { value: 'test-only-password' } });
}

function submit(app) {
  return find(app.render(), (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
}

test('login gives immediate feedback, clears the password, and opens a verified workspace without reloading', async () => {
  const app = harness();
  enterCredentials(app);
  const submission = submit(app);
  let view = app.render();
  const pendingButton = find(view, (node) => node.props.type === 'submit');
  assert.equal(pendingButton.props.disabled, true);
  assert.match(text(pendingButton), /Iniciando sesión/);
  assert.deepEqual(app.logins, [{ email: 'person@example.test', password: 'test-only-password' }]);
  assert.deepEqual(app.navigations, []);

  app.request.resolve();
  await submission;
  view = app.render();
  app.flush();
  assert.match(text(find(view, (node) => node.props.role === 'status')), /Sesión iniciada.*preparando tu espacio/);
  assert.equal(find(view, (node) => node.props.id === 'login-password').props.value, '');
  const openingButton = find(view, (node) => node.props.type === 'submit');
  assert.equal(openingButton.props.disabled, true);
  assert.match(text(openingButton), /Abriendo tu espacio/);
  assert.deepEqual(app.navigations, []);

  app.setAuth({ loading: true });
  view = app.render();
  app.flush();
  assert.match(text(find(view, (node) => node.props.role === 'status')), /Sesión iniciada.*preparando tu espacio/i);
  assert.deepEqual(app.navigations, [], 'Workspace verification must finish before navigation');
  app.setAuth({ user: { uid: 'person-a' }, workspace: { id: 'workspace-a', is_platform_admin: false }, loading: false });
  app.render(); app.flush();
  assert.deepEqual(app.navigations, ['/dashboard']);
  assert.equal(app.reloads(), 0);
});

test('verified platform administrators automatically enter global administration', () => {
  const app = harness();
  app.setAuth({ user: { uid: 'platform-admin' }, workspace: { id: 'legacy-workspace', is_platform_admin: true } });
  app.render(); app.flush();
  assert.deepEqual(app.navigations, ['/platform']);
  assert.equal(app.reloads(), 0);
});

test('expired workspaces and failed workspace initialization stay on the access screen', () => {
  const app = harness();
  app.setAuth({ user: { uid: 'person-a' }, accessError: 'No pudimos preparar tu espacio. Puedes reintentar.' });
  assert.equal(app.render().type, 'workspace-access-state');
  app.flush();
  assert.deepEqual(app.navigations, []);
  app.setAuth({ workspace: { id: 'workspace-a' }, workspaceExpired: true, accessError: '' });
  assert.equal(app.render().type, 'workspace-access-state');
  app.flush();
  assert.deepEqual(app.navigations, []);
  assert.equal(app.reloads(), 0);
});

test('invalid credentials produce a readable alert and restore the submit button', async () => {
  const app = harness();
  enterCredentials(app);
  const submission = submit(app);
  app.request.reject({ code: 'invalid_credentials', message: 'Invalid login credentials' });
  await submission;
  const view = app.render();
  assert.equal(text(find(view, (node) => node.props.role === 'alert')), 'Correo o contraseña incorrectos.');
  assert.equal(find(view, (node) => node.props.type === 'submit').props.disabled, false);
  assert.match(text(find(view, (node) => node.props.type === 'submit')), /Iniciar sesión/);
  assert.deepEqual(app.navigations, []);
});

test('unconfirmed accounts receive confirmation guidance without a success message', async () => {
  const app = harness();
  enterCredentials(app);
  const submission = submit(app);
  app.request.reject({ code: 'email_not_confirmed', message: 'Email not confirmed' });
  await submission;
  const view = app.render();
  assert.match(text(find(view, (node) => node.props.role === 'alert')), /Confirma tu correo/);
  assert.equal(allNodes(view).some((node) => node.props.role === 'status'), false);
  assert.deepEqual(app.navigations, []);
});

test('password recovery confirms the email request without opening a workspace', async () => {
  const app = harness();
  enterCredentials(app);
  const view = app.render();
  find(view, (node) => node.type === 'button' && node.props.type === 'button' && text(node) === 'Enviar enlace').props.onClick();
  await submit(app);
  const result = app.render();
  assert.deepEqual(app.resets, ['person@example.test']);
  assert.deepEqual(app.logins, []);
  assert.match(text(find(result, (node) => node.props.role === 'status')), /enlace para restablecer tu contraseña/);
  const button = find(result, (node) => node.props.type === 'submit');
  assert.equal(button.props.disabled, false);
  assert.equal(text(button), 'Enviar enlace');
  assert.deepEqual(app.navigations, []);
  assert.equal(app.reloads(), 0);
});
