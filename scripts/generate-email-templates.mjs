import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
function loadTs(relativePath) {
  const filename = path.resolve(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => name.startsWith('.') ? loadTs(path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`))) : require(name), module, module.exports);
  return module.exports;
}
const { buildPixelEmailHtml, buildPixelEmailText } = loadTs('lib/email/pixel-brand.ts');
const { buildUserAccessEmailHtml } = loadTs('lib/email/user-access-template.ts');
const appUrl = 'https://pixel-template.example.invalid/';
const actionUrl = 'https://pixel-template.example.invalid/auth-action';
const common = {
  appUrl,
  note: 'Este enlace es personal y tiene vigencia limitada. No lo compartas. Si no solicitaste esta acción, puedes ignorar el mensaje. Pixel nunca te pedirá tu contraseña por correo.',
};
const templates = [
  {
    key: 'confirmation', file: 'confirm-signup', dashboard: 'Confirm sign up', subject: 'Confirma tu correo y empieza en Pixel Project',
    content: { eyebrow: 'Tu próximo proyecto empieza aquí', heading: 'Dale espacio a tus ideas.', preview: 'Confirma tu correo para crear tu espacio privado en Pixel Project.',
      paragraphs: ['Te damos la bienvenida a Pixel Project. Confirma tu correo para crear tu espacio de trabajo y empezar a organizar tus proyectos con tu equipo.', 'Tu prueba gratuita de 14 días empieza al crear tu espacio. No necesitas tarjeta. Tus proyectos, organizaciones y archivos estarán separados de los de otros espacios.'],
      action: { label: 'Confirmar mi correo', url: actionUrl } },
  },
  {
    key: 'invite', file: 'invite-user', dashboard: 'Invite user', subject: 'Tu equipo te espera en Pixel Project',
    content: { eyebrow: 'Una invitación para colaborar', heading: 'Tu equipo te espera.', preview: 'Acepta tu invitación a Pixel Project y crea tu contraseña.',
      paragraphs: ['Recibiste una invitación para colaborar en Pixel Project. Acepta el acceso y crea tu contraseña para organizar proyectos, compartir tareas y avanzar con tu equipo.', 'Trabajarás en el espacio que te invitó, con los permisos asignados por su administrador.'],
      action: { label: 'Aceptar y crear mi contraseña', url: actionUrl } },
  },
  {
    key: 'recovery', file: 'reset-password', dashboard: 'Reset password', subject: 'Restablece tu contraseña de Pixel Project',
    content: { eyebrow: 'Acceso a tu cuenta', heading: 'Vuelve a tu espacio.', preview: 'Elige una nueva contraseña para tu cuenta de Pixel Project.',
      paragraphs: ['Recibimos una solicitud para restablecer tu contraseña. Usa este enlace para elegir una nueva y continuar con tus proyectos.'],
      action: { label: 'Restablecer mi contraseña', url: actionUrl },
      note: 'Si no solicitaste este cambio, ignora este mensaje: tu contraseña seguirá igual. Este enlace es personal y tiene vigencia limitada. No lo compartas.' },
  },
  {
    key: 'magic_link', file: 'magic-link', dashboard: 'Magic link', subject: 'Tu enlace de acceso a Pixel Project',
    content: { eyebrow: 'Acceso a tu cuenta', heading: 'Continúa donde lo dejaste.', preview: 'Abre tu espacio de Pixel Project con este enlace personal.',
      paragraphs: ['Usa este enlace para iniciar sesión en Pixel Project. Te llevará a tu espacio de trabajo para continuar con tu equipo y tus proyectos.'],
      action: { label: 'Entrar a Pixel Project', url: actionUrl } },
  },
  {
    key: 'email_change', file: 'change-email', dashboard: 'Change email address', subject: 'Confirma el cambio de correo en Pixel Project',
    content: { eyebrow: 'Configuración de tu cuenta', heading: 'Confirma tu nuevo correo.', preview: 'Confirma el cambio de dirección de correo solicitado para Pixel Project.',
      paragraphs: ['Se solicitó cambiar la dirección de correo de tu cuenta de Pixel Project. Confirma la solicitud para continuar con la actualización.'],
      action: { label: 'Confirmar cambio de correo', url: actionUrl },
      note: 'Si no solicitaste este cambio, no uses el enlace. Entra a Pixel Project desde su dirección habitual y revisa la seguridad de tu cuenta.' },
  },
  {
    key: 'reauthentication', file: 'reauthentication', dashboard: 'Reauthentication', subject: 'Tu código de verificación de Pixel Project',
    content: { eyebrow: 'Verificación de identidad', heading: 'Un paso para proteger tu cuenta.', preview: 'Usa este código para confirmar una acción en Pixel Project.',
      paragraphs: ['Escribe el siguiente código en la pantalla de Pixel Project donde solicitaste verificar tu identidad.'], code: '{{ .Token }}',
      note: 'Este código es personal y tiene vigencia limitada. No lo compartas. Si no solicitaste esta verificación, ignora el mensaje. Pixel nunca te pedirá este código por correo.' },
  },
  {
    key: 'password_changed_notification', file: 'password-changed', dashboard: 'Password changed', subject: 'Tu contraseña de Pixel Project fue actualizada',
    content: { eyebrow: 'Seguridad de tu cuenta', heading: 'Tu contraseña cambió.', preview: 'Te avisamos de un cambio de contraseña en tu cuenta de Pixel Project.',
      paragraphs: ['La contraseña de tu cuenta de Pixel Project fue actualizada. Si hiciste este cambio, puedes seguir trabajando como siempre.'],
      note: 'Si no reconoces este cambio, entra a Pixel Project desde su dirección habitual, solicita restablecer tu contraseña y contacta al administrador de tu espacio. Nunca compartas contraseñas ni códigos de acceso.' },
  },
  {
    key: 'email_changed_notification', file: 'email-changed', dashboard: 'Email address changed', subject: 'El correo de tu cuenta de Pixel Project cambió',
    content: { eyebrow: 'Seguridad de tu cuenta', heading: 'Tu correo fue actualizado.', preview: 'Te avisamos de un cambio de correo en tu cuenta de Pixel Project.',
      paragraphs: ['La dirección de correo de tu cuenta de Pixel Project fue actualizada. Si hiciste este cambio, no necesitas realizar ninguna otra acción.'],
      note: 'Si no reconoces este cambio, entra a Pixel Project desde su dirección habitual y contacta al administrador de tu espacio. Nunca compartas contraseñas ni códigos de acceso.' },
  },
];
const interpolateProvider = value => value.replaceAll(actionUrl, '{{ .ConfirmationURL }}').replaceAll(appUrl, '{{ .SiteURL }}');
const artifacts = new Map();
const manifest = templates.map(({ content, ...template }) => {
  const data = { ...common, ...content };
  artifacts.set(`supabase/email-templates/${template.file}.html`, interpolateProvider(buildPixelEmailHtml(data)) + '\n');
  artifacts.set(`supabase/email-templates/${template.file}.txt`, interpolateProvider(buildPixelEmailText(data)) + '\n');
  return { ...template, html: `${template.file}.html`, text: `${template.file}.txt` };
});
artifacts.set('supabase/email-templates/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
artifacts.set('docs/previews/pixel-invitation-email.html', buildUserAccessEmailHtml({
  appUrl: 'https://public.pixelprojects.com.co', actionUrl: 'https://pixel.example.invalid/preview-no-valid-token',
  recipientName: 'Ana', recipientEmail: 'ana@example.invalid', invitedBy: 'Equipo Horizonte',
  roleLabel: 'Gerente de proyecto', organizationLabel: 'Estudio Horizonte', mode: 'invite',
}) + '\n');
const check = process.argv.includes('--check');
let mismatches = 0;
for (const [relativePath, content] of artifacts) {
  const target = path.join(root, relativePath);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
      console.error(`Plantilla desactualizada: ${relativePath}`);
      mismatches++;
    }
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
if (mismatches) process.exitCode = 1;
else console.log(`${check ? 'Verificadas' : 'Generadas'} ${artifacts.size} plantillas y vistas previas de correo.`);
