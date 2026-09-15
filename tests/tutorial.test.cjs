const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function transpile(path, imports = {}) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => Object.hasOwn(imports, name) ? imports[name] : require(name), module, module.exports);
  return module.exports;
}
const learning = transpile('lib/tutorial/learning.ts');

test('tutorial progress separates users and workspaces and persists no exercise content', () => {
  const a = learning.tutorialStorageKey('user-a', 'workspace-a');
  assert.notEqual(a, learning.tutorialStorageKey('user-b', 'workspace-a'));
  assert.notEqual(a, learning.tutorialStorageKey('user-a', 'workspace-b'));
  assert.notEqual(learning.tutorialStorageKey('b:c', 'a'), learning.tutorialStorageKey('c', 'a:b'));
  assert.throws(() => learning.tutorialStorageKey('', 'workspace-a'));
  assert.deepEqual(JSON.parse(learning.serializeTutorialProgress(['tasks', 'project', 'tasks', 'unknown'])), { version: 1, completed: ['project', 'tasks'] });
  assert.deepEqual(learning.readTutorialProgress('{"version":1,"completed":["tasks","project","tasks",{},"bogus"],"email":"private"}'), ['project', 'tasks']);
});

test('corrupt and unsupported progress safely starts a new tutorial', () => {
  for (const raw of [null, '', '{}', '{bad', 'null', '[]', '{"version":2,"completed":["project"]}', '{"version":1,"completed":"project"}']) {
    assert.deepEqual(learning.readTutorialProgress(raw), []);
  }
});

test('task scheduling rejects invalid calendar dates and inverted ranges', () => {
  assert.equal(learning.taskDateError('2028-02-29', '2028-03-01'), null);
  assert.equal(learning.taskDateError('2027-02-28', '2027-02-28'), null);
  assert.match(learning.taskDateError('2027-02-29', '2027-03-01'), /válidas/);
  assert.match(learning.taskDateError('2027-03-02', '2027-03-01'), /posterior/);
  assert.match(learning.taskDateError('', '2027-03-01'), /válidas/);
});

test('rate calculation preserves fractions, zero income, negative margin and blocks invalid quantities', () => {
  assert.deepEqual(learning.calculateRatePreview(50000, 30000, 2.5), { income: 125000, cost: 75000, margin: 50000 });
  assert.deepEqual(learning.calculateRatePreview(0, 30000, 1), { income: 0, cost: 30000, margin: -30000 });
  for (const values of [[1, 1, 0], [1, 1, -1], [NaN, 2, 1], [Infinity, 2, 1], [-1, 2, 1], [Number.MAX_VALUE, 1, 2]]) {
    assert.equal(learning.calculateRatePreview(...values), null);
  }
});

// Exercise component harness: dispatches the same form/control handlers as the UI.
// There is deliberately no backend or email client in the tutorial module.
function exercise(lesson) {
  const slots = [];
  let cursor = 0;
  let completed = 0;
  const jsx = (type, props) => ({ type, props: props || {} });
  const fakeReact = { useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  } };
  const icons = new Proxy({}, { get: (_, name) => String(name) });
  const module = transpile('components/tutorial/TutorialExercises.tsx', {
    react: fakeReact,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': icons,
    '@/lib/tutorial/learning': learning,
    './tutorial.module.css': {},
  });
  const render = () => {
    cursor = 0;
    const element = module.TutorialExercise({ lesson, onComplete: () => completed++ });
    return element.type(element.props);
  };
  function all(node, predicate, results = []) {
    if (!node) return results;
    if (Array.isArray(node)) { node.forEach((child) => all(child, predicate, results)); return results; }
    if (typeof node !== 'object') return results;
    if (predicate(node)) results.push(node);
    all(node.props?.children, predicate, results);
    return results;
  }
  const content = (node) => Array.isArray(node) ? node.map(content).join('') : typeof node === 'object' && node ? content(node.props?.children) : node == null ? '' : String(node);
  const field = (label) => {
    const parent = all(render(), (node) => node.props?.label === label)[0];
    assert.ok(parent, `field ${label} exists`);
    return parent.props.children;
  };
  const set = (label, value) => field(label).props.onChange({ target: { value } });
  const setPerson = (value) => {
    const select = all(render(), (node) => typeof node.type === 'function' && node.type.name === 'MemberSelect')[0];
    assert.ok(select); select.props.onChange(value);
  };
  const click = (text) => {
    const button = all(render(), (node) => node.type === 'button' && content(node).includes(text))[0];
    assert.ok(button, `button ${text} exists`);
    assert.ok(!button.props.disabled, `${text} is enabled`);
    button.props.onClick();
  };
  const submit = (index = 0) => all(render(), (node) => node.type === 'form')[index].props.onSubmit({ preventDefault() {} });
  return { render, all, field, set, setPerson, click, submit, completed: () => completed, button: (text) => all(render(), (node) => node.type === 'button' && content(node).includes(text))[0] };
}

test('project practice requires name, goal and organization before creation', () => {
  const app = exercise('project');
  app.submit(); assert.equal(app.completed(), 0);
  app.set('Nombre del Proyecto', 'Mi proyecto');
  app.set('Descripción', 'Entregar una versión inicial');
  app.submit(); assert.equal(app.completed(), 0);
  app.set('Organización', 'demo'); app.submit();
  assert.equal(app.completed(), 1);
});

test('people practice requires a role, organization and accepted invitation', () => {
  const app = exercise('people');
  assert.ok(app.button('Simular Enviar Invitación').props.disabled);
  app.set('Rol del Sistema', 'user');
  app.all(app.render(), (node) => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  app.click('Simular Enviar Invitación'); assert.equal(app.completed(), 0);
  app.click('Simular aceptación del enlace'); assert.equal(app.completed(), 1);
});

test('group practice requires actually assigning the example task to the created group', () => {
  const app = exercise('groups');
  app.set('Nombre del grupo', 'Preparación'); app.submit();
  assert.equal(app.completed(), 0);
  app.set('Grupo visual de «Definir el alcance»', 'demo');
  assert.equal(app.completed(), 1);
});

test('task practice completes only after a valid assignment, schedule and status transition', () => {
  const app = exercise('tasks');
  app.set('Título de la tarea', 'Revisar'); app.setPerson('ana'); app.set('Grupo visual', 'preparation');
  app.set('Fecha de inicio', '2027-03-03'); app.set('Fecha de fin', '2027-03-01'); app.submit();
  assert.equal(app.completed(), 0);
  assert.ok(app.all(app.render(), (node) => node.props?.role === 'alert').length);
  app.set('Fecha de fin', '2027-03-05'); app.submit(); assert.equal(app.completed(), 0);
  app.set('Ahora cambia el estado a Trabajando', 'Trabajando'); assert.equal(app.completed(), 1);
});

test('Gantt practice needs scale exploration and a task bar inspection', () => {
  const app = exercise('gantt'); app.click('Gantt completo');
  app.click('Semana'); assert.equal(app.completed(), 0);
  const bar = app.all(app.render(), (node) => node.type === 'button' && node.props['aria-label']?.startsWith('Definir el alcance'))[0];
  bar.props.onClick(); assert.equal(app.completed(), 1);
});

test('workflow practice requires two assigned steps and completion of the whole sequence', () => {
  const app = exercise('workflow');
  app.set('Nombre del paso', 'Preparar'); app.setPerson('ana'); app.submit();
  assert.ok(app.button('Crear flujo de ejemplo').props.disabled);
  app.set('Nombre del paso', 'Aprobar'); app.setPerson('you'); app.submit();
  app.click('Crear flujo de ejemplo'); assert.equal(app.completed(), 0);
  app.click('Simular completar paso 1'); assert.equal(app.completed(), 0);
  app.click('Simular completar paso 2'); assert.equal(app.completed(), 1);
});

test('rate practice completes after creating a rate and recording a positive quantity', () => {
  const app = exercise('rates');
  app.set('Nombre', 'Revisión'); app.set('Indicador a medir', 'Entregables');
  app.set('Ingreso por indicador (COP)', '50000'); app.set('Costo por indicador (COP)', '30000'); app.submit();
  assert.equal(app.completed(), 0);
  app.set('Unidades del movimiento de ejemplo', '0'); app.submit(1); assert.equal(app.completed(), 0);
  app.set('Unidades del movimiento de ejemplo', '3'); app.submit(1); assert.equal(app.completed(), 1);
});
