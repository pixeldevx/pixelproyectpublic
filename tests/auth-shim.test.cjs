const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync('lib/supabase/auth-shim.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const userA = { id: 'user-a', email: 'a@example.test', email_confirmed_at: '2026-01-01', user_metadata: { displayName: 'Ana' } };
const sessionFor = (user = userA, token = 'test-token-a') => ({ user, access_token: token });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const microtasks = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness({ initial = Promise.resolve({ data: { session: null }, error: null }) } = {}) {
  const timers = new Map();
  const subscribers = new Set();
  const requests = [];
  const errors = [];
  const sdkReads = [];
  let timerId = 0;
  let session = null;
  let locked = false;
  let fetchHandler = async () => ({ ok: true });
  let releaseLock;
  const emit = async (event, nextSession) => {
    session = nextSession;
    locked = true;
    const lockReleased = new Promise((done) => { releaseLock = done; });
    try {
      for (const callback of subscribers) {
        const result = callback(event, nextSession);
        assert.equal(result, undefined, 'SDK callback must not return an async consumer promise');
        await result;
      }
      await Promise.resolve();
    } finally {
      locked = false;
      releaseLock();
    }
    return lockReleased;
  };
  const sdk = {
    getSession: () => initial,
    onAuthStateChange(callback) {
      subscribers.add(callback);
      return { data: { subscription: { unsubscribe: () => subscribers.delete(callback) } } };
    },
    signInWithPassword: async () => {
      const next = sessionFor();
      await emit('SIGNED_IN', next);
      return { data: { user: next.user, session: next }, error: null };
    },
    updateUser: async ({ data }) => {
      const next = sessionFor({ ...session.user, user_metadata: data });
      await emit('USER_UPDATED', next);
      return { data: { user: next.user }, error: null };
    },
    signOut: async () => {
      await emit('SIGNED_OUT', null);
      return { error: null };
    },
    getUser: async () => {
      sdkReads.push({ locked });
      if (locked) await new Promise((done) => { const previous = releaseLock; releaseLock = () => { previous(); done(); }; });
      return { data: { user: session?.user || null }, error: null };
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'window', 'fetch', 'console', 'AbortSignal', source)(
    (name) => { assert.equal(name, './client'); return { supabase: { auth: sdk } }; },
    module,
    module.exports,
    (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    (id) => timers.delete(id),
    { localStorage: {} },
    async (_url, options) => { requests.push(options.headers.Authorization || null); return fetchHandler(options); },
    { error: (...args) => errors.push(args) },
    { timeout: () => ({}) },
  );
  const flush = async () => {
    await microtasks();
    const ready = [...timers].filter(([, timer]) => timer.delay === 0);
    for (const [id, timer] of ready) {
      if (timers.delete(id)) timer.callback();
    }
    await microtasks();
  };
  return { ...module.exports, sdk, emit, flush, requests, errors, sdkReads, subscribers, setFetch(handler) { fetchHandler = handler; } };
}

test('successful password login notifies the subscriber without refresh while the file cookie is pending', async () => {
  const app = harness();
  const users = [];
  const unsubscribe = app.auth.onAuthStateChanged((user) => { users.push(user?.uid || null); });
  await app.flush();
  assert.deepEqual(users, [null]);
  const cookie = deferred();
  app.setFetch(() => cookie.promise);
  const result = await app.signInWithEmailAndPassword(app.auth, 'a@example.test', 'test-only-password');
  assert.equal(result.user.uid, 'user-a');
  assert.equal(app.auth.currentUser.uid, 'user-a');
  await app.flush();
  assert.deepEqual(users, [null, 'user-a'], 'shared currentUser assignment must not suppress SIGNED_IN');
  assert.deepEqual(app.requests, [null, 'Bearer test-token-a']);
  cookie.resolve({ ok: true });
  await app.flush();
  assert.deepEqual(users, [null, 'user-a']);
  unsubscribe();
});

test('async consumers can reenter the SDK only after the Auth event releases its lock', async () => {
  const app = harness();
  let readCompleted = false;
  const unsubscribe = app.auth.onAuthStateChanged(async (user) => {
    if (!user) return;
    await app.sdk.getUser();
    readCompleted = true;
  });
  await app.flush();
  await app.emit('SIGNED_IN', sessionFor());
  await microtasks();
  assert.deepEqual(app.sdkReads, [], 'consumer must wait for a later task, not the SDK callback microtasks');
  await app.flush();
  assert.deepEqual(app.sdkReads, [{ locked: false }]);
  assert.equal(readCompleted, true);
  unsubscribe();
});

test('password login still reaches the listener after storage finishes and the helper updated currentUser', async () => {
  const app = harness();
  const users = [];
  const unsubscribe = app.auth.onAuthStateChanged((user) => { users.push(user?.uid || null); });
  await app.flush();
  const cookie = deferred();
  app.setFetch(() => cookie.promise);
  await app.signInWithEmailAndPassword(app.auth, 'a@example.test', 'test-only-password');
  assert.equal(app.auth.currentUser.uid, 'user-a');
  cookie.resolve({ ok: true });
  await app.flush();
  assert.deepEqual(users, [null, 'user-a'], 'successful login must reach the Provider after cookie completion');
  await app.signOut(app.auth);
  await app.flush();
  assert.deepEqual(users, [null, 'user-a', null], 'signOut helper must not suppress its own event either');
  unsubscribe();
});

test('each subscriber gets login/profile changes but repeated identity events do not reload it', async () => {
  const app = harness();
  const first = [];
  const second = [];
  const stopFirst = app.auth.onAuthStateChanged((user) => { first.push(user?.displayName || null); });
  const stopSecond = app.auth.onAuthStateChanged((user) => { second.push(user?.displayName || null); });
  await app.flush();
  await app.signInWithEmailAndPassword(app.auth, 'a@example.test', 'test-only-password');
  await app.flush();
  await app.emit('TOKEN_REFRESHED', sessionFor(userA, 'test-token-refreshed'));
  await app.flush();
  await app.emit('SIGNED_IN', sessionFor());
  await app.flush();
  await app.updateProfile(app.auth.currentUser, { displayName: 'Ana María' });
  await app.flush();
  assert.deepEqual(first, [null, 'Ana', 'Ana María']);
  assert.deepEqual(second, first);
  stopFirst(); stopSecond();
});

test('late initial session and cookie completion cannot restore a signed-out identity', async () => {
  const initial = deferred();
  const cookie = deferred();
  const app = harness({ initial: initial.promise });
  app.setFetch(() => cookie.promise);
  const users = [];
  const unsubscribe = app.auth.onAuthStateChanged((user) => { users.push(user?.uid || null); });
  await app.emit('SIGNED_IN', sessionFor());
  await app.flush();
  assert.deepEqual(users, ['user-a']);
  await app.emit('SIGNED_OUT', null);
  await app.flush();
  assert.deepEqual(users, ['user-a', null]);
  initial.resolve({ data: { session: sessionFor() }, error: null });
  cookie.resolve({ ok: true });
  await app.flush();
  assert.deepEqual(users, ['user-a', null]);
  assert.equal(app.auth.currentUser, null);
  assert.deepEqual(app.requests, ['Bearer test-token-a', null], 'logout cookie follows any in-flight token update');
  unsubscribe();
});

test('unsubscribe cancels pending dispatches and stale initial reads', async () => {
  const initial = deferred();
  const app = harness({ initial: initial.promise });
  const users = [];
  const unsubscribe = app.auth.onAuthStateChanged((user) => { users.push(user); });
  await app.emit('SIGNED_IN', sessionFor());
  unsubscribe();
  initial.resolve({ data: { session: sessionFor() }, error: null });
  await app.flush();
  assert.deepEqual(users, []);
  assert.deepEqual(app.requests, []);
  assert.equal(app.subscribers.size, 0);
});

test('cookie failures and rejected consumers are handled and do not prevent later auth events', async () => {
  const app = harness();
  app.setFetch(async () => { throw new Error('file cookie unavailable'); });
  const users = [];
  const unsubscribe = app.auth.onAuthStateChanged(async (user) => {
    users.push(user?.uid || null);
    throw new Error('consumer failed');
  });
  await app.flush();
  await app.signInWithEmailAndPassword(app.auth, 'a@example.test', 'test-only-password');
  await app.flush();
  await app.emit('SIGNED_OUT', null);
  await app.flush();
  assert.deepEqual(users, [null, 'user-a', null]);
  assert.equal(app.errors.filter(([message]) => message === 'Private storage session failed:').length, 3);
  assert.equal(app.errors.filter(([message]) => message === 'Error running Supabase auth listener:').length, 3);
  unsubscribe();
});
