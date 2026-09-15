const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

function loadTs(filename) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => name.startsWith('.')
    ? loadTs(path.resolve(path.dirname(filename), `${name}.ts`)) : require(name), module, module.exports);
  return module.exports;
}
const access = loadTs(path.resolve('lib/email/user-access-template.ts'));
const brand = loadTs(path.resolve('lib/email/pixel-brand.ts'));
const fixture = {
  appUrl: 'https://public.pixelprojects.com.co',
  actionUrl: 'https://example.supabase.co/auth/v1/verify?token=fake-example&type=invite',
  recipientName: 'Ana', recipientEmail: 'ana@example.invalid', invitedBy: 'Equipo Horizonte',
  roleLabel: 'Gerente de proyecto', organizationLabel: 'Estudio Horizonte', mode: 'invite',
};

test('invitation escapes all user-controlled presentation fields without changing the action URL', () => {
  const unsafe = '<img src=x onerror="alert(1)"> & \'sample\'';
  const html = access.buildUserAccessEmailHtml({ ...fixture, recipientName: unsafe, recipientEmail: unsafe, invitedBy: unsafe, roleLabel: unsafe, organizationLabel: unsafe });
  assert.doesNotMatch(html, /<img|<script/i);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &#39;sample&#39;/);
  assert.match(html, /href="https:\/\/example\.supabase\.co\/auth\/v1\/verify\?token=fake-example&amp;type=invite"/);
});

test('HTML and plain-text access emails reject unsafe links before delivery', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', '//example.invalid', 'http://example.invalid', 'https://user:secret@example.invalid', 'https://example.invalid/\r\ninjected']) {
    for (const builder of [access.buildUserAccessEmailHtml, access.buildUserAccessText]) {
      assert.throws(() => builder({ ...fixture, actionUrl: url }));
      assert.throws(() => builder({ ...fixture, appUrl: url }));
    }
  }
  assert.equal(brand.validateEmailUrl('http://127.0.0.1:3000/reset-password'), 'http://127.0.0.1:3000/reset-password');
});

test('recovery email accurately describes password reset and has a text fallback with the same link', () => {
  const data = { ...fixture, mode: 'recovery' };
  const html = access.buildUserAccessEmailHtml(data);
  const text = access.buildUserAccessText(data);
  assert.match(html, /tu contraseña seguirá igual/);
  assert.match(text, /Configurar mi contraseña: https:\/\/example\.supabase\.co/);
  assert.match(text, /tu contraseña seguirá igual/);
  assert.doesNotMatch(html, /te invitó/);
  assert.doesNotMatch(access.buildUserAccessSubject({ ...fixture, recipientName: '\r\nBcc: other@example.invalid' }), /[\r\n]/);
});

test('workspace administration is never presented as global access in invitation labels', () => {
  assert.equal(access.getUserAccessRoleLabel('admin'), 'Administrador del espacio');
  assert.equal(access.getOrganizationAccessLabel([]), 'Tu espacio de trabajo');
  assert.equal(access.getOrganizationAccessLabel(['one', 'two']), '2 organizaciones asignadas');
});

test('Supabase templates preserve documented verification placeholders and independent text fallbacks', () => {
  const manifest = JSON.parse(fs.readFileSync('supabase/email-templates/manifest.json', 'utf8'));
  assert.equal(manifest.length, 8);
  for (const entry of manifest) {
    const html = fs.readFileSync(`supabase/email-templates/${entry.html}`, 'utf8');
    const text = fs.readFileSync(`supabase/email-templates/${entry.text}`, 'utf8');
    assert.match(html, /<html lang="es">/);
    assert.match(html, /#20352f/);
    assert.match(html, /#c94d32/);
    assert.doesNotMatch(html, /<script|<iframe|<img|@import|example\.invalid|fake-example|#5b4bff/i);
    assert.match(html, /href="{{ \.SiteURL }}"/);
    if (entry.key === 'reauthentication') {
      assert.match(html, /{{ \.Token }}/);
      assert.match(text, /Código: {{ \.Token }}/);
    } else if (!entry.key.endsWith('_notification')) {
      assert.equal((html.match(/href="{{ \.ConfirmationURL }}"/g) || []).length, 2);
      assert.match(text, /{{ \.ConfirmationURL }}/);
    }
    assert.doesNotMatch(html, /{{ \.Data/);
    assert.ok(text.includes('Pixel Project'));
  }
});

test('checked-in email templates and safe preview match the shared brand generator', () => {
  execFileSync(process.execPath, ['scripts/generate-email-templates.mjs', '--check'], { stdio: 'pipe' });
  const preview = fs.readFileSync('docs/previews/pixel-invitation-email.html', 'utf8');
  assert.match(preview, /preview-no-valid-token/);
  assert.doesNotMatch(preview, /ing\.zambranog|service_role|eyJ/);
});
