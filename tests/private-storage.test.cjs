const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { NextRequest } = require('next/server');
let calls = 0;
let allow = true;
const load = (path) => {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((name) => name === '@/lib/storage/private-session' ? {
    STORAGE_SESSION_COOKIE: 'pixel-storage-session',
    storageClientForToken: (token) => ({
      auth: { getUser: async () => ({ data: { user: token === 'invalid' ? null : { id: 'visitor' } }, error: null }) },
      storage: { from: () => ({ download: async () => { calls++; return allow ? { data: new Blob(['private'], { type: 'text/html' }), error: null } : { data: null, error: new Error('RLS denied') }; } }) },
    }),
  } : require(name), module, module.exports);
  return module.exports;
};
const file = load('app/api/storage/file/route.ts');
const session = load('app/api/storage/session/route.ts');
const request = (cookie, path = 'documents/test.html') => new NextRequest('https://public.example.com/api/storage/file?path=' + encodeURIComponent(path), { headers: cookie ? { cookie: 'pixel-storage-session=' + cookie } : {} });
test('anonymous requests cannot reach Storage', async () => {
  calls = 0;
  const response = await file.GET(request(null));
  assert.equal(response.status, 401); assert.equal(calls, 0);
});
test('invalid sessions cannot reach Storage', async () => {
  calls = 0;
  assert.equal((await file.GET(request('invalid'))).status, 401); assert.equal(calls, 0);
});
test('path traversal is rejected', async () => {
  assert.equal((await file.GET(request('valid', '../secret'))).status, 400);
});
test('RLS denial is preserved without leaking file existence', async () => {
  allow = false;
  assert.equal((await file.GET(request('valid'))).status, 404);
  allow = true;
});
test('authorized files are never cached and active content is sandboxed', async () => {
  const response = await file.GET(request('valid'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.match(response.headers.get('content-disposition'), /^attachment/);
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});
test('cross-origin session changes are rejected', async () => {
  const response = await session.POST(new NextRequest('https://public.example.com/api/storage/session', { method: 'POST', headers: { origin: 'https://evil.example' } }));
  assert.equal(response.status, 403);
});
test('verified session cookie is HttpOnly, secure and limited to storage', async () => {
  const token = 'header.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.signature';
  const response = await session.POST(new NextRequest('https://public.example.com/api/storage/session', { method: 'POST', headers: { origin: 'https://public.example.com', authorization: 'Bearer ' + token } }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'Path=/api/storage', 'SameSite=strict']) assert.ok(cookie.includes(flag));
});
test('sign-out expires the private storage cookie', async () => {
  const response = await session.POST(new NextRequest('https://public.example.com/api/storage/session', { method: 'POST', headers: { origin: 'https://public.example.com' } }));
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
